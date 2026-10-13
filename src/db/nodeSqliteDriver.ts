import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { DbDriver } from './driver';

export function createNodeSqliteDriver(db: DatabaseSync): DbDriver {
  return {
    async exec(sql) { db.exec(sql); },
    async run(sql: string, params: unknown[] = []) { const info = db.prepare(sql).run(...(params as SQLInputValue[])); return { changes: Number(info.changes) }; },
    async get<T>(sql: string, params: unknown[] = []) { return (db.prepare(sql).get(...(params as SQLInputValue[])) as T | undefined) ?? null; },
    async all<T>(sql: string, params: unknown[] = []) { return db.prepare(sql).all(...(params as SQLInputValue[])) as T[]; },
  };
}
