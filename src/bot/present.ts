import { type Context, type InlineKeyboard } from "grammy";

export async function present(ctx: Context, text: string, markup?: InlineKeyboard): Promise<void> {
  const extra = markup ? { reply_markup: markup } : {};
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    try {
      await ctx.editMessageText(text, extra);
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (message.includes("not modified")) return;
      await ctx.reply(text, extra);
      return;
    }
  }
  await ctx.reply(text, extra);
}

export async function presentMany(ctx: Context, parts: string[], markup?: InlineKeyboard): Promise<void> {
  const [first, ...rest] = parts;
  if (!first) return;
  await present(ctx, first, rest.length === 0 ? markup : undefined);
  for (let index = 0; index < rest.length; index += 1) {
    const text = rest[index];
    if (!text) continue;
    const isLast = index === rest.length - 1;
    await ctx.reply(text, isLast && markup ? { reply_markup: markup } : {});
  }
}

export async function alert(ctx: Context, text: string): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx.answerCallbackQuery({ text: text.slice(0, 180), show_alert: true }).catch(() => undefined);
    return;
  }
  await ctx.reply(text);
}
