import { DatabaseSync } from 'node:sqlite';
import { createNodeSqliteDriver } from '../nodeSqliteDriver';
import { CURRENT_SCHEMA_VERSION, migrate } from '../migrate';

const makeDb = () => createNodeSqliteDriver(new DatabaseSync(':memory:'));

// exact copy of the v1 step in src/db/migrate.ts, for simulating an existing
// v1 install (do not import the v2 step here — that is what migrate() applies)
const V1_SCHEMA = `
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
  `;

describe('migrate', () => {
  it('creates the v1 tables', async () => {
    const db = makeDb();
    await migrate(db);
    const tables = (await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    )).map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['books', 'reading_progress', 'bookmarks', 'settings']));
  });

  it('sets user_version to the schema version', async () => {
    const db = makeDb();
    await migrate(db);
    const row = await db.get<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('is idempotent (second run is a no-op)', async () => {
    const db = makeDb();
    await migrate(db);
    await expect(migrate(db)).resolves.toBeUndefined();
  });

  it('upgrades a v1 database to v2 preserving existing rows', async () => {
    const db = makeDb();
    await db.exec(V1_SCHEMA);
    await db.exec('PRAGMA user_version = 1;');
    const t = 1700000000000;
    await db.run(
      'INSERT INTO books (id,title,author,format,original_format,file_name,file_size,language,publisher,drm_identifier,added_at,updated_at,deleted_at,last_read_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      ['bk1', 'Moby Dick', 'Herman Melville', 'epub', null, 'moby.epub', 1234, 'en', 'Penguin', null, t, t, null, null],
    );
    await db.run(
      'INSERT INTO reading_progress (book_id,cfi,fraction,section_index,updated_at) VALUES (?,?,?,?,?)',
      ['bk1', 'epubcfi(/6/4)', 0.42, 3, t + 1],
    );
    await db.run(
      'INSERT INTO bookmarks (id,book_id,cfi,fraction,preview_text,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?)',
      ['bm1', 'bk1', 'epubcfi(/6/4!/4/2)', 0.42, 'call me Ishmael', t + 2, t + 3, null],
    );

    await migrate(db);

    const version = await db.get<{ user_version: number }>('PRAGMA user_version');
    expect(version?.user_version).toBe(CURRENT_SCHEMA_VERSION);

    await expect(db.get('SELECT * FROM books WHERE id = ?', ['bk1'])).resolves.toEqual({
      id: 'bk1',
      title: 'Moby Dick',
      author: 'Herman Melville',
      format: 'epub',
      original_format: null,
      file_name: 'moby.epub',
      file_size: 1234,
      language: 'en',
      publisher: 'Penguin',
      drm_identifier: null,
      added_at: t,
      updated_at: t,
      deleted_at: null,
      last_read_at: null,
    });
    await expect(db.get('SELECT * FROM reading_progress WHERE book_id = ?', ['bk1'])).resolves.toEqual({
      book_id: 'bk1',
      cfi: 'epubcfi(/6/4)',
      fraction: 0.42,
      section_index: 3,
      updated_at: t + 1,
    });
    await expect(db.get('SELECT * FROM bookmarks WHERE id = ?', ['bm1'])).resolves.toEqual({
      id: 'bm1',
      book_id: 'bk1',
      cfi: 'epubcfi(/6/4!/4/2)',
      fraction: 0.42,
      preview_text: 'call me Ishmael',
      created_at: t + 2,
      updated_at: t + 3,
      deleted_at: null,
    });

    // the v2 annotations table now exists and is queryable
    await expect(db.all('SELECT * FROM annotations')).resolves.toEqual([]);
  });

  it('enables foreign keys with cascade delete', async () => {
    const db = makeDb();
    await migrate(db);
    const now = Date.now();
    await db.run(
      'INSERT INTO books (id,title,format,file_name,file_size,added_at,updated_at) VALUES (?,?,?,?,?,?,?)',
      ['b1', 'T', 'epub', 'f.epub', 1, now, now],
    );
    await db.run('INSERT INTO bookmarks (id,book_id,cfi,fraction,created_at,updated_at) VALUES (?,?,?,?,?,?)',
      ['bm1', 'b1', 'x', 0.1, now, now]);
    await db.run('DELETE FROM books WHERE id = ?', ['b1']);
    const left = await db.all('SELECT * FROM bookmarks');
    expect(left).toHaveLength(0);
  });

  it('rolls back the whole step when a migration fails midway', async () => {
    const db = makeDb();
    // simulate a partial prior run: only bookmarks exists, so migration 1 fails
    // at CREATE TABLE bookmarks — AFTER books/idx/reading_progress were applied
    await db.exec('CREATE TABLE bookmarks (id TEXT PRIMARY KEY);');
    await expect(migrate(db)).rejects.toThrow();
    const tables = (await db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    )).map((r) => r.name);
    expect(tables).not.toContain('books');
    expect(tables).not.toContain('reading_progress');
    const row = await db.get<{ user_version: number }>('PRAGMA user_version');
    expect(row?.user_version).toBe(0);
  });
});
