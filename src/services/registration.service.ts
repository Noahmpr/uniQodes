import { T } from "../database/identifiers";
import type { SqlExecutor } from "../database/executor";
import type { RegistrationFailure } from "../telegram/messages";
import { nowIso } from "../utils/dates";
import { getChapter, listMembers } from "./chapter.service";

export const REGISTER_STUDENT_SQL = `INSERT INTO ${T.registrations} (user_id, chapter_id, registered_at)
SELECT ?1, ?2, ?3
WHERE EXISTS (
  SELECT 1 FROM ${T.chapters}
  WHERE id = ?2
    AND status = 'scheduled'
    AND (?4 = 1 OR registration_open = 1)
)
AND (SELECT COUNT(*) FROM ${T.registrations} WHERE chapter_id = ?2) < 3
AND NOT EXISTS (SELECT 1 FROM ${T.registrations} WHERE user_id = ?1)`;

const CLOSE_FULL_SQL = `UPDATE ${T.chapters}
SET registration_open = 0, closed_by = 'auto', updated_at = ?1
WHERE id = ?2
  AND status = 'scheduled'
  AND (closed_by IS NULL OR closed_by = 'auto')
  AND (SELECT COUNT(*) FROM ${T.registrations} WHERE chapter_id = ?2) >= 3`;

export type RegistrationMode = "student" | "admin";

export type RegistrationResult = { ok: true; chapterId: number } | { ok: false; reason: RegistrationFailure };

interface ExistingRegistration {
  id: number;
  chapter_id: number;
}

async function diagnose(db: SqlExecutor, userId: number, chapterId: number, mode: RegistrationMode): Promise<RegistrationFailure> {
  const chapter = await getChapter(db, chapterId);
  if (!chapter) return "chapter_not_found";
  if (chapter.status !== "scheduled") return "chapter_inactive";
  const existing = await db.get<ExistingRegistration>(
    `SELECT id, chapter_id FROM ${T.registrations} WHERE user_id = ?`,
    [userId],
  );
  if (existing?.chapter_id === chapterId) return "already_in_chapter";
  if (existing) return "already_in_other_chapter";
  const members = await listMembers(db, chapterId);
  if (members.length >= 3) return "team_full";
  if (mode === "student" && !chapter.registrationOpen) return "registration_closed";
  return "team_full";
}

export async function registerStudent(
  db: SqlExecutor,
  input: { userId: number; chapterId: number; mode: RegistrationMode; hasStartedBot: boolean },
  now = nowIso(),
): Promise<RegistrationResult> {
  if (!input.hasStartedBot) return { ok: false, reason: "not_started" };
  const bypass = input.mode === "admin" ? 1 : 0;
  try {
    const results = await db.batch([
      { sql: REGISTER_STUDENT_SQL, params: [input.userId, input.chapterId, now, bypass] },
      { sql: CLOSE_FULL_SQL, params: [now, input.chapterId] },
    ]);
    if ((results[0]?.changes ?? 0) !== 1) {
      return { ok: false, reason: await diagnose(db, input.userId, input.chapterId, input.mode) };
    }
    return { ok: true, chapterId: input.chapterId };
  } catch (error) {
    const message = String(error);
    if (message.includes("CHAPTER_FULL") || message.includes("UNIQUE")) {
      return { ok: false, reason: await diagnose(db, input.userId, input.chapterId, input.mode) };
    }
    throw error;
  }
}

async function reopenIfAutoClosed(db: SqlExecutor, chapterId: number, now: string): Promise<boolean> {
  const result = await db.run(
    `UPDATE ${T.chapters}
     SET registration_open = 1, closed_by = NULL, updated_at = ?1
     WHERE id = ?2
       AND closed_by = 'auto'
       AND status = 'scheduled'
       AND (SELECT COUNT(*) FROM ${T.registrations} WHERE chapter_id = ?2) < 3`,
    [now, chapterId],
  );
  return result.changes > 0;
}

export async function cancelOwnRegistration(
  db: SqlExecutor,
  userId: number,
  now = nowIso(),
): Promise<{ ok: true; chapterId: number; reopened: boolean } | { ok: false; reason: "not_registered" }> {
  const existing = await db.get<ExistingRegistration>(`SELECT id, chapter_id FROM ${T.registrations} WHERE user_id = ?`, [userId]);
  if (!existing) return { ok: false, reason: "not_registered" };
  const deleted = await db.run(`DELETE FROM ${T.registrations} WHERE id = ?1 AND user_id = ?2`, [existing.id, userId]);
  if (deleted.changes !== 1) return { ok: false, reason: "not_registered" };
  const reopened = await reopenIfAutoClosed(db, existing.chapter_id, now);
  return { ok: true, chapterId: existing.chapter_id, reopened };
}

export async function removeRegistrationById(
  db: SqlExecutor,
  registrationId: number,
  now = nowIso(),
): Promise<{ ok: true; chapterId: number; reopened: boolean } | { ok: false; reason: "not_found" }> {
  const existing = await db.get<ExistingRegistration>(`SELECT id, chapter_id FROM ${T.registrations} WHERE id = ?`, [registrationId]);
  if (!existing) return { ok: false, reason: "not_found" };
  const deleted = await db.run(`DELETE FROM ${T.registrations} WHERE id = ?`, [registrationId]);
  if (deleted.changes !== 1) return { ok: false, reason: "not_found" };
  const reopened = await reopenIfAutoClosed(db, existing.chapter_id, now);
  return { ok: true, chapterId: existing.chapter_id, reopened };
}

export async function findRegistrationForUser(db: SqlExecutor, userId: number): Promise<{ id: number; chapterId: number } | null> {
  const row = await db.get<ExistingRegistration>(`SELECT id, chapter_id FROM ${T.registrations} WHERE user_id = ?`, [userId]);
  return row ? { id: row.id, chapterId: row.chapter_id } : null;
}
