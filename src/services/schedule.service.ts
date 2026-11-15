import { T } from "../database/identifiers";
import type { SqlExecutor } from "../database/executor";
import {
  errorText,
  isMessageMissing,
  isMessageNotModified,
  type TelegramClient,
} from "../telegram/api";
import { buildScheduleMessages, type ScheduleChapter } from "../telegram/messages";
import { nowIso } from "../utils/dates";
import { parseGroupChatId } from "../utils/security";
import { listAllMembers, listChapters } from "./chapter.service";
import { getSettings } from "./settings.service";

interface StoredMessage {
  id: number;
  chat_id: number;
  message_id: number;
  message_type: string;
}

function partType(index: number): string {
  return index === 0 ? "schedule" : `schedule:${index}`;
}

function partIndex(type: string): number {
  if (type === "schedule") return 0;
  const value = Number(type.slice("schedule:".length));
  return Number.isInteger(value) ? value : 999;
}

export async function loadScheduleChapters(db: SqlExecutor): Promise<ScheduleChapter[]> {
  const [chapters, members] = await Promise.all([listChapters(db), listAllMembers(db)]);
  return chapters.map((chapter) => ({
    chapterNumber: chapter.chapterNumber,
    title: chapter.title,
    presentationDate: chapter.presentationDate,
    presentationTime: chapter.presentationTime,
    registrationOpen: chapter.registrationOpen,
    status: chapter.status,
    members: members
      .filter((member) => member.chapterId === chapter.id)
      .map((member) => ({ firstName: member.firstName, lastName: member.lastName })),
  }));
}

export async function renderStoredSchedule(db: SqlExecutor): Promise<string[]> {
  const settings = await getSettings(db);
  const chapters = await loadScheduleChapters(db);
  return buildScheduleMessages({
    courseTitle: settings.courseTitle,
    professorName: settings.professorName,
    bookName: settings.bookName,
    semesterName: settings.semesterName,
    chapters,
  });
}

async function saveMessage(db: SqlExecutor, chatId: number, messageId: number, messageType: string, now: string): Promise<void> {
  await db.run(
    `INSERT INTO ${T.telegramMessages} (chat_id, message_id, message_type, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(message_type) DO UPDATE SET
       chat_id = excluded.chat_id,
       message_id = excluded.message_id,
       updated_at = excluded.updated_at`,
    [chatId, messageId, messageType, now],
  );
}

async function sendPart(api: TelegramClient, chatId: number, text: string): Promise<number> {
  const result = await api.call<{ message_id: number }>("sendMessage", {
    chat_id: chatId,
    text,
    link_preview_options: { is_disabled: true },
  });
  return result.message_id;
}

async function editOrReplace(
  api: TelegramClient,
  chatId: number,
  messageId: number,
  text: string,
): Promise<{ messageId: number; replaced: boolean }> {
  try {
    await api.call("editMessageText", {
      chat_id: chatId,
      message_id: messageId,
      text,
      link_preview_options: { is_disabled: true },
    });
    return { messageId, replaced: false };
  } catch (error) {
    if (isMessageNotModified(error)) return { messageId, replaced: false };
    if (!isMessageMissing(error)) throw error;
    const created = await sendPart(api, chatId, text);
    return { messageId: created, replaced: true };
  }
}

export async function publishSchedule(
  db: SqlExecutor,
  api: TelegramClient,
  chatId: number,
  now = nowIso(),
): Promise<{ parts: number; pinned: boolean; recreated: boolean }> {
  const parts = await renderStoredSchedule(db);
  const stored = await db.all<StoredMessage>(
    `SELECT id, chat_id, message_id, message_type FROM ${T.telegramMessages}
     WHERE message_type = 'schedule' OR message_type LIKE 'schedule:%'`,
  );
  stored.sort((left, right) => partIndex(left.message_type) - partIndex(right.message_type));
  let recreated = false;
  let firstMessageId = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const type = partType(index);
    const text = parts[index] ?? "";
    const existing = stored.find((item) => item.message_type === type && item.chat_id === chatId);
    if (!existing) {
      const messageId = await sendPart(api, chatId, text);
      await saveMessage(db, chatId, messageId, type, now);
      recreated = true;
      if (index === 0) firstMessageId = messageId;
      continue;
    }
    const edited = await editOrReplace(api, chatId, existing.message_id, text);
    if (edited.replaced || edited.messageId !== existing.message_id) {
      await saveMessage(db, chatId, edited.messageId, type, now);
      recreated = true;
    } else {
      await db.run(`UPDATE ${T.telegramMessages} SET updated_at = ?1 WHERE id = ?2`, [now, existing.id]);
    }
    if (index === 0) firstMessageId = edited.messageId;
  }
  for (const extra of stored) {
    if (partIndex(extra.message_type) < parts.length && extra.chat_id === chatId) continue;
    try {
      await api.call("deleteMessage", { chat_id: extra.chat_id, message_id: extra.message_id });
      await db.run(`DELETE FROM ${T.telegramMessages} WHERE id = ?`, [extra.id]);
    } catch (error) {
      if (isMessageMissing(error)) await db.run(`DELETE FROM ${T.telegramMessages} WHERE id = ?`, [extra.id]);
      else console.error(JSON.stringify({ scope: "schedule_delete", message: errorText(error) }));
    }
  }
  let pinned = false;
  if (firstMessageId > 0) {
    try {
      await api.call("pinChatMessage", { chat_id: chatId, message_id: firstMessageId, disable_notification: true });
      pinned = true;
    } catch (error) {
      console.error(JSON.stringify({ scope: "schedule_pin", message: errorText(error) }));
    }
  }
  return { parts: parts.length, pinned, recreated };
}

export async function resolveGroupChatId(db: SqlExecutor, fallback: number | null): Promise<number | null> {
  const settings = await getSettings(db);
  return parseGroupChatId(settings.groupChatId) ?? fallback;
}

export async function refreshGroupSchedule(
  db: SqlExecutor,
  api: TelegramClient,
  fallbackGroupChatId: number | null,
): Promise<string | null> {
  const chatId = await resolveGroupChatId(db, fallbackGroupChatId);
  if (!chatId) return "شناسه گروه هنوز تنظیم نشده است.";
  try {
    await publishSchedule(db, api, chatId);
    return null;
  } catch (error) {
    console.error(JSON.stringify({ scope: "schedule", message: errorText(error) }));
    return "تغییر ذخیره شد، اما به‌روزرسانی پیام گروه ناموفق بود.";
  }
}
