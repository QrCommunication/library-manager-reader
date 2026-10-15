import type { DbDriver } from './driver';

export const CURRENT_SCHEMA_VERSION = 6;

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
  2: `
    CREATE TABLE annotations (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      cfi TEXT NOT NULL,
      color TEXT NOT NULL,
      note TEXT,
      excerpt TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      deleted_at INTEGER
    );
    CREATE INDEX idx_annotations_book ON annotations(book_id, deleted_at);
  `,
  3: `
    ALTER TABLE books ADD COLUMN series TEXT;
    ALTER TABLE books ADD COLUMN series_index REAL;
  `,
  4: `
    CREATE TABLE remote_books (
      book_id TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL,
      server_book_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      last_revision INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE progress_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL,
      server_book_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      cfi TEXT,
      chapter_id TEXT,
      percent REAL NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_progress_journal_book ON progress_journal(book_id, created_at);
  `,
  // Library Manager switched its reading contract to KOReader positions
  // (progress XPointer + percentage 0..1); legacy cfi/chapterId/percent bodies
  // are refused with validationFailed and must not be retried. Pending legacy
  // ops are dropped — never rewritten under their operationId — while the
  // local position (reading_progress) is kept: the next save re-journals it in
  // the new format against the re-read server revision.
  5: `
    ALTER TABLE reading_progress ADD COLUMN xpointer TEXT;
    ALTER TABLE remote_books ADD COLUMN exact_copy INTEGER NOT NULL DEFAULT 0;
    DROP INDEX idx_progress_journal_book;
    DROP TABLE progress_journal;
    CREATE TABLE progress_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      book_id TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      space_id TEXT NOT NULL,
      server_book_id TEXT NOT NULL,
      version_id TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      progress TEXT,
      percentage REAL NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX idx_progress_journal_book ON progress_journal(book_id, created_at);
  `,
  // Exact replay + explicit conflicts (mobile API §8):
  //  - expected_revision / attempted_at freeze the whole body at its first
  //    send, so a lost response is recovered by re-sending the SAME operation
  //    (never coalesced away, never re-revisioned);
  //  - state 'conflict' parks a 409 (or a replay window overrun) until the
  //    user explicitly picks a side; the book's later ops wait behind it;
  //  - synced_at (local clock, compared only with local timestamps) tells
  //    whether the local position changed since the last agreement with the
  //    server — the server revision, not a phone clock, decides the rest.
  6: `
    ALTER TABLE progress_journal ADD COLUMN expected_revision INTEGER;
    ALTER TABLE progress_journal ADD COLUMN attempted_at INTEGER;
    ALTER TABLE progress_journal ADD COLUMN state TEXT NOT NULL DEFAULT 'pending';
    ALTER TABLE progress_journal ADD COLUMN conflict_revision INTEGER;
    ALTER TABLE remote_books ADD COLUMN synced_at INTEGER NOT NULL DEFAULT 0;
  `,
};

// targetVersion exists for upgrade tests (simulate an install stuck at an older schema)
export async function migrate(db: DbDriver, targetVersion: number = CURRENT_SCHEMA_VERSION): Promise<void> {
  await db.exec('PRAGMA foreign_keys = ON;');
  const row = await db.get<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let v = current + 1; v <= targetVersion; v++) {
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
