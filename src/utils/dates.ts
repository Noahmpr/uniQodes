import { toEnglishDigits, toPersianDigits } from "./persian";

export const TEHRAN_OFFSET_MS = (3 * 60 + 30) * 60 * 1000;
export const DAY_MS = 24 * 60 * 60 * 1000;

export const JALALI_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;

function div(value: number, by: number): number {
  return Math.trunc(value / by);
}

export function gregorianToJalali(gy: number, gm: number, gd: number): [number, number, number] {
  const monthDays = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334];
  const gy2 = gm > 2 ? gy + 1 : gy;
  let days =
    355666 +
    365 * gy +
    div(gy2 + 3, 4) -
    div(gy2 + 99, 100) +
    div(gy2 + 399, 400) +
    gd +
    (monthDays[gm - 1] ?? 0);
  let jy = -1595 + 33 * div(days, 12053);
  days %= 12053;
  jy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    jy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  if (days < 186) {
    return [jy, 1 + div(days, 31), 1 + (days % 31)];
  }
  return [jy, 7 + div(days - 186, 30), 1 + ((days - 186) % 30)];
}

export function jalaliToGregorian(jy: number, jm: number, jd: number): [number, number, number] {
  const year = jy + 1595;
  let days =
    -355668 +
    365 * year +
    div(year, 33) * 8 +
    div((year % 33) + 3, 4) +
    jd +
    (jm < 7 ? (jm - 1) * 31 : (jm - 7) * 30 + 186);
  let gy = 400 * div(days, 146097);
  days %= 146097;
  if (days > 36524) {
    gy += 100 * div(--days, 36524);
    days %= 36524;
    if (days >= 365) days += 1;
  }
  gy += 4 * div(days, 1461);
  days %= 1461;
  if (days > 365) {
    gy += div(days - 1, 365);
    days = (days - 1) % 365;
  }
  let gd = days + 1;
  const leap = (gy % 4 === 0 && gy % 100 !== 0) || gy % 400 === 0;
  const monthLengths = [0, 31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let gm = 0;
  for (; gm < 13 && gd > (monthLengths[gm] ?? 0); gm += 1) {
    gd -= monthLengths[gm] ?? 0;
  }
  return [gy, gm, gd];
}

export function tehranDateTimeToUtc(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1, hour ?? 0, minute ?? 0) - TEHRAN_OFFSET_MS);
}

export function tehranStartOfDayUtc(date: string): Date {
  return tehranDateTimeToUtc(date, "00:00");
}

export function tehranToday(now: Date): string {
  return new Date(now.getTime() + TEHRAN_OFFSET_MS).toISOString().slice(0, 10);
}

export function addGregorianDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days)).toISOString().slice(0, 10);
}

export function formatIsoDate(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function formatJalaliDayMonth(gregorianIso: string): string {
  const [year, month, day] = gregorianIso.split("-").map(Number);
  const [, jm, jd] = gregorianToJalali(year ?? 0, month ?? 1, day ?? 1);
  return `${toPersianDigits(jd)} ${JALALI_MONTHS[jm - 1] ?? ""}`;
}

export function formatJalaliFull(gregorianIso: string): string {
  const [year, month, day] = gregorianIso.split("-").map(Number);
  const [jy, jm, jd] = gregorianToJalali(year ?? 0, month ?? 1, day ?? 1);
  return `${toPersianDigits(jd)} ${JALALI_MONTHS[jm - 1] ?? ""} ${toPersianDigits(jy)}`;
}

export function formatPersianTime(time: string): string {
  return toPersianDigits(time);
}

export function parseTime(input: string): string | null {
  const normalized = toEnglishDigits(input).trim().replace(".", ":");
  const match = /^(\d{1,2}):(\d{2})$/.exec(normalized);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseJalaliDate(input: string): string | null {
  const normalized = toEnglishDigits(input).trim().replace(/-/g, "/");
  const match = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(normalized);
  if (!match) return null;
  const jy = Number(match[1]);
  const jm = Number(match[2]);
  const jd = Number(match[3]);
  if (jy < 1300 || jy > 1500 || jm < 1 || jm > 12 || jd < 1) return null;
  const maxDay = jm <= 6 ? 31 : jm <= 11 ? 30 : 30;
  if (jd > maxDay) return null;
  const [gy, gm, gd] = jalaliToGregorian(jy, jm, jd);
  const [backY, backM, backD] = gregorianToJalali(gy, gm, gd);
  if (backY !== jy || backM !== jm || backD !== jd) return null;
  return formatIsoDate(gy, gm, gd);
}

export function nowIso(now = new Date()): string {
  return now.toISOString();
}
