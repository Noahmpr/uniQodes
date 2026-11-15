import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { SqlExecutor, SqlStatement, StatementResult } from "../../src/database/executor";

function bind(params: readonly unknown[] | undefined): unknown[] {
  return (params ?? []).map((value) => (value === undefined ? null : value));
}

export function createTestDb(): SqlExecutor {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(readFileSync(new URL("../../migrations/0001_init.sql", import.meta.url), "utf8"));
  return {
    async get<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T | null> {
      const row = sqlite.prepare(sql).get(...bind(params)) as T | undefined;
      return row ?? null;
    },
    async all<T extends Record<string, unknown>>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      return sqlite.prepare(sql).all(...bind(params)) as T[];
    },
    async run(sql: string, params?: readonly unknown[]): Promise<StatementResult> {
      const result = sqlite.prepare(sql).run(...bind(params));
      return { changes: Number(result.changes) };
    },
    async batch(statements: readonly SqlStatement[]): Promise<StatementResult[]> {
      sqlite.exec("BEGIN IMMEDIATE");
      try {
        const results = statements.map((statement) => {
          const result = sqlite.prepare(statement.sql).run(...bind(statement.params));
          return { changes: Number(result.changes) };
        });
        sqlite.exec("COMMIT");
        return results;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
