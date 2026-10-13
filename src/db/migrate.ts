import type { DbDriver } from './driver';

export const CURRENT_SCHEMA_VERSION = 1;

const MIGRATIONS: Record<number, string> = {
  1: `
    CREATE TABLE books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      format TEXT NOT NULL,
      original_format TEXT,
      file_name TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      language TEXT,
      publisher TEXT,
      drm_identifier TEXT,
      added_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER,
      last_read_at INTEGER
    );
    CREATE INDEX idx_books_deleted ON books(deleted_at);
    CREATE TABLE reading_progress (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      cfi TEXT,
      fraction REAL NOT NULL,
      section_index INTEGER,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE bookmarks (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      cfi TEXT NOT NULL,
      fraction REAL NOT NULL,
      preview_text TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX idx_bookmarks_book ON bookmarks(book_id, deleted_at);
    CREATE TABLE settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `,
};

export async function migrate(db: DbDriver): Promise<void> {
  await db.exec('PRAGMA foreign_keys = ON;');
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current + 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    const sql = MIGRATIONS[v];
    if (!sql) throw new Error(`Missing migration for schema version ${v}`);
    // each step is transactional: a crash or failure mid-script must not leave
    // partial tables behind with user_version stuck below the applied DDL
    try {
      await db.exec('BEGIN');
      await db.exec(sql);
      await db.exec(`PRAGMA user_version = ${v};`);
      await db.exec('COMMIT');
    } catch (err) {
      await db.exec('ROLLBACK').catch(() => { /* already rolled back / no tx */ });
      throw err;
    }
  }
}
