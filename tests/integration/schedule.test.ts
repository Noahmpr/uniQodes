import { describe, expect, it } from "vitest";
import { TelegramApiError, type TelegramClient } from "../../src/telegram/api";
import { buildScheduleMessages } from "../../src/telegram/messages";
import { verifyGroupMembership } from "../../src/services/membership.service";
import { publishSchedule } from "../../src/services/schedule.service";
import { createChapter, updateChapterTitle } from "../../src/services/chapter.service";
import { registerStudent } from "../../src/services/registration.service";
import { upsertUser } from "../../src/services/user.service";
import { createTestDb } from "../helpers/db";

function fakeApi() {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];
  const messages = new Map<string, string>();
  const missing = new Set<number>();
  let nextId = 10;
  const client: TelegramClient = {
    async call<T>(method: string, body: Record<string, unknown> = {}): Promise<T> {
      calls.push({ method, body });
      if (method === "sendMessage") {
        const id = nextId++;
        messages.set(`${body.chat_id}:${id}`, String(body.text));
        return { message_id: id } as T;
      }
      if (method === "editMessageText") {
        const key = `${body.chat_id}:${body.message_id}`;
        if (missing.has(Number(body.message_id)) || !messages.has(key)) {
          throw new TelegramApiError(400, 400, "Bad Request: message to edit not found", null);
        }
        if (messages.get(key) === body.text) {
          throw new TelegramApiError(400, 400, "Bad Request: message is not modified", null);
        }
        messages.set(key, String(body.text));
        return { message_id: body.message_id } as T;
      }
      if (method === "pinChatMessage" || method === "deleteMessage") return true as T;
      throw new Error(`unexpected ${method}`);
    },
  };
  return { client, calls, messages, missing };
}

describe("schedule message", () => {
  it("renders the persian group schedule without private identifiers", () => {
    const [message] = buildScheduleMessages({
      courseTitle: "بینایی کامپیوتر",
      professorName: "دکتر نمونه",
      bookName: "کتاب مرجع",
      semesterName: "",
      chapters: [
        {
          chapterNumber: 1,
          title: "مقدمات تصویر",
          presentationDate: "2024-11-08",
          presentationTime: "10:00",
          registrationOpen: true,
          status: "scheduled",
          members: [
            { firstName: "علی", lastName: "رضایی" },
            { firstName: "محمد", lastName: "احمدی" },
          ],
        },
        {
          chapterNumber: 3,
          title: "لبه‌یابی",
          presentationDate: null,
          presentationTime: null,
          registrationOpen: true,
          status: "scheduled",
          members: [],
        },
      ],
    });
    expect(message).toContain("📚 برنامه ارائه‌های درس بینایی کامپیوتر");
    expect(message).toContain("👨‍🏫 استاد: دکتر نمونه");
    expect(message).toContain("علی رضایی");
    expect(message).toContain("ظرفیت خالی");
    expect(message).toContain("وضعیت: در حال تکمیل");
    expect(message).toContain("هنوز کسی ثبت‌نام نکرده است");
    expect(message).not.toContain("@");
    expect(message).not.toContain("424242");
  });

  it("edits the stored group message and recreates it when missing", async () => {
    const db = createTestDb();
    const ali = await upsertUser(db, { telegramId: 424242, firstName: "علی", lastName: "رضایی", username: "secret_user", started: true });
    const created = await createChapter(db, { chapterNumber: 1, title: "مقدمات" });
    if (!created.ok) throw new Error("chapter");
    await registerStudent(db, { userId: ali.id, chapterId: created.id, mode: "admin", hasStartedBot: true });
    const api = fakeApi();
    const first = await publishSchedule(db, api.client, -100);
    expect(first.parts).toBe(1);
    expect(api.calls.filter((call) => call.method === "sendMessage")).toHaveLength(1);
    expect(String(api.calls[0]?.body.text)).not.toContain("secret_user");
    expect(String(api.calls[0]?.body.text)).not.toContain("424242");
    await updateChapterTitle(db, created.id, "مقدمات تصویر");
    await publishSchedule(db, api.client, -100);
    expect(api.calls.some((call) => call.method === "editMessageText")).toBe(true);
    const edited = api.calls.filter((call) => call.method === "editMessageText").at(-1);
    expect(edited?.body.message_id).toBe(10);
    api.missing.add(10);
    api.messages.delete("-100:10");
    const recreated = await publishSchedule(db, api.client, -100);
    expect(recreated.recreated).toBe(true);
    const stored = await db.get<{ message_id: number }>("SELECT message_id FROM telegram_messages WHERE message_type = 'schedule'");
    expect(stored?.message_id).not.toBe(10);
  });
});

describe("membership", () => {
  const clientFor = (member: Record<string, unknown>, error?: TelegramApiError): TelegramClient => ({
    async call() {
      if (error) throw error;
      return member;
    },
  });

  it("accepts members and rejects people who left", async () => {
    expect(await verifyGroupMembership(clientFor({ status: "member" }), -1, 5)).toBe("member");
    expect(await verifyGroupMembership(clientFor({ status: "administrator" }), -1, 5)).toBe("member");
    expect(await verifyGroupMembership(clientFor({ status: "restricted", is_member: true }), -1, 5)).toBe("member");
    expect(await verifyGroupMembership(clientFor({ status: "left" }), -1, 5)).toBe("absent");
    expect(await verifyGroupMembership(clientFor({ status: "kicked" }), -1, 5)).toBe("absent");
    expect(await verifyGroupMembership(clientFor({}, new TelegramApiError(400, 400, "Bad Request: user not found", null)), -1, 5)).toBe("absent");
    expect(await verifyGroupMembership(clientFor({}, new TelegramApiError(500, 500, "internal", null)), -1, 5)).toBe("unknown");
  });
});
