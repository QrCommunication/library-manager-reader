import { openDatabaseSync } from 'expo-sqlite';
import type { DbDriver } from './driver';

export function createExpoDriver(file = 'lmr.db'): DbDriver {
  const db = openDatabaseSync(file);
  return {
    async exec(sql) { db.execSync(sql); },
    async run(sql, params = []) { const r = db.runSync(sql, params as never); return { changes: r.changes }; },
    async get<T>(sql: string, params: unknown[] = []) { return db.getFirstSync<T>(sql, params as never) ?? null; },
    async all(sql, params = []) { return db.getAllSync(sql, params as never) as never; },
  };
}
