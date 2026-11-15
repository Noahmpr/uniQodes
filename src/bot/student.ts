import { InlineKeyboard, type Context } from "grammy";
import { alert, present, presentMany } from "./present";
import { backHome, confirmCancel, confirmRegistration, mainMenu } from "./keyboards";
import type { AppServices } from "../services/app";
import { getChapter, listChapters, listMembers } from "../services/chapter.service";
import { verifyGroupMembership } from "../services/membership.service";
import { cancelOwnRegistration, findRegistrationForUser, registerStudent } from "../services/registration.service";
import { refreshGroupSchedule, renderStoredSchedule, resolveGroupChatId } from "../services/schedule.service";
import { getSettings } from "../services/settings.service";
import { clearSession } from "../services/session.service";
import { upsertUser, type StoredUser } from "../services/user.service";
import { chapterOfferText, helpText, registrationFailureMessage, scheduleStatus, welcomeText } from "../telegram/messages";
import { formatJalaliFull, formatPersianTime } from "../utils/dates";
import { displayName, persianOrdinal, toPersianDigits } from "../utils/persian";
import { isAdmin } from "../utils/security";
import { handleAdminCallback, handleAdminText } from "./admin";

const CALLBACK = /^[a-z0-9:_-]{1,64}$/;

export function requiresAdmin(data: string): boolean {
  return /^(a:|h:|t:|d:|i:|o:|p:|s:|k:|rk:|x:|xy:|g:|w:)/.test(data);
}

async function remember(ctx: Context, services: AppServices): Promise<StoredUser | null> {
  const from = ctx.from;
  if (!from || from.is_bot) return null;
  return upsertUser(services.db, {
    telegramId: from.id,
    firstName: from.first_name,
    lastName: from.last_name ?? null,
    username: from.username ?? null,
    started: true,
  });
}

async function showHome(ctx: Context, services: AppServices, user: StoredUser): Promise<void> {
  const settings = await getSettings(services.db);
  await present(ctx, welcomeText(displayName(user), settings.courseTitle), mainMenu(isAdmin(services.adminIds, user.telegramId)));
}

export async function handleStart(ctx: Context, services: AppServices): Promise<void> {
  const user = await remember(ctx, services);
  if (!user) return;
  await clearSession(services.db, user.telegramId);
  await showHome(ctx, services, user);
}

export async function handleCancel(ctx: Context, services: AppServices): Promise<void> {
  const user = await remember(ctx, services);
  if (!user) return;
  await clearSession(services.db, user.telegramId);
  await present(ctx, "عملیات جاری لغو شد.", mainMenu(isAdmin(services.adminIds, user.telegramId)));
}

export async function handleHelp(ctx: Context, services: AppServices): Promise<void> {
  await remember(ctx, services);
  await present(ctx, helpText(), backHome());
}

export async function handleText(ctx: Context, services: AppServices): Promise<void> {
  const text = ctx.message?.text?.trim();
  const user = await remember(ctx, services);
  if (!user || !text || text.startsWith("/")) return;
  if (text === "انصراف") {
    await handleCancel(ctx, services);
    return;
  }
  const handled = await handleAdminText(ctx, services, user, text);
  if (handled) return;
  await present(ctx, "از دکمه‌های منو استفاده کنید.", mainMenu(isAdmin(services.adminIds, user.telegramId)));
}

export async function handleCallback(ctx: Context, services: AppServices): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data || !CALLBACK.test(data)) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    return;
  }
  const user = await remember(ctx, services);
  if (!user) {
    await ctx.answerCallbackQuery().catch(() => undefined);
    return;
  }
  if (requiresAdmin(data) && !isAdmin(services.adminIds, user.telegramId)) {
    await alert(ctx, "این بخش فقط برای نماینده کلاس است.");
    return;
  }
  if (requiresAdmin(data)) {
    await handleAdminCallback(ctx, services, user, data);
    return;
  }
  if (data === "m:home") return showHome(ctx, services, user);
  if (data === "m:help") return handleHelp(ctx, services);
  if (data === "m:sch") return showSchedule(ctx, services);
  if (data === "m:reg") return showRegistrationList(ctx, services, user);
  if (data === "m:teams") return showTeams(ctx, services);
  if (data === "m:mine" || data === "m:unreg") return showMine(ctx, services, user, data === "m:unreg");
  if (data === "u:yes") return cancelRegistration(ctx, services, user);
  if (data.startsWith("r:")) return showChapterOffer(ctx, services, user, numberAfter(data, "r:"));
  if (data.startsWith("y:")) return confirmRegistrationFor(ctx, services, user, numberAfter(data, "y:"));
  await ctx.answerCallbackQuery().catch(() => undefined);
}

function numberAfter(data: string, prefix: string): number | null {
  const value = Number(data.slice(prefix.length));
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

async function showSchedule(ctx: Context, services: AppServices): Promise<void> {
  const parts = await renderStoredSchedule(services.db);
  await presentMany(ctx, parts, backHome());
}

async function showRegistrationList(ctx: Context, services: AppServices, user: StoredUser): Promise<void> {
  const existing = await findRegistrationForUser(services.db, user.id);
  if (existing) {
    await present(ctx, "شما قبلاً در یک ارائه ثبت‌نام کرده‌اید. هر دانشجو فقط یک فصل می‌تواند داشته باشد.", backHome());
    return;
  }
  const chapters = await listChapters(services.db);
  const open = chapters.filter((chapter) => chapter.status === "scheduled" && chapter.registrationOpen);
  if (open.length === 0) {
    await present(ctx, "در حال حاضر فصلی برای ثبت‌نام باز نیست.", backHome());
    return;
  }
  const selectable = new InlineKeyboard();
  for (const chapter of open) {
    selectable.text(`فصل ${toPersianDigits(chapter.chapterNumber)} – ${chapter.title}`.slice(0, 60), `r:${chapter.id}`).row();
  }
  selectable.text("بازگشت به منو", "m:home");
  await present(ctx, "یک فصل را انتخاب کنید.", selectable);
}

async function showChapterOffer(ctx: Context, services: AppServices, user: StoredUser, chapterId: number | null): Promise<void> {
  if (!chapterId) return alert(ctx, "فصل نامعتبر است.");
  const chapter = await getChapter(services.db, chapterId);
  if (!chapter || chapter.status !== "scheduled") return alert(ctx, "این فصل برای ثبت‌نام در دسترس نیست.");
  const members = await listMembers(services.db, chapter.id);
  const existing = await findRegistrationForUser(services.db, user.id);
  if (existing && existing.chapterId !== chapter.id) return alert(ctx, registrationFailureMessage("already_in_other_chapter"));
  if (existing) return alert(ctx, registrationFailureMessage("already_in_chapter"));
  if (!chapter.registrationOpen || members.length >= 3) {
    await present(ctx, registrationFailureMessage(members.length >= 3 ? "team_full" : "registration_closed"), backHome());
    return;
  }
  await present(
    ctx,
    chapterOfferText({
      chapterNumber: chapter.chapterNumber,
      title: chapter.title,
      presentationDate: chapter.presentationDate,
      presentationTime: chapter.presentationTime,
      registrationOpen: chapter.registrationOpen,
      status: chapter.status,
      members,
    }),
    confirmRegistration(chapter.id),
  );
}

async function confirmRegistrationFor(ctx: Context, services: AppServices, user: StoredUser, chapterId: number | null): Promise<void> {
  if (!chapterId) return alert(ctx, "فصل نامعتبر است.");
  const chatId = await resolveGroupChatId(services.db, services.fallbackGroupChatId);
  if (!chatId) return alert(ctx, "گروه درس هنوز توسط نماینده تنظیم نشده است.");
  const membership = await verifyGroupMembership(services.telegram, chatId, user.telegramId);
  if (membership === "absent") return alert(ctx, registrationFailureMessage("not_member"));
  if (membership === "unknown") return alert(ctx, registrationFailureMessage("membership_unknown"));
  const result = await registerStudent(services.db, {
    userId: user.id,
    chapterId,
    mode: "student",
    hasStartedBot: user.hasStartedBot,
  });
  if (!result.ok) return alert(ctx, registrationFailureMessage(result.reason));
  const warning = await refreshGroupSchedule(services.db, services.telegram, services.fallbackGroupChatId);
  const text = ["ثبت‌نام شما انجام شد.", warning].filter(Boolean).join("\n\n");
  await present(ctx, text, mainMenu(isAdmin(services.adminIds, user.telegramId)));
}

async function showTeams(ctx: Context, services: AppServices): Promise<void> {
  const chapters = await listChapters(services.db);
  if (chapters.length === 0) {
    await present(ctx, "هنوز فصلی ثبت نشده است.", backHome());
    return;
  }
  const lines: string[] = ["گروه‌های ارائه", ""];
  for (const chapter of chapters) {
    const members = await listMembers(services.db, chapter.id);
    const names = members.length > 0 ? members.map((member) => displayName(member)).join("، ") : "هنوز کسی ثبت‌نام نکرده است";
    lines.push(`فصل ${persianOrdinal(chapter.chapterNumber)} – ${chapter.title}`);
    lines.push(names);
    lines.push(
      `وضعیت: ${scheduleStatus({
        chapterNumber: chapter.chapterNumber,
        title: chapter.title,
        presentationDate: chapter.presentationDate,
        presentationTime: chapter.presentationTime,
        registrationOpen: chapter.registrationOpen,
        status: chapter.status,
        members,
      })}`,
    );
    lines.push("");
  }
  await presentMany(ctx, splitText(lines.join("\n")), backHome());
}

async function showMine(ctx: Context, services: AppServices, user: StoredUser, askCancel: boolean): Promise<void> {
  const registration = await findRegistrationForUser(services.db, user.id);
  if (!registration) {
    await present(ctx, "شما در هیچ ارائه‌ای ثبت‌نام نکرده‌اید.", backHome());
    return;
  }
  const chapter = await getChapter(services.db, registration.chapterId);
  if (!chapter) {
    await present(ctx, "ثبت‌نام شما پیدا شد اما فصل مربوط حذف شده است.", backHome());
    return;
  }
  const members = await listMembers(services.db, chapter.id);
  const text = [
    "ارائه شما",
    "",
    `📘 فصل ${persianOrdinal(chapter.chapterNumber)}: ${chapter.title}`,
    `📅 تاریخ: ${chapter.presentationDate ? formatJalaliFull(chapter.presentationDate) : "تعیین نشده"}`,
    `🕙 ساعت: ${chapter.presentationTime ? formatPersianTime(chapter.presentationTime) : "تعیین نشده"}`,
    "",
    "👥 اعضای گروه:",
    ...members.map((member) => (member.userId === user.id ? "شما" : displayName(member))),
    "",
    askCancel ? "ثبت‌نام لغو شود؟" : "برای لغو، دکمه لغو ثبت‌نام را بزنید.",
  ].join("\n");
  await present(ctx, text, askCancel ? confirmCancel() : backHome());
}

async function cancelRegistration(ctx: Context, services: AppServices, user: StoredUser): Promise<void> {
  const result = await cancelOwnRegistration(services.db, user.id);
  if (!result.ok) return alert(ctx, "شما در هیچ ارائه‌ای ثبت‌نام نکرده‌اید.");
  const warning = await refreshGroupSchedule(services.db, services.telegram, services.fallbackGroupChatId);
  const text = [result.reopened ? "ثبت‌نام لغو شد و یک ظرفیت آزاد شد." : "ثبت‌نام لغو شد.", warning].filter(Boolean).join("\n\n");
  await present(ctx, text, mainMenu(isAdmin(services.adminIds, user.telegramId)));
}

function splitText(text: string): string[] {
  if (text.length <= 3800) return [text];
  const parts: string[] = [];
  let rest = text;
  while (rest.length > 3800) {
    const cut = rest.lastIndexOf("\n", 3800);
    const index = cut > 0 ? cut : 3800;
    parts.push(rest.slice(0, index));
    rest = rest.slice(index).trimStart();
  }
  if (rest) parts.push(rest);
  return parts;
}
