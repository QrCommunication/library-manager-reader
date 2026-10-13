import { DatabaseSync } from 'node:sqlite';
import { createNodeSqliteDriver } from '../nodeSqliteDriver';
import { CURRENT_SCHEMA_VERSION, migrate } from '../migrate';

const makeDb = () => createNodeSqliteDriver(new DatabaseSync(':memory:'));

describe('migrate', () => {
  it('creates all v1 tables', async () => {
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
