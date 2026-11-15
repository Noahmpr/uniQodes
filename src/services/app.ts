import type { SqlExecutor } from "../database/executor";
import { createD1Executor } from "../database/d1";
import { createTelegramClient, type TelegramClient } from "../telegram/api";
import type { Env } from "../types/env";
import { parseAdminIds, parseGroupChatId } from "../utils/security";

export interface AppServices {
  db: SqlExecutor;
  telegram: TelegramClient;
  adminIds: Set<number>;
  fallbackGroupChatId: number | null;
}

export function createServices(env: Env): AppServices {
  return {
    db: createD1Executor(env.DB),
    telegram: createTelegramClient(env.BOT_TOKEN),
    adminIds: parseAdminIds(env.ADMIN_TELEGRAM_IDS),
    fallbackGroupChatId: parseGroupChatId(env.GROUP_CHAT_ID),
  };
}
