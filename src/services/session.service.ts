import { z } from "zod";
import { T } from "../database/identifiers";
import type { SqlExecutor } from "../database/executor";
import { nowIso } from "../utils/dates";

const sessionSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("add_number") }),
  z.object({ state: z.literal("add_title"), chapterNumber: z.number().int().positive() }),
  z.object({ state: z.literal("edit_title"), chapterId: z.number().int().positive() }),
  z.object({ state: z.literal("set_date"), chapterId: z.number().int().positive() }),
  z.object({ state: z.literal("set_time"), chapterId: z.number().int().positive() }),
  z.object({ state: z.literal("add_student"), chapterId: z.number().int().positive() }),
  z.object({
    state: z.literal("set_setting"),
    key: z.enum(["course_title", "professor_name", "book_name", "semester_name", "group_chat_id"]),
  }),
]);

export type AdminSession = z.infer<typeof sessionSchema>;

export async function loadSession(db: SqlExecutor, telegramId: number): Promise<AdminSession | null> {
  const row = await db.get<{ state: string; payload: string }>(
    `SELECT state, payload FROM ${T.sessions} WHERE telegram_id = ?`,
    [telegramId],
  );
  if (!row) return null;
  let payload: unknown = {};
  try {
    payload = JSON.parse(row.payload);
  } catch {
    await clearSession(db, telegramId);
    return null;
  }
  const parsed = sessionSchema.safeParse({ state: row.state, ...(payload as Record<string, unknown>) });
  if (!parsed.success) {
    await clearSession(db, telegramId);
    return null;
  }
  return parsed.data;
}

export async function saveSession(db: SqlExecutor, telegramId: number, session: AdminSession, now = nowIso()): Promise<void> {
  const { state, ...payload } = session;
  await db.run(
    `INSERT INTO ${T.sessions} (telegram_id, state, payload, updated_at)
     VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(telegram_id) DO UPDATE SET state = excluded.state, payload = excluded.payload, updated_at = excluded.updated_at`,
    [telegramId, state, JSON.stringify(payload), now],
  );
}

export async function clearSession(db: SqlExecutor, telegramId: number): Promise<void> {
  await db.run(`DELETE FROM ${T.sessions} WHERE telegram_id = ?`, [telegramId]);
}
