import { describe, expect, it } from "vitest";
import { createChapter, getChapter, setRegistrationOpen } from "../../src/services/chapter.service";
import { cancelOwnRegistration, registerStudent } from "../../src/services/registration.service";
import { loadSession, saveSession } from "../../src/services/session.service";
import { upsertUser } from "../../src/services/user.service";
import { createTestDb } from "../helpers/db";

async function student(db: ReturnType<typeof createTestDb>, telegramId: number, firstName: string) {
  return upsertUser(db, { telegramId, firstName, lastName: "تست", username: "same_name", started: true });
}

describe("users", () => {
  it("uses telegram id as the only identity", async () => {
    const db = createTestDb();
    const first = await student(db, 100, "نگار");
    const renamed = await upsertUser(db, { telegramId: 100, firstName: "نگار", lastName: "جدید", username: "other", started: true });
    const second = await student(db, 101, "نگار");
    expect(renamed.id).toBe(first.id);
    expect(renamed.lastName).toBe("جدید");
    expect(second.id).not.toBe(first.id);
    const count = await db.get<{ total: number }>("SELECT COUNT(*) AS total FROM users");
    expect(count?.total).toBe(2);
  });
});

describe("registration rules", () => {
  it("registers, blocks duplicates, and frees an automatic closure", async () => {
    const db = createTestDb();
    const chapter = await createChapter(db, { chapterNumber: 2, title: "فیلترها" });
    const other = await createChapter(db, { chapterNumber: 3, title: "لبه" });
    if (!chapter.ok || !other.ok) throw new Error("chapters");
    const a = await student(db, 1, "علی");
    const b = await student(db, 2, "محمد");
    const c = await student(db, 3, "سارا");
    const d = await student(db, 4, "رضا");
    expect((await registerStudent(db, { userId: a.id, chapterId: chapter.id, mode: "student", hasStartedBot: true })).ok).toBe(true);
    expect(await registerStudent(db, { userId: a.id, chapterId: chapter.id, mode: "student", hasStartedBot: true })).toMatchObject({ ok: false, reason: "already_in_chapter" });
    expect(await registerStudent(db, { userId: a.id, chapterId: other.id, mode: "student", hasStartedBot: true })).toMatchObject({ ok: false, reason: "already_in_other_chapter" });
    await registerStudent(db, { userId: b.id, chapterId: chapter.id, mode: "student", hasStartedBot: true });
    await registerStudent(db, { userId: c.id, chapterId: chapter.id, mode: "student", hasStartedBot: true });
    expect(await registerStudent(db, { userId: d.id, chapterId: chapter.id, mode: "student", hasStartedBot: true })).toMatchObject({ ok: false, reason: "team_full" });
    const full = await getChapter(db, chapter.id);
    expect(full?.registrationOpen).toBe(false);
    expect(full?.closedBy).toBe("auto");
    const cancelled = await cancelOwnRegistration(db, c.id);
    expect(cancelled.ok).toBe(true);
    if (cancelled.ok) expect(cancelled.reopened).toBe(true);
    expect((await getChapter(db, chapter.id))?.registrationOpen).toBe(true);
    expect((await registerStudent(db, { userId: d.id, chapterId: chapter.id, mode: "student", hasStartedBot: true })).ok).toBe(true);
  });

  it("lets an admin add to a closed chapter without passing capacity", async () => {
    const db = createTestDb();
    const chapter = await createChapter(db, { chapterNumber: 1, title: "رنگ" });
    if (!chapter.ok) throw new Error("chapter");
    await setRegistrationOpen(db, chapter.id, false);
    const person = await student(db, 8, "هدی");
    expect(await registerStudent(db, { userId: person.id, chapterId: chapter.id, mode: "student", hasStartedBot: true })).toMatchObject({ reason: "registration_closed" });
    expect((await registerStudent(db, { userId: person.id, chapterId: chapter.id, mode: "admin", hasStartedBot: true })).ok).toBe(true);
    const removed = await cancelOwnRegistration(db, person.id);
    expect(removed.ok).toBe(true);
    if (removed.ok) expect(removed.reopened).toBe(false);
    expect((await getChapter(db, chapter.id))?.registrationOpen).toBe(false);
  });

  it("rejects a student who has not started the bot", async () => {
    const db = createTestDb();
    const chapter = await createChapter(db, { chapterNumber: 4, title: "دوربین" });
    if (!chapter.ok) throw new Error("chapter");
    const person = await upsertUser(db, { telegramId: 50, firstName: "نوید", lastName: null, username: null, started: false });
    expect(await registerStudent(db, { userId: person.id, chapterId: chapter.id, mode: "admin", hasStartedBot: false })).toMatchObject({ reason: "not_started" });
  });

  it("stores and restores an admin text session", async () => {
    const db = createTestDb();
    await saveSession(db, 42, { state: "set_date", chapterId: 3 });
    expect(await loadSession(db, 42)).toEqual({ state: "set_date", chapterId: 3 });
  });
});
