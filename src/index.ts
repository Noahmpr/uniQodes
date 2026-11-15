import { webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { createBot, ensureCommands } from "./bot/create-bot";
import { processReminders } from "./services/reminder.service";
import { createServices } from "./services/app";
import type { Env } from "./types/env";
import { isWebhookAuthorized, isWebhookSecretValid } from "./utils/security";

let botCache: { token: string; info?: UserFromGetMe } | undefined;

function cachedBotInfo(token: string): UserFromGetMe | undefined {
  return botCache?.token === token ? botCache.info : undefined;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
      return Response.json({ ok: true, service: "cv-presentation-bot" });
    }
    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("Not found", { status: 404 });
    }
    if (!env.BOT_TOKEN || !isWebhookSecretValid(env.WEBHOOK_SECRET)) {
      return new Response("Misconfigured", { status: 500 });
    }
    if (!isWebhookAuthorized(request.headers.get("X-Telegram-Bot-Api-Secret-Token"), env.WEBHOOK_SECRET)) {
      return new Response("Unauthorized", { status: 401 });
    }
    try {
      const services = createServices(env);
      const bot = createBot(env.BOT_TOKEN, services, cachedBotInfo(env.BOT_TOKEN));
      ctx.waitUntil(ensureCommands(bot, env.BOT_TOKEN));
      const response = await webhookCallback(bot, "cloudflare-mod", {
        secretToken: env.WEBHOOK_SECRET,
        timeoutMilliseconds: 50_000,
        onTimeout: "throw",
      })(request);
      if (bot.isInited()) botCache = { token: env.BOT_TOKEN, info: bot.botInfo };
      return response;
    } catch (error) {
      const message = error instanceof Error ? error.message.replaceAll(env.BOT_TOKEN, "[redacted]") : "unknown";
      console.error(JSON.stringify({ scope: "webhook", message: message.slice(0, 300) }));
      return new Response("error", { status: 500 });
    }
  },
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const services = createServices(env);
    ctx.waitUntil(
      processReminders(services.db, services.telegram, new Date()).catch((error: unknown) => {
        const message = error instanceof Error ? error.message.replaceAll(env.BOT_TOKEN, "[redacted]") : "unknown";
        console.error(JSON.stringify({ scope: "cron", message: message.slice(0, 300) }));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
