import type { SqlExecutor, SqlStatement, StatementResult } from "./executor";

function normalize(params: readonly unknown[] | undefined): unknown[] {
  return (params ?? []).map((value) => (value === undefined ? null : value));
}

export function createD1Executor(database: D1Database): SqlExecutor {
  return {
    async get<T extends object>(sql: string, params?: readonly unknown[]): Promise<T | null> {
      const row = await database.prepare(sql).bind(...normalize(params)).first<T>();
      return row ?? null;
    },
    async all<T extends object>(sql: string, params?: readonly unknown[]): Promise<T[]> {
      const result = await database.prepare(sql).bind(...normalize(params)).all<T>();
      return result.results ?? [];
    },
    async run(sql: string, params?: readonly unknown[]): Promise<StatementResult> {
      const result = await database.prepare(sql).bind(...normalize(params)).run();
      return { changes: result.meta.changes ?? 0 };
    },
    async batch(statements: readonly SqlStatement[]): Promise<StatementResult[]> {
      if (statements.length === 0) return [];
      const prepared = statements.map((statement) =>
        database.prepare(statement.sql).bind(...normalize(statement.params)),
      );
      const results = await database.batch<D1Result[]>(prepared);
      return results.map((result) => ({ changes: result.meta?.changes ?? 0 }));
    },
  };
}
