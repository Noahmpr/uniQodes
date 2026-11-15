export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  WEBHOOK_SECRET: string;
  ADMIN_TELEGRAM_IDS: string;
  GROUP_CHAT_ID?: string;
  TIMEZONE: string;
}
