import { InlineKeyboard, type Context } from "grammy";
import { alert, present, presentMany } from "./present";
import {
  adminMenu,
  chapterAdminKeyboard,
  promptKeyboard,
  settingsKeyboard,
} from "./keyboards";
import type { AppServices } from "../services/app";
import {
  createChapter,
  findChapterByNumber,
  getChapter,
  listChapters,
  listMembers,
  registrationStats,
  setChapterStatus,
  setRegistrationOpen,
  updateChapterDate,
  updateChapterTime,
  updateChapterTitle,
  type ChapterRecord,
} from "../services/chapter.service";
import { findUserByTelegramId, type StoredUser } from "../services/user.service";
import { registerStudent, removeRegistrationById } from "../services/registration.service";
import { publishSchedule, refreshGroupSchedule, resolveGroupChatId } from "../services/schedule.service";
import { getSettings, setSetting } from "../services/settings.service";
import { clearSession, loadSession, saveSession, type AdminSession } from "../services/session.service";
import { registrationFailureMessage } from "../telegram/messages";
import { formatJalaliFull, formatPersianTime, parseJalaliDate, parseTime } from "../utils/dates";
import { displayName, persianOrdinal, toPersianDigits } from "../utils/persian";
import { isAdmin } from "../utils/security";
import { cleanText, parseChapterNumber, parseGroupIdInput, parseTelegramId, settingTextSchema, titleSchema } from "../utils/validation";

type TextSettingKey = Extract<AdminSession, { state: "set_setting" }>["key"];

const prompts: Record<string, { key: TextSettingKey; text: string }> = {
  "w:course": { key: "course_title", text: "نام درس را بنویسید." },
  "w:prof": { key: "professor_name", text: "نام استاد را بنویسید." },
  "w:book": { key: "book_name", text: "نام کتاب مرجع را بنویسید." },
  "w:sem": { key: "semester_name", text: "نام ترم را بنویسید. مثال: نیم‌سال اول ۱۴۰۴" },
  "w:group": { key: "group_chat_id", text: "شناسه عددی گروه را بفرستید. معمولاً با ‎-100 شروع می‌شود." },
};

export async function handleAdminCallback(ctx: Context, services: AppServices, user: StoredUser, data: string): Promise<void> {
  if (!isAdmin(services.adminIds, user.telegramId)) return alert(ctx, "این بخش فقط برای نماینده کلاس است.");
  if (data === "a:home") return showAdminHome(ctx, services);
  if (data === "a:clear") {
    await clearSession(services.db, user.telegramId);
    return showAdminHome(ctx, services);
  }
  if (data === "a:add") {
    await saveSession(services.db, user.telegramId, { state: "add_number" });
    return present(ctx, "شماره فصل را بفرستید. مثال: ۵", promptKeyboard());
  }
  if (data === "a:chapters") return showChapterList(ctx, services);
  if (data === "a:students") return showStudents(ctx, services);
  if (data === "a:stats") return showStats(ctx, services);
  if (data === "a:settings") return showSettings(ctx, services);
  if (data === "a:publish") return publish(ctx, services);
  if (data === "a:sameday") return toggleSameDay(ctx, services);
  if (data.startsWith("h:")) return showChapter(ctx, services, positive(data.slice(2)));
  if (data.startsWith("t:")) return askText(ctx, services, user, "edit_title", positive(data.slice(2)), "عنوان جدید فصل را بنویسید.");
  if (data.startsWith("d:")) return askText(ctx, services, user, "set_date", positive(data.slice(2)), "تاریخ خورشیدی را بنویسید. مثال: ۱۴۰۴/۰۸/۲۵");
  if (data.startsWith("i:")) return askText(ctx, services, user, "set_time", positive(data.slice(2)), "ساعت را به وقت تهران بنویسید. مثال: ۱۰:۳۰");
  if (data.startsWith("s:")) return askText(ctx, services, user, "add_student", positive(data.slice(2)), "شناسه عددی تلگرام دانشجو را بفرستید. دانشجو باید قبلاً /start زده باشد.");
  if (data.startsWith("o:")) return toggleRegistration(ctx, services, positive(data.slice(2)));
  if (data.startsWith("p:")) return showMembers(ctx, services, positive(data.slice(2)));
  if (data.startsWith("k:")) return askRemove(ctx, pair(data, "k:"));
  if (data.startsWith("rk:")) return removeMember(ctx, services, pair(data, "rk:"));
  if (data.startsWith("x:")) return askCancelChapter(ctx, positive(data.slice(2)));
  if (data.startsWith("xy:")) return cancelChapter(ctx, services, positive(data.slice(3)));
  const status = /^g:(\d+):(done|sched)$/.exec(data);
  if (status?.[1] && status[2]) return changeStatus(ctx, services, Number(status[1]), status[2] === "done" ? "completed" : "scheduled");
  const setting = prompts[data];
  if (setting) {
    await saveSession(services.db, user.telegramId, { state: "set_setting", key: setting.key });
    return present(ctx, setting.text, promptKeyboard());
  }
  await ctx.answerCallbackQuery().catch(() => undefined);
}

export async function handleAdminText(ctx: Context, services: AppServices, user: StoredUser, text: string): Promise<boolean> {
  const session = await loadSession(services.db, user.telegramId);
  if (!session) return false;
  if (!isAdmin(services.adminIds, user.telegramId)) {
    await clearSession(services.db, user.telegramId);
    return false;
  }
  if (session.state === "add_number") return addNumber(ctx, services, user, text);
  if (session.state === "add_title") return addTitle(ctx, services, user, session.chapterNumber, text);
  if (session.state === "edit_title") return editTitle(ctx, services, user, session.chapterId, text);
  if (session.state === "set_date") return editDate(ctx, services, user, session.chapterId, text);
  if (session.state === "set_time") return editTime(ctx, services, user, session.chapterId, text);
  if (session.state === "add_student") return addStudent(ctx, services, user, session.chapterId, text);
  if (session.state === "set_setting") return editSetting(ctx, services, user, session.key, text);
  return false;
}

async function showAdminHome(ctx: Context, services: AppServices): Promise<void> {
  const settings = await getSettings(services.db);
  await present(ctx, `مدیریت ارائه‌های ${settings.courseTitle}\n\nبرنامه ترم را از همین منو، بدون تغییر کد، تنظیم کنید.`, adminMenu());
}

async function showChapterList(ctx: Context, services: AppServices): Promise<void> {
  const chapters = await listChapters(services.db);
  const keyboard = new InlineKeyboard();
  if (chapters.length === 0) {
    keyboard.text("افزودن فصل", "a:add").row().text("بازگشت", "a:home");
    await present(ctx, "هنوز فصلی ثبت نشده است.", keyboard);
    return;
  }
  for (const chapter of chapters.slice(0, 40)) {
    keyboard.text(`فصل ${toPersianDigits(chapter.chapterNumber)} – ${chapter.title}`.slice(0, 60), `h:${chapter.id}`).row();
  }
  keyboard.text("بازگشت", "a:home");
  await present(ctx, "یک فصل را برای مدیریت انتخاب کنید.", keyboard);
}

async function showChapter(ctx: Context, services: AppServices, id: number | null): Promise<void> {
  if (!id) return alert(ctx, "فصل نامعتبر است.");
  const chapter = await getChapter(services.db, id);
  if (!chapter) return alert(ctx, "فصل پیدا نشد.");
  const members = await listMembers(services.db, id);
  await present(ctx, chapterSummary(chapter, members.length), chapterAdminKeyboard(chapter.id, chapter.registrationOpen));
}

async function showMembers(ctx: Context, services: AppServices, id: number | null): Promise<void> {
  if (!id) return alert(ctx, "فصل نامعتبر است.");
  const chapter = await getChapter(services.db, id);
  if (!chapter) return alert(ctx, "فصل پیدا نشد.");
  const members = await listMembers(services.db, id);
  const keyboard = new InlineKeyboard();
  const lines = [`اعضای فصل ${persianOrdinal(chapter.chapterNumber)}`, ""];
  if (members.length === 0) lines.push("هنوز کسی ثبت‌نام نکرده است.");
  for (const member of members) {
    lines.push(`${displayName(member)} — ${toPersianDigits(member.telegramId)}`);
    keyboard.text(`حذف ${displayName(member)}`.slice(0, 40), `k:${member.registrationId}:${chapter.id}`).row();
  }
  lines.push("", "برای جابه‌جایی دانشجو، ابتدا او را از فصل فعلی حذف کنید.");
  keyboard.text("بازگشت", `h:${chapter.id}`);
  await present(ctx, lines.join("\n"), keyboard);
}

async function askRemove(ctx: Context, ids: [number, number] | null): Promise<void> {
  if (!ids) return alert(ctx, "درخواست نامعتبر است.");
  const [registrationId, chapterId] = ids;
  const keyboard = new InlineKeyboard().text("بله، حذف شود", `rk:${registrationId}:${chapterId}`).row().text("انصراف", `p:${chapterId}`);
  await present(ctx, "این دانشجو از گروه ارائه حذف شود؟", keyboard);
}

async function removeMember(ctx: Context, services: AppServices, ids: [number, number] | null): Promise<void> {
  if (!ids) return alert(ctx, "درخواست نامعتبر است.");
  const removed = await removeRegistrationById(services.db, ids[0]);
  if (!removed.ok) return alert(ctx, "این ثبت‌نام پیدا نشد.");
  const warning = await refreshGroupSchedule(services.db, services.telegram, services.fallbackGroupChatId);
  await present(ctx, ["دانشجو از گروه حذف شد.", warning].filter(Boolean).join("\n\n"), new InlineKeyboard().text("بازگشت", `h:${removed.chapterId}`));
}

async function showStudents(ctx: Context, services: AppServices): Promise<void> {
  const chapters = await listChapters(services.db);
  if (chapters.length === 0) return present(ctx, "هنوز فصلی ثبت نشده است.", adminMenu());
  const chunks: string[] = [];
  let current = "دانشجویان ثبت‌نام‌شده";
  for (const chapter of chapters) {
    const members = await listMembers(services.db, chapter.id);
    const block = [
      "",
      `فصل ${persianOrdinal(chapter.chapterNumber)} – ${chapter.title}`,
      members.length === 0
        ? "بدون عضو"
        : members.map((member) => `• ${displayName(member)} — ${toPersianDigits(member.telegramId)}`).join("\n"),
    ].join("\n");
    if (current.length + block.length > 3500) {
      chunks.push(current);
      current = block.trim();
    } else current += block;
  }
  chunks.push(current);
  await presentMany(ctx, chunks, adminMenu());
}

async function showStats(ctx: Context, services: AppServices): Promise<void> {
  const [stats, settings] = await Promise.all([registrationStats(services.db), getSettings(services.db)]);
  await present(
    ctx,
    [
      "آمار ثبت‌نام",
      `ربات را شروع کرده‌اند: ${toPersianDigits(stats.students)}`,
      `فصل‌ها: ${toPersianDigits(stats.chapters)}`,
      `ثبت‌نام باز: ${toPersianDigits(stats.openChapters)}`,
      `ثبت‌نام‌ها: ${toPersianDigits(stats.registrations)}`,
      `فصل‌های تکمیل‌شده: ${toPersianDigits(stats.fullChapters)}`,
      `یادآوری روز ارائه: ${settings.sameDayReminderEnabled ? "فعال" : "خاموش"}`,
    ].join("\n"),
    adminMenu(),
  );
}

async function showSettings(ctx: Context, services: AppServices): Promise<void> {
  const settings = await getSettings(services.db);
  const group = (await resolveGroupChatId(services.db, services.fallbackGroupChatId)) ?? "تنظیم نشده";
  await present(
    ctx,
    [
      "تنظیمات ترم",
      `درس: ${settings.courseTitle || "تعیین نشده"}`,
      `استاد: ${settings.professorName || "تعیین نشده"}`,
      `کتاب: ${settings.bookName || "تعیین نشده"}`,
      `ترم: ${settings.semesterName || "تعیین نشده"}`,
      `گروه: ${group}`,
      `منطقه زمانی: ${settings.timezone}`,
    ].join("\n"),
    settingsKeyboard(settings.sameDayReminderEnabled),
  );
}

async function toggleSameDay(ctx: Context, services: AppServices): Promise<void> {
  const settings = await getSettings(services.db);
  await setSetting(services.db, "same_day_reminder_enabled", settings.sameDayReminderEnabled ? "false" : "true");
  await showSettings(ctx, services);
}

async function publish(ctx: Context, services: AppServices): Promise<void> {
  const chatId = await resolveGroupChatId(services.db, services.fallbackGroupChatId);
  if (!chatId) return present(ctx, "ابتدا شناسه گروه را در تنظیمات وارد کنید.", adminMenu());
  try {
    const result = await publishSchedule(services.db, services.telegram, chatId);
    const lines = [
      "پیام برنامه در گروه به‌روز شد.",
      `تعداد بخش‌ها: ${toPersianDigits(result.parts)}`,
      result.pinned ? "پیام پین شد." : "پین انجام نشد. ربات باید در گروه ادمین باشد و اجازه پین داشته باشد.",
    ];
    if (result.recreated) lines.push("پیام قبلی در دسترس نبود و پیام جدید ساخته شد.");
    await present(ctx, lines.join("\n"), adminMenu());
  } catch {
    await present(ctx, "ارسال پیام گروه ناموفق بود. عضویت و دسترسی ربات را بررسی کنید.", adminMenu());
  }
}

async function toggleRegistration(ctx: Context, services: AppServices, id: number | null): Promise<void> {
  if (!id) return alert(ctx, "فصل نامعتبر است.");
  const chapter = await getChapter(services.db, id);
  if (!chapter) return alert(ctx, "فصل پیدا نشد.");
  const outcome = await setRegistrationOpen(services.db, id, !chapter.registrationOpen);
  if (outcome === "full") return alert(ctx, "ظرفیت این فصل پر است و ثبت‌نام باز نمی‌شود.");
  if (outcome !== "updated") return alert(ctx, "وضعیت این ارائه اجازه تغییر ثبت‌نام را نمی‌دهد.");
  const warning = await refreshGroupSchedule(services.db, services.telegram, services.fallbackGroupChatId);
  await present(ctx, ["وضعیت ثبت‌نام تغییر کرد.", warning].filter(Boolean).join("\n\n"), chapterAdminKeyboard(id, !chapter.registrationOpen));
}

async function changeStatus(ctx: Context, services: AppServices, id: number, status: "completed" | "scheduled"): Promise<void> {
  const updated = await setChapterStatus(services.db, id, status);
  if (!updated) return alert(ctx, "فصل پیدا نشد.");
  const warning = await refreshGroupSchedule(services.db, services.telegram, services.fallbackGroupChatId);
  await present(ctx, ["وضعیت ارائه تغییر کرد.", warning].filter(Boolean).join("\n\n"), new InlineKeyboard().text("بازگشت", `h:${id}`));
}

async function askCancelChapter(ctx: Context, id: number | null): Promise<void> {
  if (!id) return alert(ctx, "فصل نامعتبر است.");
  const keyboard = new InlineKeyboard().text("بله، ارائه لغو شود", `xy:${id}`).row().text("انصراف", `h:${id}`);
  await present(ctx, "این ارائه لغو شود؟ ثبت‌نام آن هم بسته می‌شود.", keyboard);
}

async function cancelChapter(ctx: Context, services: AppServices, id: number | null): Promise<void> {
  if (!id) return alert(ctx, "فصل نامعتبر است.");
  const updated = await setChapterStatus(services.db, id, "cancelled");
  if (!updated) return alert(ctx, "فصل پیدا نشد.");
  const warning = await refreshGroupSchedule(services.db, services.telegram, services.fallbackGroupChatId);
  await present(ctx, ["ارائه لغو شد.", warning].filter(Boolean).join("\n\n"), adminMenu());
}

async function askText(
  ctx: Context,
  services: AppServices,
  user: StoredUser,
  state: "edit_title" | "set_date" | "set_time" | "add_student",
  chapterId: number | null,
  text: string,
): Promise<void> {
  if (!chapterId) return alert(ctx, "فصل نامعتبر است.");
  const session: AdminSession =
    state === "edit_title"
      ? { state, chapterId }
      : state === "set_date"
        ? { state, chapterId }
        : state === "set_time"
          ? { state, chapterId }
          : { state, chapterId };
  await saveSession(services.db, user.telegramId, session);
  await present(ctx, text, promptKeyboard());
}

async function addNumber(ctx: Context, services: AppServices, user: StoredUser, text: string): Promise<boolean> {
  const chapterNumber = parseChapterNumber(text);
  if (!chapterNumber) {
    await ctx.reply("شماره فصل باید عددی بین ۱ و ۲۰۰ باشد.");
    return true;
  }
  if (await findChapterByNumber(services.db, chapterNumber)) {
    await ctx.reply("این شماره فصل قبلاً ثبت شده است.");
    return true;
  }
  await saveSession(services.db, user.telegramId, { state: "add_title", chapterNumber });
  await ctx.reply("عنوان فصل را بنویسید.", { reply_markup: promptKeyboard() });
  return true;
}

async function addTitle(ctx: Context, services: AppServices, user: StoredUser, chapterNumber: number, text: string): Promise<boolean> {
  const title = titleSchema.safeParse(cleanText(text));
  if (!title.success) {
    await ctx.reply("عنوان باید بین ۲ تا ۲۰۰ نویسه باشد.");
    return true;
  }
  const created = await createChapter(services.db, { chapterNumber, title: title.data });
  await clearSession(services.db, user.telegramId);
  if (!created.ok) {
    await ctx.reply("این شماره فصل قبلاً ثبت شده است.");
    return true;
  }
  const warning = await refreshGroupSchedule(services.db, services.telegram, services.fallbackGroupChatId);
  await ctx.reply(["فصل اضافه شد. حالا تاریخ و ساعت را تنظیم کنید.", warning].filter(Boolean).join("\n\n"), {
    reply_markup: chapterAdminKeyboard(created.id, true),
  });
  return true;
}

async function editTitle(ctx: Context, services: AppServices, user: StoredUser, chapterId: number, text: string): Promise<boolean> {
  const title = titleSchema.safeParse(cleanText(text));
  if (!title.success) {
    await ctx.reply("عنوان باید بین ۲ تا ۲۰۰ نویسه باشد.");
    return true;
  }
  const updated = await updateChapterTitle(services.db, chapterId, title.data);
  await clearSession(services.db, user.telegramId);
  if (!updated) {
    await ctx.reply("فصل پیدا نشد.");
    return true;
  }
  await finishChapterEdit(ctx, services, chapterId, "عنوان فصل ذخیره شد.");
  return true;
}

async function editDate(ctx: Context, services: AppServices, user: StoredUser, chapterId: number, text: string): Promise<boolean> {
  const date = parseJalaliDate(text);
  if (!date) {
    await ctx.reply("تاریخ معتبر نیست. مثال: ۱۴۰۴/۰۸/۲۵");
    return true;
  }
  const updated = await updateChapterDate(services.db, chapterId, date);
  await clearSession(services.db, user.telegramId);
  if (!updated) {
    await ctx.reply("فصل پیدا نشد.");
    return true;
  }
  await finishChapterEdit(ctx, services, chapterId, `تاریخ ذخیره شد: ${formatJalaliFull(date)}`);
  return true;
}

async function editTime(ctx: Context, services: AppServices, user: StoredUser, chapterId: number, text: string): Promise<boolean> {
  const time = parseTime(text);
  if (!time) {
    await ctx.reply("ساعت معتبر نیست. مثال: ۱۰:۳۰");
    return true;
  }
  const updated = await updateChapterTime(services.db, chapterId, time);
  await clearSession(services.db, user.telegramId);
  if (!updated) {
    await ctx.reply("فصل پیدا نشد.");
    return true;
  }
  await finishChapterEdit(ctx, services, chapterId, `ساعت ذخیره شد: ${formatPersianTime(time)}`);
  return true;
}

async function addStudent(ctx: Context, services: AppServices, user: StoredUser, chapterId: number, text: string): Promise<boolean> {
  const telegramId = parseTelegramId(text);
  if (!telegramId) {
    await ctx.reply("شناسه تلگرام باید فقط عدد باشد.");
    return true;
  }
  const student = await findUserByTelegramId(services.db, telegramId);
  if (!student) {
    await clearSession(services.db, user.telegramId);
    await ctx.reply(registrationFailureMessage("user_not_found"));
    return true;
  }
  const result = await registerStudent(services.db, {
    userId: student.id,
    chapterId,
    mode: "admin",
    hasStartedBot: student.hasStartedBot,
  });
  await clearSession(services.db, user.telegramId);
  if (!result.ok) {
    await ctx.reply(registrationFailureMessage(result.reason));
    return true;
  }
  const warning = await refreshGroupSchedule(services.db, services.telegram, services.fallbackGroupChatId);
  await ctx.reply(["دانشجو به فصل اضافه شد.", warning].filter(Boolean).join("\n\n"), {
    reply_markup: new InlineKeyboard().text("بازگشت", `h:${chapterId}`),
  });
  return true;
}

async function editSetting(ctx: Context, services: AppServices, user: StoredUser, key: TextSettingKey, text: string): Promise<boolean> {
  if (key === "group_chat_id") {
    const groupId = parseGroupIdInput(text);
    if (!groupId) {
      await ctx.reply("شناسه گروه معتبر نیست.");
      return true;
    }
    await setSetting(services.db, key, groupId);
  } else {
    const parsed = settingTextSchema.safeParse(cleanText(text));
    if (!parsed.success) {
      await ctx.reply("متن باید بین ۲ تا ۱۲۰ نویسه باشد.");
      return true;
    }
    await setSetting(services.db, key, parsed.data);
  }
  await clearSession(services.db, user.telegramId);
  const warning = await refreshGroupSchedule(services.db, services.telegram, services.fallbackGroupChatId);
  await ctx.reply(["تنظیمات ذخیره شد.", warning].filter(Boolean).join("\n\n"), { reply_markup: settingsKeyboard((await getSettings(services.db)).sameDayReminderEnabled) });
  return true;
}

async function finishChapterEdit(ctx: Context, services: AppServices, chapterId: number, message: string): Promise<void> {
  const warning = await refreshGroupSchedule(services.db, services.telegram, services.fallbackGroupChatId);
  const chapter = await getChapter(services.db, chapterId);
  await ctx.reply([message, warning].filter(Boolean).join("\n\n"), {
    reply_markup: chapter ? chapterAdminKeyboard(chapter.id, chapter.registrationOpen) : adminMenu(),
  });
}

function chapterSummary(chapter: ChapterRecord, count: number): string {
  const status = chapter.status === "scheduled" ? "برنامه‌ریزی‌شده" : chapter.status === "completed" ? "برگزار شده" : "لغو شده";
  return [
    `فصل ${persianOrdinal(chapter.chapterNumber)}: ${chapter.title}`,
    `تاریخ: ${chapter.presentationDate ? formatJalaliFull(chapter.presentationDate) : "تعیین نشده"}`,
    `ساعت: ${chapter.presentationTime ? formatPersianTime(chapter.presentationTime) : "تعیین نشده"}`,
    `ثبت‌نام: ${chapter.registrationOpen ? "باز" : "بسته"}`,
    `وضعیت: ${status}`,
    `اعضا: ${toPersianDigits(count)} از ۳`,
  ].join("\n");
}

function positive(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

function pair(data: string, prefix: string): [number, number] | null {
  const [left, right] = data.slice(prefix.length).split(":");
  const first = Number(left);
  const second = Number(right);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(second) || first <= 0 || second <= 0) return null;
  return [first, second];
}
