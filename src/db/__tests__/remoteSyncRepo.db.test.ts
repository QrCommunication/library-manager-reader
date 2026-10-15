import { DatabaseSync } from 'node:sqlite';
import { createNodeSqliteDriver } from '../nodeSqliteDriver';
import { migrate } from '../migrate';
import { createRemoteSyncRepo } from '../remoteSyncRepo';

const makeDb = async () => {
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  return db;
};

const makeServices = async () => {
  const db = await makeDb();
  const books = createBooksStub(db);
  const repo = createRemoteSyncRepo(db);
  return { db, books, repo };
};

// minimal books rows so the FK on book_id holds
const createBooksStub = (db: ReturnType<typeof createNodeSqliteDriver>) => ({
  add: async (id: string) => {
    await db.run(
      'INSERT INTO books (id, title, format, file_name, file_size, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, 'T', 'epub', `${id}.epub`, 1, 1, 1],
    );
  },
});

describe('remoteSyncRepo', () => {
  it('links a local book to its server identity and reads it back', async () => {
    const { books, repo } = await makeServices();
    await books.add('b1');
    await repo.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1' });
    expect(await repo.getLink('b1')).toEqual({ spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', exactCopy: false });
    expect(await repo.getLink('nope')).toBeNull();
  });

  it('relinking updates the identity and resets the revision', async () => {
    const { books, repo } = await makeServices();
    await books.add('b1');
    await repo.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1' });
    await repo.setLastRevision('b1', 7);
    expect(await repo.getLastRevision('b1')).toBe(7);
    await repo.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb2', versionId: 'v2' });
    expect(await repo.getLink('b1')).toMatchObject({ serverBookId: 'sb2', versionId: 'v2' });
    expect(await repo.getLastRevision('b1')).toBe(0);
  });

  it('coalesces the journal to the latest pending op per book, oldest first', async () => {
    const { books, repo } = await makeServices();
    await books.add('b1');
    await books.add('b2');
    await repo.enqueueOp({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', operationId: 'o1', progress: '/body/DocFragment[1]/body/p/text().1', percentage: 0.1 });
    await repo.enqueueOp({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', operationId: 'o2', progress: '/body/DocFragment[1]/body/p/text().2', percentage: 0.2 });
    await repo.enqueueOp({ bookId: 'b2', spaceId: 's1', serverBookId: 'sb2', versionId: 'v2', operationId: 'o3', progress: null, percentage: 0.3 });
    const pending = await repo.pendingOps();
    expect(pending).toHaveLength(2);
    expect(pending[0]).toMatchObject({ bookId: 'b1', operationId: 'o2', progress: '/body/DocFragment[1]/body/p/text().2', percentage: 0.2 });
    expect(pending[1]).toMatchObject({ bookId: 'b2', operationId: 'o3' });
    await repo.removeOp(pending[0]!.id);
    expect((await repo.pendingOps()).map((o) => o.bookId)).toEqual(['b2']);
  });

  it('exactCopy: a same-version relink never downgrades a verified copy; a new version resets it', async () => {
    const { books, repo } = await makeServices();
    await books.add('b1');
    await repo.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', exactCopy: true });
    await repo.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1' });
    expect(await repo.getLink('b1')).toMatchObject({ versionId: 'v1', exactCopy: true });
    await repo.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v2' });
    expect(await repo.getLink('b1')).toMatchObject({ versionId: 'v2', exactCopy: false });
  });
});
