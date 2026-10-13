export interface DbDriver {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: unknown[]): Promise<{ changes?: number }>;
  get<T>(sql: string, params?: unknown[]): Promise<T | null>;
  all<T>(sql: string, params?: unknown[]): Promise<T[]>;
}
