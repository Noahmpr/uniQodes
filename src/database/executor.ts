export interface StatementResult {
  changes: number;
}

export interface SqlStatement {
  sql: string;
  params?: readonly unknown[];
}

export interface SqlExecutor {
  get<T extends object>(sql: string, params?: readonly unknown[]): Promise<T | null>;
  all<T extends object>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  run(sql: string, params?: readonly unknown[]): Promise<StatementResult>;
  batch(statements: readonly SqlStatement[]): Promise<StatementResult[]>;
}
