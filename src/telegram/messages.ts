import { formatJalaliDayMonth, formatJalaliFull, formatPersianTime } from "../utils/dates";
import { displayName, persianOrdinal, toPersianDigits } from "../utils/persian";

export type ChapterStatus = "scheduled" | "completed" | "cancelled";
export type ReminderType = "three_days" | "one_day" | "same_day";
export type RegistrationFailure =
  | "chapter_not_found"
  | "chapter_inactive"
  | "registration_closed"
  | "already_in_chapter"
  | "already_in_other_chapter"
  | "team_full"
  | "not_member"
  | "membership_unknown"
  | "not_started"
  | "user_not_found";

export interface ScheduleMember {
  firstName: string;
  lastName: string | null;
}

export interface ScheduleChapter {
  chapterNumber: number;
  title: string;
  presentationDate: string | null;
  presentationTime: string | null;
  registrationOpen: boolean;
  status: ChapterStatus;
  members: ScheduleMember[];
}

export interface ScheduleInput {
  courseTitle: string;
  professorName: string;
  bookName: string;
  semesterName: string;
  chapters: ScheduleChapter[];
}

const DIVIDER = "━━━━━━━━━━━━━━";
const MESSAGE_LIMIT = 3900;

export function scheduleStatus(chapter: ScheduleChapter): string {
  if (chapter.status === "cancelled") return "لغو شده";
  if (chapter.status === "completed") return "برگزار شده";
  const count = chapter.members.length;
  if (count >= 3) return "تکمیل شده";
  if (!chapter.registrationOpen) return "ثبت‌نام بسته";
  if (count >= 2) return "در حال تکمیل";
  return "ثبت‌نام باز";
}

function memberLines(chapter: ScheduleChapter): string {
  if (chapter.members.length === 0) return "👥 هنوز کسی ثبت‌نام نکرده است.";
  const lines = ["👥 اعضای گروه:", ""];
  for (const member of chapter.members) lines.push(displayName(member));
  if (chapter.status === "scheduled") {
    for (let slot = chapter.members.length; slot < 3; slot += 1) lines.push("ظرفیت خالی");
  }
  return lines.join("\n");
}

function chapterBlock(chapter: ScheduleChapter, sessionNumber: number): string {
  const dateText = chapter.presentationDate ? formatJalaliDayMonth(chapter.presentationDate) : "تاریخ تعیین نشده";
  const timeText = chapter.presentationTime ? `، ساعت ${formatPersianTime(chapter.presentationTime)}` : "";
  return [
    `📅 جلسه ${persianOrdinal(sessionNumber)} – ${dateText}${timeText}`,
    "",
    `📘 فصل ${persianOrdinal(chapter.chapterNumber)}: ${chapter.title}`,
    "",
    memberLines(chapter),
    `وضعیت: ${scheduleStatus(chapter)}`,
  ].join("\n");
}

export function buildScheduleMessages(input: ScheduleInput): string[] {
  const header = [
    `📚 برنامه ارائه‌های درس ${input.courseTitle || "بینایی کامپیوتر"}`,
    "",
    `👨‍🏫 استاد: ${input.professorName || "تعیین نشده"}`,
    `📖 کتاب مرجع: ${input.bookName || "تعیین نشده"}`,
  ];
  if (input.semesterName) header.push(`🗓 ترم: ${input.semesterName}`);
  const blocks = input.chapters.map((chapter, index) => chapterBlock(chapter, index + 1));
  if (blocks.length === 0) {
    return [[...header, "", "هنوز فصلی ثبت نشده است."].join("\n")];
  }
  const pages: string[][] = [];
  let current: string[] = [];
  let size = header.join("\n").length;
  for (const block of blocks) {
    const extra = block.length + DIVIDER.length + 4;
    if (current.length > 0 && size + extra > MESSAGE_LIMIT) {
      pages.push(current);
      current = [];
      size = header.join("\n").length;
    }
    current.push(block);
    size += extra;
  }
  if (current.length > 0) pages.push(current);
  return pages.map((page, index) => {
    const pageHeader =
      pages.length === 1
        ? header
        : [...header, "", `بخش ${toPersianDigits(index + 1)} از ${toPersianDigits(pages.length)}`];
    return [...pageHeader, ...page].join(`\n\n${DIVIDER}\n\n`);
  });
}

export function registrationFailureMessage(reason: RegistrationFailure): string {
  switch (reason) {
    case "chapter_not_found":
      return "این فصل پیدا نشد.";
    case "chapter_inactive":
      return "ثبت‌نام برای این ارائه ممکن نیست.";
    case "registration_closed":
      return "ثبت‌نام این فصل بسته است.";
    case "already_in_chapter":
      return "شما قبلاً در همین فصل ثبت‌نام کرده‌اید.";
    case "already_in_other_chapter":
      return "هر دانشجو فقط می‌تواند در یک ارائه عضو باشد. ابتدا ثبت‌نام فعلی را لغو کنید.";
    case "team_full":
      return "ظرفیت این فصل تکمیل شده است. هر فصل حداکثر ۳ دانشجو دارد.";
    case "not_member":
      return "برای ثبت‌نام باید عضو گروه رسمی درس باشید.";
    case "membership_unknown":
      return "بررسی عضویت گروه فعلاً ممکن نیست. کمی بعد دوباره تلاش کنید.";
    case "not_started":
      return "این دانشجو هنوز ربات را راه‌اندازی نکرده است و باید یک‌بار /start را بزند.";
    case "user_not_found":
      return "دانشجویی با این شناسه تلگرام پیدا نشد.";
  }
}

export function renderReminder(input: {
  courseTitle: string;
  firstName: string;
  kind: ReminderType;
  chapterNumber: number;
  title: string;
  dateLabel: string;
  timeLabel: string;
  members: Array<{ name: string; isSelf: boolean }>;
}): string {
  const lead = {
    three_days: "یادآوری می‌کنیم که سه روز دیگر ارائه شما برگزار می‌شود.",
    one_day: "یادآوری می‌کنیم که فردا ارائه شما برگزار می‌شود.",
    same_day: "یادآوری می‌کنیم که ارائه شما امروز برگزار می‌شود.",
  }[input.kind];
  return [
    `🔔 یادآوری ارائه درس ${input.courseTitle}`,
    "",
    `سلام ${input.firstName}`,
    "",
    lead,
    "",
    `📘 موضوع: فصل ${persianOrdinal(input.chapterNumber)} – ${input.title}`,
    `📅 تاریخ: ${input.dateLabel}`,
    `🕙 ساعت: ${input.timeLabel}`,
    "",
    "👥 اعضای گروه:",
    "",
    ...input.members.map((member) => (member.isSelf ? "شما" : member.name)),
    "",
    "لطفاً برای ارائه آماده باشید.",
  ].join("\n");
}

export function helpText(): string {
  return [
    "راهنمای ربات ارائه",
    "",
    "۱. عضو گروه رسمی درس شوید.",
    "۲. همین‌جا /start را بزنید تا پیام خصوصی به شما برسد.",
    "۳. یک فصل را انتخاب کنید و ثبت‌نام را تأیید کنید.",
    "۴. هر دانشجو فقط در یک فصل عضو می‌شود.",
    "۵. هر فصل حداکثر ۳ نفر ظرفیت دارد.",
    "۶. سه روز قبل و یک روز قبل از ارائه یادآوری خصوصی می‌گیرید.",
    "",
    "اگر ربات را مسدود کنید، یادآوری ارسال نمی‌شود.",
  ].join("\n");
}

export function welcomeText(name: string, courseTitle: string): string {
  return [
    `سلام ${name}!`,
    `به ربات مدیریت ارائه‌های درس ${courseTitle} خوش آمدید.`,
    "",
    "از دکمه‌های زیر یک گزینه را انتخاب کنید.",
  ].join("\n");
}

export function chapterOfferText(chapter: ScheduleChapter): string {
  const date = chapter.presentationDate ? formatJalaliFull(chapter.presentationDate) : "هنوز تعیین نشده";
  const time = chapter.presentationTime ? formatPersianTime(chapter.presentationTime) : "هنوز تعیین نشده";
  return [
    `📘 فصل ${persianOrdinal(chapter.chapterNumber)}: ${chapter.title}`,
    `📅 تاریخ: ${date}`,
    `🕙 ساعت: ${time}`,
    `👥 اعضای فعلی: ${toPersianDigits(chapter.members.length)} از ۳`,
    `وضعیت: ${scheduleStatus(chapter)}`,
    "",
    chapter.presentationDate && chapter.presentationTime
      ? "ثبت‌نام را تأیید می‌کنید؟"
      : "تاریخ یا ساعت هنوز کامل نشده است. اگر مطمئن هستید، ثبت‌نام را تأیید کنید.",
  ].join("\n");
}

export { formatJalaliFull, formatPersianTime };
