import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Worker } from "node:worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { REGISTER_STUDENT_SQL } from "../../src/services/registration.service";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function runWorker(filename: string, workerData: unknown): Promise<{ ok: boolean; changes?: number; error?: string }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(filename, { workerData });
    worker.once("message", resolve);
    worker.once("error", reject);
  });
}

describe("simultaneous registration", () => {
  it("gives the last slots to only three students", async () => {
    const directory = mkdtempSync(join(tmpdir(), "cv-reg-"));
    directories.push(directory);
    const file = join(directory, "class.sqlite");
    const sqlite = new DatabaseSync(file);
    sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
    sqlite.exec(readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8"));
    const now = "2026-11-15T06:30:00.000Z";
    sqlite.prepare(
      "INSERT INTO chapters (id, chapter_number, title, registration_open, status, created_at, updated_at) VALUES (1, 1, 'رقابت', 1, 'scheduled', ?, ?)",
    ).run(now, now);
    const insertUser = sqlite.prepare(
      "INSERT INTO users (id, telegram_id, first_name, is_active, has_started_bot, blocked_bot, created_at, updated_at) VALUES (?, ?, ?, 1, 1, 0, ?, ?)",
    );
    for (let id = 1; id <= 8; id += 1) insertUser.run(id, 1000 + id, `دانشجو${id}`, now, now);
    sqlite.close();

    const workerFile = join(directory, "worker.mjs");
    writeFileSync(
      workerFile,
      `import { parentPort, workerData } from "node:worker_threads";
import { DatabaseSync } from "node:sqlite";
const sqlite = new DatabaseSync(workerData.file);
sqlite.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
try {
  sqlite.exec("BEGIN IMMEDIATE");
  const info = sqlite.prepare(workerData.sql).run(...workerData.params);
  sqlite.exec("COMMIT");
  parentPort.postMessage({ ok: true, changes: Number(info.changes) });
} catch (error) {
  try { sqlite.exec("ROLLBACK"); } catch {}
  parentPort.postMessage({ ok: false, error: String(error) });
} finally {
  sqlite.close();
}
`,
    );

    const results = await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        runWorker(workerFile, { file, sql: REGISTER_STUDENT_SQL, params: [index + 1, 1, now, 0] }),
      ),
    );
    const check = new DatabaseSync(file);
    check.exec("PRAGMA foreign_keys = ON;");
    const count = check.prepare("SELECT COUNT(*) AS total FROM registrations").get() as { total: number };
    check.close();
    expect(count.total).toBe(3);
    expect(results.filter((result) => result.ok && result.changes === 1)).toHaveLength(3);
  });
});
