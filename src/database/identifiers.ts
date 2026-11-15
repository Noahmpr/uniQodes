import { getTableName } from "drizzle-orm";
import {
  chapters,
  registrations,
  reminderLogs,
  sessions,
  settings,
  telegramMessages,
  users,
} from "./schema";

/** Table names come from the Drizzle schema so SQL stays aligned with schema.ts. */
export const T = {
  users: getTableName(users),
  chapters: getTableName(chapters),
  registrations: getTableName(registrations),
  telegramMessages: getTableName(telegramMessages),
  reminderLogs: getTableName(reminderLogs),
  settings: getTableName(settings),
  sessions: getTableName(sessions),
} as const;
