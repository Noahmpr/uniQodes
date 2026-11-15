import { T } from "../database/identifiers";
import type { SqlExecutor } from "../database/executor";
import type { ChapterStatus } from "../telegram/messages";
import { nowIso } from "../utils/dates";

export interface ChapterRecord {
  id: number;
  chapterNumber: number;
  title: string;
  presentationDate: string | null;
  presentationTime: string | null;
  registrationOpen: boolean;
  closedBy: "admin" | "auto" | null;
  status: ChapterStatus;
}

interface ChapterRow {
  id: number;
  chapter_number: number;
  title: string;
  presentation_date: string | null;
  presentation_time: string | null;
  registration_open: number;
  closed_by: "admin" | "auto" | null;
  status: ChapterStatus;
}

export interface MemberRecord {
  registrationId: number;
  chapterId: number;
  userId: number;
  telegramId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  hasStartedBot: boolean;
  blockedBot: boolean;
  registeredAt: string;
}

interface MemberRow {
  registration_id: number;
  chapter_id: number;
  user_id: number;
  telegram_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  has_started_bot: number;
  blocked_bot: number;
  registered_at: string;
}

function mapChapter(row: ChapterRow): ChapterRecord {
  return {
    id: row.id,
    chapterNumber: row.chapter_number,
    title: row.title,
    presentationDate: row.presentation_date,
    presentationTime: row.presentation_time,
    registrationOpen: row.registration_open === 1,
    closedBy: row.closed_by,
    status: row.status,
  };
}

function mapMember(row: MemberRow): MemberRecord {
  return {
    registrationId: row.registration_id,
    chapterId: row.chapter_id,
    userId: row.user_id,
    telegramId: row.telegram_id,
    firstName: row.first_name,
    lastName: row.last_name,
    username: row.username,
    hasStartedBot: row.has_started_bot === 1,
    blockedBot: row.blocked_bot === 1,
    registeredAt: row.registered_at,
  };
}

const chapterSelect = `SELECT id, chapter_number, title, presentation_date, presentation_time, registration_open, closed_by, status FROM ${T.chapters}`;
const chapterOrder = `ORDER BY CASE WHEN presentation_date IS NULL OR presentation_date = '' THEN 1 ELSE 0 END, presentation_date, COALESCE(presentation_time, '99:99'), chapter_number`;

export async function listChapters(db: SqlExecutor): Promise<ChapterRecord[]> {
  const rows = await db.all<ChapterRow>(`${chapterSelect} ${chapterOrder}`);
  return rows.map(mapChapter);
}

export async function getChapter(db: SqlExecutor, id: number): Promise<ChapterRecord | null> {
  const row = await db.get<ChapterRow>(`${chapterSelect} WHERE id = ?`, [id]);
  return row ? mapChapter(row) : null;
}

export async function findChapterByNumber(db: SqlExecutor, chapterNumber: number): Promise<ChapterRecord | null> {
  const row = await db.get<ChapterRow>(`${chapterSelect} WHERE chapter_number = ?`, [chapterNumber]);
  return row ? mapChapter(row) : null;
}

export async function createChapter(
  db: SqlExecutor,
  input: { chapterNumber: number; title: string },
  now = nowIso(),
): Promise<{ ok: true; id: number } | { ok: false; reason: "duplicate_number" }> {
  try {
    await db.run(
      `INSERT INTO ${T.chapters} (chapter_number, title, registration_open, closed_by, status, created_at, updated_at)
       VALUES (?1, ?2, 1, NULL, 'scheduled', ?3, ?3)`,
      [input.chapterNumber, input.title, now],
    );
  } catch (error) {
    if (String(error).includes("UNIQUE")) return { ok: false, reason: "duplicate_number" };
    throw error;
  }
  const created = await findChapterByNumber(db, input.chapterNumber);
  if (!created) throw new Error("chapter insert failed");
  return { ok: true, id: created.id };
}

export async function updateChapterTitle(db: SqlExecutor, id: number, title: string, now = nowIso()): Promise<boolean> {
  const result = await db.run(`UPDATE ${T.chapters} SET title = ?1, updated_at = ?2 WHERE id = ?3`, [title, now, id]);
  return result.changes > 0;
}

export async function updateChapterDate(db: SqlExecutor, id: number, date: string, now = nowIso()): Promise<boolean> {
  const result = await db.run(`UPDATE ${T.chapters} SET presentation_date = ?1, updated_at = ?2 WHERE id = ?3`, [date, now, id]);
  return result.changes > 0;
}

export async function updateChapterTime(db: SqlExecutor, id: number, time: string, now = nowIso()): Promise<boolean> {
  const result = await db.run(`UPDATE ${T.chapters} SET presentation_time = ?1, updated_at = ?2 WHERE id = ?3`, [time, now, id]);
  return result.changes > 0;
}

export async function setRegistrationOpen(
  db: SqlExecutor,
  id: number,
  open: boolean,
  now = nowIso(),
): Promise<"updated" | "not_found" | "full" | "inactive"> {
  if (open) {
    const result = await db.run(
      `UPDATE ${T.chapters}
       SET registration_open = 1, closed_by = NULL, updated_at = ?1
       WHERE id = ?2 AND status = 'scheduled'
         AND (SELECT COUNT(*) FROM ${T.registrations} WHERE chapter_id = ${T.chapters}.id) < 3`,
      [now, id],
    );
    if (result.changes > 0) return "updated";
    const chapter = await getChapter(db, id);
    if (!chapter) return "not_found";
    if (chapter.status !== "scheduled") return "inactive";
    return "full";
  }
  const result = await db.run(
    `UPDATE ${T.chapters} SET registration_open = 0, closed_by = 'admin', updated_at = ?1 WHERE id = ?2 AND status = 'scheduled'`,
    [now, id],
  );
  if (result.changes > 0) return "updated";
  const chapter = await getChapter(db, id);
  return chapter ? "inactive" : "not_found";
}

export async function setChapterStatus(
  db: SqlExecutor,
  id: number,
  status: ChapterStatus,
  now = nowIso(),
): Promise<boolean> {
  const closing = status === "cancelled" || status === "completed";
  const result = await db.run(
    `UPDATE ${T.chapters}
     SET status = ?1,
         registration_open = CASE WHEN ?2 = 1 THEN 0 ELSE registration_open END,
         closed_by = CASE WHEN ?2 = 1 THEN 'admin' ELSE closed_by END,
         updated_at = ?3
     WHERE id = ?4`,
    [status, closing ? 1 : 0, now, id],
  );
  return result.changes > 0;
}

const memberSelect = `SELECT r.id AS registration_id, r.chapter_id, r.user_id, r.registered_at,
  u.telegram_id, u.first_name, u.last_name, u.username, u.has_started_bot, u.blocked_bot
  FROM ${T.registrations} r
  JOIN ${T.users} u ON u.id = r.user_id`;

export async function listMembers(db: SqlExecutor, chapterId: number): Promise<MemberRecord[]> {
  const rows = await db.all<MemberRow>(`${memberSelect} WHERE r.chapter_id = ? ORDER BY r.registered_at, r.id`, [chapterId]);
  return rows.map(mapMember);
}

export async function listAllMembers(db: SqlExecutor): Promise<MemberRecord[]> {
  const rows = await db.all<MemberRow>(`${memberSelect} ORDER BY r.chapter_id, r.registered_at, r.id`);
  return rows.map(mapMember);
}

export async function registrationStats(db: SqlExecutor): Promise<{
  students: number;
  chapters: number;
  openChapters: number;
  registrations: number;
  fullChapters: number;
}> {
  const row = await db.get<{
    students: number;
    chapters: number;
    open_chapters: number;
    registrations: number;
    full_chapters: number;
  }>(
    `SELECT
      (SELECT COUNT(*) FROM ${T.users} WHERE has_started_bot = 1) AS students,
      (SELECT COUNT(*) FROM ${T.chapters}) AS chapters,
      (SELECT COUNT(*) FROM ${T.chapters} WHERE status = 'scheduled' AND registration_open = 1) AS open_chapters,
      (SELECT COUNT(*) FROM ${T.registrations}) AS registrations,
      (SELECT COUNT(*) FROM ${T.chapters} c WHERE (SELECT COUNT(*) FROM ${T.registrations} r WHERE r.chapter_id = c.id) >= 3) AS full_chapters`,
  );
  return {
    students: row?.students ?? 0,
    chapters: row?.chapters ?? 0,
    openChapters: row?.open_chapters ?? 0,
    registrations: row?.registrations ?? 0,
    fullChapters: row?.full_chapters ?? 0,
  };
}
