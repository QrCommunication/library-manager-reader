import { DatabaseSync } from 'node:sqlite';
import { createAnnotationsRepo } from '../annotationsRepo';
import { migrate } from '../migrate';
import { createNodeSqliteDriver } from '../nodeSqliteDriver';
import type { DbDriver } from '../driver';

const seedBook = (db: DbDriver) =>
  db.run('INSERT INTO books (id,title,format,file_name,file_size,added_at,updated_at) VALUES (?,?,?,?,?,?,?)',
    ['b1', 'T', 'epub', 't.epub', 1, 1, 1]);

describe('annotationsRepo', () => {
  const setup = async () => {
    const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
    await migrate(db);
    await seedBook(db);
    let i = 0;
    const repo = createAnnotationsRepo(db, () => `a-${++i}`);
    return { db, repo };
  };

  it('adds, lists by book excluding tombstones, in creation order', async () => {
    const { repo } = await setup();
    await repo.add({ bookId: 'b1', cfi: 'epubcfi(/6/4)', color: 'yellow', note: null, excerpt: 'Premier', createdAt: 100 });
    await repo.add({ bookId: 'b1', cfi: 'epubcfi(/6/6)', color: 'green', note: null, excerpt: 'Second', createdAt: 200 });
    const list = await repo.listByBook('b1');
    expect(list.map((a) => a.excerpt)).toEqual(['Premier', 'Second']);
  });

  it('updates note and color with updatedAt, tombstones, purges after cutoff', async () => {
    const { db, repo } = await setup();
    const a = await repo.add({ bookId: 'b1', cfi: 'cfi', color: 'blue', note: null, excerpt: 'x', createdAt: 100 });
    await repo.setNote(a.id, 'ma note', 150);
    await repo.setColor(a.id, 'red', 160);
    const [updated] = await repo.listByBook('b1');
    expect(updated?.note).toBe('ma note');
    expect(updated?.color).toBe('red');
    expect(updated?.updatedAt).toBe(160);
    await repo.markDeleted(a.id, 200);
    expect(await repo.listByBook('b1')).toEqual([]);
    await repo.purgeDeletedBefore(300);
    const row = await db.get<{ id: string }>('SELECT id FROM annotations');
    expect(row).toBeNull();
  });

  it('purges only tombstones older than the cutoff', async () => {
    const { db, repo } = await setup();
    const a = await repo.add({ bookId: 'b1', cfi: 'cfi', color: 'yellow', note: null, excerpt: 'x', createdAt: 100 });
    await repo.markDeleted(a.id, 200);
    await repo.purgeDeletedBefore(150);
    expect(await repo.listByBook('b1')).toEqual([]); // toujours tombstoné, mais présent en base
    const kept = await db.get<{ id: string }>('SELECT id FROM annotations');
    expect(kept?.id).toBe(a.id);
    await repo.purgeDeletedBefore(300);
    const gone = await db.get<{ id: string }>('SELECT id FROM annotations');
    expect(gone).toBeNull();
  });

  it('cascades on book delete (FK ON DELETE CASCADE)', async () => {
    const { db, repo } = await setup();
    await repo.add({ bookId: 'b1', cfi: 'cfi', color: 'yellow', note: null, excerpt: 'x', createdAt: 100 });
    await db.run('PRAGMA foreign_keys = ON');
    await db.run('DELETE FROM books WHERE id = ?', ['b1']);
    const row = await db.get<{ id: string }>('SELECT id FROM annotations');
    expect(row).toBeNull();
  });
});
