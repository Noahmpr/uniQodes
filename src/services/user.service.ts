import { T } from "../database/identifiers";
import type { SqlExecutor } from "../database/executor";
import { nowIso } from "../utils/dates";

export interface StoredUser {
  id: number;
  telegramId: number;
  firstName: string;
  lastName: string | null;
  username: string | null;
  isActive: boolean;
  hasStartedBot: boolean;
  blockedBot: boolean;
}

interface UserRow {
  id: number;
  telegram_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  is_active: number;
  has_started_bot: number;
  blocked_bot: number;
}

function mapUser(row: UserRow): StoredUser {
  return {
    id: row.id,
    telegramId: row.telegram_id,
    firstName: row.first_name,
    lastName: row.last_name,
    username: row.username,
    isActive: row.is_active === 1,
    hasStartedBot: row.has_started_bot === 1,
    blockedBot: row.blocked_bot === 1,
  };
}

const userSelect = `SELECT id, telegram_id, first_name, last_name, username, is_active, has_started_bot, blocked_bot FROM ${T.users}`;

export async function findUserByTelegramId(db: SqlExecutor, telegramId: number): Promise<StoredUser | null> {
  const row = await db.get<UserRow>(`${userSelect} WHERE telegram_id = ?`, [telegramId]);
  return row ? mapUser(row) : null;
}

export async function findUserById(db: SqlExecutor, id: number): Promise<StoredUser | null> {
  const row = await db.get<UserRow>(`${userSelect} WHERE id = ?`, [id]);
  return row ? mapUser(row) : null;
}

export async function upsertUser(
  db: SqlExecutor,
  input: {
    telegramId: number;
    firstName: string;
    lastName: string | null;
    username: string | null;
    started: boolean;
  },
  now = nowIso(),
): Promise<StoredUser> {
  const firstName = input.firstName.trim() || "دانشجو";
  const lastName = input.lastName?.trim() ? input.lastName.trim() : null;
  const username = input.username?.trim() ? input.username.trim() : null;
  const started = input.started ? 1 : 0;
  await db.run(
    `INSERT INTO ${T.users} (telegram_id, first_name, last_name, username, is_active, has_started_bot, blocked_bot, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, 1, ?5, 0, ?6, ?6)
     ON CONFLICT(telegram_id) DO UPDATE SET
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       username = excluded.username,
       is_active = 1,
       has_started_bot = CASE WHEN excluded.has_started_bot = 1 THEN 1 ELSE ${T.users}.has_started_bot END,
       blocked_bot = CASE WHEN excluded.has_started_bot = 1 THEN 0 ELSE ${T.users}.blocked_bot END,
       updated_at = excluded.updated_at`,
    [input.telegramId, firstName, lastName, username, started, now],
  );
  const user = await findUserByTelegramId(db, input.telegramId);
  if (!user) throw new Error("user upsert failed");
  return user;
}

export async function markBotBlocked(db: SqlExecutor, telegramId: number, blocked: boolean, now = nowIso()): Promise<void> {
  await db.run(`UPDATE ${T.users} SET blocked_bot = ?1, updated_at = ?2 WHERE telegram_id = ?3`, [
    blocked ? 1 : 0,
    now,
    telegramId,
  ]);
}
