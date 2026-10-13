import { DatabaseSync } from 'node:sqlite';
import { createNodeSqliteDriver } from '../nodeSqliteDriver';
import { migrate } from '../migrate';
import { createBooksRepo } from '../booksRepo';

const setup = async () => {
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  let n = 0;
  return createBooksRepo(db, () => `id-${++n}`);
};
const book = (over: Partial<Parameters<ReturnType<typeof createBooksRepo>['createBook']>[0]> = {}) => ({
  title: 'Dune', author: 'Frank Herbert', format: 'epub' as const, originalFormat: null,
  fileName: 'x.epub', fileSize: 100, language: 'en', publisher: null, drmIdentifier: null,
  addedAt: Date.now(), updatedAt: Date.now(), deletedAt: null, lastReadAt: null, ...over,
});

describe('booksRepo', () => {
  it('creates and reads a book', async () => {
    const repo = await setup();
    const created = await repo.createBook(book());
    const fetched = await repo.getBook(created.id);
    expect(fetched?.title).toBe('Dune');
    expect(fetched?.format).toBe('epub');
  });

  it('lists with sorts and search, excluding tombstones', async () => {
    const repo = await setup();
    const a = await repo.createBook(book({ title: 'Aaaa', addedAt: 1, lastReadAt: null }));
    const b = await repo.createBook(book({ title: 'Bbbb', addedAt: 2, lastReadAt: 999 }));
    await repo.createBook(book({ title: 'Gone', addedAt: 3 }));
    await repo.markDeleted((await repo.listBooks({ sort: 'added' }))[0]!.id, Date.now());

    const byRecent = await repo.listBooks({ sort: 'recent' });
    expect(byRecent.map((x) => x.title)).toEqual(['Bbbb', 'Aaaa']); // tombstone excluded; b has lastReadAt
    const byAdded = await repo.listBooks({ sort: 'added' });
    expect(byAdded.map((x) => x.id)).toEqual([b.id, a.id]);
    const searched = await repo.listBooks({ sort: 'title', query: 'aaa' });
    expect(searched.map((x) => x.title)).toEqual(['Aaaa']);
  });

  it('purges tombstones older than cutoff and cascades', async () => {
    const repo = await setup();
    const b = await repo.createBook(book());
    await repo.markDeleted(b.id, 1000);
    const purged = await repo.purgeDeletedBefore(2000);
    expect(purged).toBe(1);
    expect(await repo.getBook(b.id)).toBeNull();
    expect(await repo.purgeDeletedBefore(500)).toBe(0);
  });

  it('touches last_read_at', async () => {
    const repo = await setup();
    const b = await repo.createBook(book());
    await repo.touchLastRead(b.id, 12345);
    expect((await repo.getBook(b.id))?.lastReadAt).toBe(12345);
  });

  it('treats % and _ in search queries as literals', async () => {
    const repo = await setup();
    await repo.createBook(book({ title: '100% done' }));
    await repo.createBook(book({ title: '100X done' }));
    await repo.createBook(book({ title: 'a_b' }));
    await repo.createBook(book({ title: 'abX' }));
    const pct = await repo.listBooks({ sort: 'title', query: '100%' });
    expect(pct.map((x) => x.title)).toEqual(['100% done']);
    const underscore = await repo.listBooks({ sort: 'title', query: 'a_b' });
    expect(underscore.map((x) => x.title)).toEqual(['a_b']);
  });
});
