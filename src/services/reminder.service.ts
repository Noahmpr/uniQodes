import { T } from "../database/identifiers";
import type { SqlExecutor } from "../database/executor";
import { errorText, isPermanentDeliveryFailure, TelegramApiError, type TelegramClient } from "../telegram/api";
import { renderReminder, type ReminderType } from "../telegram/messages";
import { displayName } from "../utils/persian";
import {
  addGregorianDays,
  DAY_MS,
  formatJalaliDayMonth,
  formatPersianTime,
  nowIso,
  tehranDateTimeToUtc,
  tehranStartOfDayUtc,
  tehranToday,
} from "../utils/dates";
import { listAllMembers, listChapters, type MemberRecord } from "./chapter.service";
import { getSettings } from "./settings.service";

export const REMINDER_BATCH_LIMIT = 8;
const MAX_ATTEMPTS = 5;
const CLAIM_STALE_MS = 10 * 60 * 1000;

export function dueReminderTypes(input: {
  presentationDate: string;
  presentationTime: string;
  now: Date;
  sameDayEnabled: boolean;
}): ReminderType[] {
  const start = tehranDateTimeToUtc(input.presentationDate, input.presentationTime).getTime();
  const now = input.now.getTime();
  if (now >= start) return [];
  const due: ReminderType[] = [];
  if (now >= start - 3 * DAY_MS && now < start - 2 * DAY_MS) due.push("three_days");
  const dayStart = tehranStartOfDayUtc(input.presentationDate).getTime();
  const oneEnd = Math.min(start, dayStart);
  if (now >= start - DAY_MS && now < oneEnd) due.push("one_day");
  if (input.sameDayEnabled && now >= dayStart && now < start) due.push("same_day");
  return due;
}

export function retryDelayMs(attempt: number, retryAfterSeconds: number | null): number {
  if (retryAfterSeconds && retryAfterSeconds > 0) return retryAfterSeconds * 1000;
  const delay = 15 * 60 * 1000 * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, 6 * 60 * 60 * 1000);
}

interface DueChapter {
  id: number;
  chapterNumber: number;
  title: string;
  presentationDate: string;
  presentationTime: string;
  types: ReminderType[];
}

interface ClaimRow {
  id: number;
  user_id: number;
  chapter_id: number;
  reminder_type: ReminderType;
  attempt_count: number;
  telegram_id: number;
  first_name: string;
  blocked_bot: number;
  title: string;
  chapter_number: number;
  presentation_date: string;
  presentation_time: string;
  status: string;
}

export interface ReminderRunResult {
  queued: number;
  sent: number;
  failed: number;
  blocked: number;
  skipped: number;
}

export async function processReminders(
  db: SqlExecutor,
  api: TelegramClient,
  now = new Date(),
): Promise<ReminderRunResult> {
  const result: ReminderRunResult = { queued: 0, sent: 0, failed: 0, blocked: 0, skipped: 0 };
  const settings = await getSettings(db);
  const today = tehranToday(now);
  const chapters = await listChapters(db);
  const due: DueChapter[] = [];
  for (const chapter of chapters) {
    if (chapter.status === "cancelled" || !chapter.presentationDate || !chapter.presentationTime) continue;
    if (chapter.presentationDate < addGregorianDays(today, -1) || chapter.presentationDate > addGregorianDays(today, 4)) continue;
    const types = dueReminderTypes({
      presentationDate: chapter.presentationDate,
      presentationTime: chapter.presentationTime,
      now,
      sameDayEnabled: settings.sameDayReminderEnabled,
    });
    if (types.length === 0) continue;
    due.push({
      id: chapter.id,
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      presentationDate: chapter.presentationDate,
      presentationTime: chapter.presentationTime,
      types,
    });
  }
  const members = due.length > 0 ? await listAllMembers(db) : [];
  const byChapter = new Map<number, MemberRecord[]>();
  for (const member of members) {
    const list = byChapter.get(member.chapterId) ?? [];
    list.push(member);
    byChapter.set(member.chapterId, list);
  }
  const inserts = [];
  for (const chapter of due) {
    for (const type of chapter.types) {
      const scheduledAt = new Date(tehranDateTimeToUtc(chapter.presentationDate, chapter.presentationTime).getTime() - offsetFor(type)).toISOString();
      for (const member of byChapter.get(chapter.id) ?? []) {
        inserts.push({
          sql: `INSERT OR IGNORE INTO ${T.reminderLogs}
            (user_id, chapter_id, reminder_type, scheduled_at, status, attempt_count)
            VALUES (?1, ?2, ?3, ?4, 'pending', 0)`,
          params: [member.userId, chapter.id, type, scheduledAt],
        });
      }
    }
  }
  if (inserts.length > 0) {
    const inserted = await db.batch(inserts);
    result.queued = inserted.reduce((sum, item) => sum + item.changes, 0);
  }
  const skipped = await db.run(
    `UPDATE ${T.reminderLogs}
     SET status = 'skipped', error_message = 'presentation_cancelled'
     WHERE status IN ('pending', 'failed', 'sending')
       AND chapter_id IN (SELECT id FROM ${T.chapters} WHERE status = 'cancelled')`,
  );
  result.skipped += skipped.changes;
  const staleBefore = new Date(now.getTime() - CLAIM_STALE_MS).toISOString();
  const current = nowIso(now);
  const pending = await db.all<ClaimRow>(
    `SELECT rl.id, rl.user_id, rl.chapter_id, rl.reminder_type, rl.attempt_count,
            u.telegram_id, u.first_name, u.blocked_bot,
            c.title, c.chapter_number, c.presentation_date, c.presentation_time, c.status
     FROM ${T.reminderLogs} rl
     JOIN ${T.users} u ON u.id = rl.user_id
     JOIN ${T.chapters} c ON c.id = rl.chapter_id
     WHERE rl.attempt_count < ?1
       AND c.status != 'cancelled'
       AND (
         rl.status IN ('pending', 'failed')
         OR (rl.status = 'sending' AND rl.claimed_at <= ?2)
       )
       AND (rl.next_retry_at IS NULL OR rl.next_retry_at <= ?3)
     ORDER BY rl.id
     LIMIT ?4`,
    [MAX_ATTEMPTS, staleBefore, current, REMINDER_BATCH_LIMIT],
  );
  for (const item of pending) {
    const claim = await db.run(
      `UPDATE ${T.reminderLogs}
       SET status = 'sending', claimed_at = ?1, attempt_count = attempt_count + 1
       WHERE id = ?2
         AND attempt_count < ?3
         AND (
           status IN ('pending', 'failed')
           OR (status = 'sending' AND claimed_at <= ?4)
         )`,
      [current, item.id, MAX_ATTEMPTS, staleBefore],
    );
    if (claim.changes !== 1) continue;
    const attempt = item.attempt_count + 1;
    if (!item.presentation_date || !item.presentation_time || tehranDateTimeToUtc(item.presentation_date, item.presentation_time) <= now) {
      await db.run(`UPDATE ${T.reminderLogs} SET status = 'skipped', error_message = 'presentation_passed' WHERE id = ?`, [item.id]);
      result.skipped += 1;
      continue;
    }
    if (item.blocked_bot === 1) {
      await db.run(`UPDATE ${T.reminderLogs} SET status = 'blocked', error_message = 'user_blocked' WHERE id = ?`, [item.id]);
      result.blocked += 1;
      continue;
    }
    const team = (byChapter.get(item.chapter_id) ?? (await listAllMembers(db)).filter((member) => member.chapterId === item.chapter_id));
    const text = renderReminder({
      courseTitle: settings.courseTitle,
      firstName: item.first_name,
      kind: item.reminder_type,
      chapterNumber: item.chapter_number,
      title: item.title,
      dateLabel: formatJalaliDayMonth(item.presentation_date),
      timeLabel: formatPersianTime(item.presentation_time),
      members: team.map((member) => ({
        name: displayName(member),
        isSelf: member.userId === item.user_id,
      })),
    });
    try {
      await api.call("sendMessage", {
        chat_id: item.telegram_id,
        text,
        link_preview_options: { is_disabled: true },
      });
      await db.run(`UPDATE ${T.reminderLogs} SET status = 'sent', sent_at = ?1, error_message = NULL, next_retry_at = NULL WHERE id = ?2`, [
        current,
        item.id,
      ]);
      result.sent += 1;
    } catch (error) {
      if (isPermanentDeliveryFailure(error)) {
        await db.batch([
          { sql: `UPDATE ${T.reminderLogs} SET status = 'blocked', error_message = ?1 WHERE id = ?2`, params: [errorText(error), item.id] },
          { sql: `UPDATE ${T.users} SET blocked_bot = 1, updated_at = ?1 WHERE id = ?2`, params: [current, item.user_id] },
        ]);
        result.blocked += 1;
        continue;
      }
      const retryAt =
        attempt >= MAX_ATTEMPTS
          ? null
          : new Date(now.getTime() + retryDelayMs(attempt, error instanceof TelegramApiError ? error.retryAfterSeconds : null)).toISOString();
      await db.run(
        `UPDATE ${T.reminderLogs} SET status = 'failed', error_message = ?1, next_retry_at = ?2 WHERE id = ?3`,
        [errorText(error), retryAt, item.id],
      );
      result.failed += 1;
    }
  }
  return result;
}

function offsetFor(type: ReminderType): number {
  if (type === "three_days") return 3 * DAY_MS;
  if (type === "one_day") return DAY_MS;
  return 0;
}
