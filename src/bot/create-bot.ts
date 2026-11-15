import { Bot, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { handleAdminCallback } from "./admin";
import { handleCallback, handleCancel, handleHelp, handleStart, handleText } from "./student";
import type { AppServices } from "../services/app";
import { markBotBlocked, upsertUser } from "../services/user.service";

function safeMessage(error: unknown, token: string): string {
  const raw = error instanceof Error ? error.message : "unknown";
  return raw.replaceAll(token, "[redacted]").slice(0, 300);
}

export function createBot(token: string, services: AppServices, botInfo?: UserFromGetMe): Bot<Context> {
  const bot = new Bot<Context>(token, botInfo ? { botInfo } : {});
  bot.catch(async (error) => {
    console.error(JSON.stringify({ scope: "bot", message: safeMessage(error.error, token) }));
    try {
      if (error.ctx.callbackQuery) {
        await error.ctx.answerCallbackQuery({ text: "خطایی رخ داد. دوباره تلاش کنید.", show_alert: true });
      } else {
        await error.ctx.reply("خطایی رخ داد. لطفاً کمی بعد دوباره تلاش کنید.");
      }
    } catch {
      // The user may have blocked the bot or the callback may already have been answered.
    }
  });
  bot.use(async (ctx, next) => {
    const type = ctx.chat?.type;
    if (type === "group" || type === "supergroup" || type === "channel") {
      const text = ctx.message?.text ?? "";
      if (/^\/(start|help|menu|admin|cancel)(?:@\S+)?/.test(text)) {
        await ctx.reply("برای استفاده از ربات، گفتگوی خصوصی را باز کنید و /start را بزنید.");
      }
      return;
    }
    await next();
  });
  bot.on("my_chat_member", async (ctx) => {
    if (ctx.chat.type !== "private") return;
    const status = ctx.myChatMember.new_chat_member.status;
    if (status === "kicked") await markBotBlocked(services.db, ctx.myChatMember.from.id, true);
    if (status === "member") await markBotBlocked(services.db, ctx.myChatMember.from.id, false);
  });
  bot.command("start", (ctx) => handleStart(ctx, services));
  bot.command("menu", (ctx) => handleStart(ctx, services));
  bot.command("help", (ctx) => handleHelp(ctx, services));
  bot.command("cancel", (ctx) => handleCancel(ctx, services));
  bot.command("admin", async (ctx) => {
    const from = ctx.from;
    if (!from || !services.adminIds.has(from.id)) {
      await ctx.reply("این بخش فقط برای نماینده کلاس است.");
      return;
    }
    const user = await upsertUser(services.db, {
      telegramId: from.id,
      firstName: from.first_name,
      lastName: from.last_name ?? null,
      username: from.username ?? null,
      started: true,
    });
    await handleAdminCallback(ctx, services, user, "a:home");
  });
  bot.on("callback_query:data", (ctx) => handleCallback(ctx, services));
  bot.on("message:text", (ctx) => handleText(ctx, services));
  return bot;
}

const commands = [
  { command: "start", description: "شروع و نمایش منو" },
  { command: "menu", description: "منوی اصلی" },
  { command: "help", description: "راهنما" },
  { command: "admin", description: "منوی نماینده کلاس" },
  { command: "cancel", description: "لغو عملیات جاری" },
];

let commandsReady = false;

export async function ensureCommands(bot: Bot<Context>, token: string): Promise<void> {
  if (commandsReady) return;
  try {
    await bot.api.setMyCommands(commands);
    await bot.api.setMyCommands(commands, { language_code: "fa" });
    commandsReady = true;
  } catch (error) {
    console.error(JSON.stringify({ scope: "commands", message: safeMessage(error, token) }));
  }
}
