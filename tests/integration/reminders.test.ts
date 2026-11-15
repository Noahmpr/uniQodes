import { describe, expect, it } from "vitest";
import { TelegramApiError, type TelegramClient } from "../../src/telegram/api";
import { createChapter, updateChapterDate, updateChapterTime } from "../../src/services/chapter.service";
import { registerStudent } from "../../src/services/registration.service";
import { processReminders } from "../../src/services/reminder.service";
import { setSetting } from "../../src/services/settings.service";
import { upsertUser } from "../../src/services/user.service";
import { tehranDateTimeToUtc } from "../../src/utils/dates";
import { createTestDb } from "../helpers/db";

function scriptedApi(mode: "ok" | "blocked" | "retry") {
  const sent: string[] = [];
  const client: TelegramClient = {
    async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
      if (method !== "sendMessage") return {} as T;
      if (mode === "blocked") throw new TelegramApiError(403, 403, "Forbidden: bot was blocked by the user", null);
      if (mode === "retry") throw new TelegramApiError(500, 500, "internal server error", null);
      sent.push(String(body.text));
      return { message_id: 1 } as T;
    },
  };
  return { client, sent };
}

describe("reminders", () => {
  it("sends one three-day reminder and does not duplicate it", async () => {
    const db = createTestDb();
    const chapter = await createChapter(db, { chapterNumber: 5, title: "فصل پنجم" });
    if (!chapter.ok) throw new Error("chapter");
    const date = "2026-11-18";
    await updateChapterDate(db, chapter.id, date);
    await updateChapterTime(db, chapter.id, "10:00");
    const ali = await upsertUser(db, { telegramId: 11, firstName: "علی", lastName: "رضایی", username: null, started: true });
    const sara = await upsertUser(db, { telegramId: 12, firstName: "سارا", lastName: "محمدی", username: null, started: true });
    await registerStudent(db, { userId: ali.id, chapterId: chapter.id, mode: "admin", hasStartedBot: true });
    await registerStudent(db, { userId: sara.id, chapterId: chapter.id, mode: "admin", hasStartedBot: true });
    const now = tehranDateTimeToUtc(date, "10:00");
    now.setUTCDate(now.getUTCDate() - 3);
    const api = scriptedApi("ok");
    const first = await processReminders(db, api.client, now);
    const second = await processReminders(db, api.client, now);
    expect(first.sent).toBe(2);
    expect(second.sent).toBe(0);
    expect(api.sent).toHaveLength(2);
    expect(api.sent[0]).toContain("سه روز دیگر");
    expect(api.sent[0]).toContain("فصل پنجم");
    expect(api.sent[0]).toContain("شما");
    expect(api.sent[0]).toContain("سارا محمدی");
    const rows = await db.all<{ status: string }>("SELECT status FROM reminder_logs");
    expect(rows.every((row) => row.status === "sent")).toBe(true);
  });

  it("stops retrying a blocked user and backs off a temporary failure", async () => {
    const db = createTestDb();
    const chapter = await createChapter(db, { chapterNumber: 6, title: "کالیبراسیون" });
    if (!chapter.ok) throw new Error("chapter");
    await updateChapterDate(db, chapter.id, "2026-12-01");
    await updateChapterTime(db, chapter.id, "09:00");
    const user = await upsertUser(db, { telegramId: 21, firstName: "مریم", lastName: null, username: null, started: true });
    await registerStudent(db, { userId: user.id, chapterId: chapter.id, mode: "admin", hasStartedBot: true });
    const now = tehranDateTimeToUtc("2026-12-01", "09:00");
    now.setUTCDate(now.getUTCDate() - 1);
    const blocked = await processReminders(db, scriptedApi("blocked").client, now);
    expect(blocked.blocked).toBe(1);
    const again = await processReminders(db, scriptedApi("ok").client, new Date(now.getTime() + 60_000));
    expect(again.sent).toBe(0);
    const status = await db.get<{ status: string; blocked_bot: number }>(
      `SELECT reminder_logs.status, users.blocked_bot
       FROM reminder_logs JOIN users ON users.id = reminder_logs.user_id`,
    );
    expect(status).toMatchObject({ status: "blocked", blocked_bot: 1 });
  });

  it("retries a temporary failure and then stops", async () => {
    const db = createTestDb();
    const chapter = await createChapter(db, { chapterNumber: 7, title: "ویژگی‌ها" });
    if (!chapter.ok) throw new Error("chapter");
    await updateChapterDate(db, chapter.id, "2026-12-02");
    await updateChapterTime(db, chapter.id, "09:00");
    const user = await upsertUser(db, { telegramId: 22, firstName: "کیان", lastName: null, username: null, started: true });
    await registerStudent(db, { userId: user.id, chapterId: chapter.id, mode: "admin", hasStartedBot: true });
    let cursor = tehranDateTimeToUtc("2026-12-02", "09:00");
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const failed = await processReminders(db, scriptedApi("retry").client, cursor);
      expect(failed.failed).toBe(1);
      const row = await db.get<{ attempt_count: number; next_retry_at: string | null }>(
        "SELECT attempt_count, next_retry_at FROM reminder_logs",
      );
      expect(row?.attempt_count).toBe(attempt);
      if (attempt < 5) cursor = new Date(row?.next_retry_at ?? cursor);
    }
    const stopped = await processReminders(db, scriptedApi("ok").client, new Date(cursor.getTime() + 60_000));
    expect(stopped.sent).toBe(0);
    const finalRow = await db.get<{ status: string; attempt_count: number }>("SELECT status, attempt_count FROM reminder_logs");
    expect(finalRow).toMatchObject({ status: "failed", attempt_count: 5 });
  });

  it("does not send a presentation-morning reminder while same-day reminders are off", async () => {
    const db = createTestDb();
    await setSetting(db, "same_day_reminder_enabled", "false");
    const chapter = await createChapter(db, { chapterNumber: 8, title: "پروژه" });
    if (!chapter.ok) throw new Error("chapter");
    await updateChapterDate(db, chapter.id, "2026-12-03");
    await updateChapterTime(db, chapter.id, "12:00");
    const user = await upsertUser(db, { telegramId: 23, firstName: "آوا", lastName: null, username: null, started: true });
    await registerStudent(db, { userId: user.id, chapterId: chapter.id, mode: "admin", hasStartedBot: true });
    const morning = tehranDateTimeToUtc("2026-12-03", "08:00");
    const disabled = await processReminders(db, scriptedApi("ok").client, morning);
    expect(disabled.sent).toBe(0);
    await setSetting(db, "same_day_reminder_enabled", "true");
    const enabled = await processReminders(db, scriptedApi("ok").client, morning);
    expect(enabled.sent).toBe(1);
    const row = await db.get<{ reminder_type: string }>("SELECT reminder_type FROM reminder_logs");
    expect(row?.reminder_type).toBe("same_day");
  });
});
