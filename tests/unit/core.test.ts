import { describe, expect, it } from "vitest";
import { getTableColumns, getTableName } from "drizzle-orm";
import { readFileSync } from "node:fs";
import {
  chapters,
  registrations,
  reminderLogs,
  sessions,
  settings,
  telegramMessages,
  users,
} from "../../src/database/schema";
import {
  addGregorianDays,
  formatJalaliDayMonth,
  gregorianToJalali,
  jalaliToGregorian,
  parseJalaliDate,
  parseTime,
  tehranDateTimeToUtc,
  tehranToday,
} from "../../src/utils/dates";
import { isAdmin, isWebhookAuthorized, parseAdminIds, safeEqual } from "../../src/utils/security";
import { dueReminderTypes } from "../../src/services/reminder.service";

const migration = readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8");

describe("schema and migration", () => {
  it("keeps drizzle columns in the sql migration", () => {
    for (const table of [users, chapters, registrations, telegramMessages, reminderLogs, settings, sessions]) {
      expect(migration).toContain(`CREATE TABLE ${getTableName(table)}`);
      for (const column of Object.values(getTableColumns(table))) {
        expect(migration).toContain(column.name);
      }
    }
    expect(migration).toContain("CHAPTER_FULL");
    expect(migration).toContain("UNIQUE (user_id, chapter_id)");
  });
});

describe("jalali and tehran time", () => {
  it("converts nowruz 1403", () => {
    expect(jalaliToGregorian(1403, 1, 1)).toEqual([2024, 3, 20]);
    expect(gregorianToJalali(2024, 3, 20)).toEqual([1403, 1, 1]);
    expect(formatJalaliDayMonth("2024-03-20")).toBe("۱ فروردین");
  });

  it("round-trips three years of dates", () => {
    const cursor = new Date(Date.UTC(2024, 0, 1));
    const end = new Date(Date.UTC(2027, 0, 1));
    while (cursor < end) {
      const year = cursor.getUTCFullYear();
      const month = cursor.getUTCMonth() + 1;
      const day = cursor.getUTCDate();
      const [jy, jm, jd] = gregorianToJalali(year, month, day);
      expect(jalaliToGregorian(jy, jm, jd)).toEqual([year, month, day]);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  });

  it("parses persian dates and tehran wall time", () => {
    expect(parseJalaliDate("۱۴۰۳/۰۱/۰۱")).toBe("2024-03-20");
    expect(parseJalaliDate("1403/12/31")).toBeNull();
    expect(parseTime("۱۰:۳۰")).toBe("10:30");
    expect(parseTime("24:00")).toBeNull();
    expect(tehranDateTimeToUtc("2026-11-15", "10:00").toISOString()).toBe("2026-11-15T06:30:00.000Z");
    expect(tehranToday(new Date("2026-11-15T21:00:00.000Z"))).toBe("2026-11-16");
    expect(addGregorianDays("2026-11-15", 3)).toBe("2026-11-18");
  });
});

describe("reminder windows", () => {
  const presentationDate = "2026-11-18";
  const presentationTime = "10:00";
  const start = tehranDateTimeToUtc(presentationDate, presentationTime);

  it("opens the three-day reminder at the same clock time", () => {
    expect(dueReminderTypes({ presentationDate, presentationTime, now: new Date(start.getTime() - 3 * 86400000), sameDayEnabled: true })).toEqual(["three_days"]);
    expect(dueReminderTypes({ presentationDate, presentationTime, now: new Date(start.getTime() - 3 * 86400000 - 60_000), sameDayEnabled: true })).toEqual([]);
  });

  it("keeps one-day and same-day windows separate", () => {
    expect(dueReminderTypes({ presentationDate, presentationTime, now: new Date(start.getTime() - 86400000), sameDayEnabled: true })).toEqual(["one_day"]);
    const morning = tehranDateTimeToUtc(presentationDate, "08:00");
    expect(dueReminderTypes({ presentationDate, presentationTime, now: morning, sameDayEnabled: true })).toEqual(["same_day"]);
    expect(dueReminderTypes({ presentationDate, presentationTime, now: morning, sameDayEnabled: false })).toEqual([]);
    expect(dueReminderTypes({ presentationDate, presentationTime, now: start, sameDayEnabled: true })).toEqual([]);
  });
});

describe("access control", () => {
  it("identifies admins by telegram id", () => {
    const admins = parseAdminIds(" 42, 7\n99 ");
    expect(isAdmin(admins, 42)).toBe(true);
    expect(isAdmin(admins, 43)).toBe(false);
    expect(isAdmin(admins, undefined)).toBe(false);
  });

  it("rejects a missing or mismatched webhook secret", () => {
    const secret = "a".repeat(32);
    expect(safeEqual(secret, secret)).toBe(true);
    expect(safeEqual(secret, `${secret}x`)).toBe(false);
    expect(isWebhookAuthorized(secret, secret)).toBe(true);
    expect(isWebhookAuthorized("wrong-secret-value", secret)).toBe(false);
    expect(isWebhookAuthorized(null, secret)).toBe(false);
    expect(isWebhookAuthorized(secret, "short")).toBe(false);
  });
});
