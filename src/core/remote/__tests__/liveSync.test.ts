import { DatabaseSync } from 'node:sqlite';
import { createNodeSqliteDriver } from '../../../db/nodeSqliteDriver';
import { migrate } from '../../../db/migrate';
import { createRemoteSyncRepo, type RemoteSyncRepo } from '../../../db/remoteSyncRepo';
import { LmClient, LmError } from '../lmClient';
import { flushProgressJournal } from '../liveSync';

const makeRepo = async (bookIds: string[]): Promise<RemoteSyncRepo> => {
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  for (const id of bookIds) {
    await db.run(
      'INSERT INTO books (id, title, format, file_name, file_size, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, 'T', 'epub', `${id}.epub`, 1, 1, 1],
    );
  }
  return createRemoteSyncRepo(db);
};

const receipt = (revision: number) => ({ bookId: 'sb1', versionId: 'v1', cfi: null, chapterId: null, percent: 20, revision, updatedAt: 1700000000 });

type PutCall = { spaceId: string; bookId: string; op: { installationId: string; operationId: string; expectedRevision: number; versionId: string; cfi: string | null; chapterId: string | null; percent: number } };

describe('flushProgressJournal — ordered, single-flight, offline-tolerant push', () => {
  it('sends the pending op with the stored revision, persists the receipt and the new revision', async () => {
    const repo = await makeRepo(['b1']);
    await repo.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1' });
    await repo.enqueueOp({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', operationId: 'o1', cfi: 'c1', chapterId: null, percent: 20 });
    await repo.setLastRevision('b1', 3);

    const calls: PutCall[] = [];
    const deps = {
      client: {
        putProgress: async (spaceId: string, bookId: string, op: PutCall['op']) => {
          calls.push({ spaceId, bookId, op });
          return receipt(4);
        },
      } as unknown as Pick<LmClient, 'putProgress'>,
      repo,
      installationId: 'inst',
      newOperationId: () => 'generated-1',
    };
    const summary = await flushProgressJournal(deps);
    expect(summary).toEqual({ sent: 1, remaining: 0 });
    expect(calls[0]!.op).toMatchObject({ installationId: 'inst', operationId: 'o1', expectedRevision: 3, versionId: 'v1', cfi: 'c1', percent: 20 });
    expect(await repo.pendingOps()).toHaveLength(0);
    expect(await repo.getLastRevision('b1')).toBe(4);
  });

  it('a network failure stops the flush and keeps the op queued for the next attempt', async () => {
    const repo = await makeRepo(['b1']);
    await repo.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1' });
    await repo.enqueueOp({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', operationId: 'o1', cfi: null, chapterId: null, percent: 10 });
    const deps = {
      client: {
        putProgress: async () => { throw new LmError('network', 'offline'); },
      } as unknown as Pick<LmClient, 'putProgress'>,
      repo,
      installationId: 'inst',
      newOperationId: () => 'generated-1',
    };
    const summary = await flushProgressJournal(deps);
    expect(summary).toEqual({ sent: 0, remaining: 1 });
    expect((await repo.pendingOps()).map((o) => o.operationId)).toEqual(['o1']);
  });

  it('a 409 retries ONCE with a fresh operationId and the server revision from the error details', async () => {
    const repo = await makeRepo(['b1']);
    await repo.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1' });
    await repo.enqueueOp({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', operationId: 'o1', cfi: null, chapterId: null, percent: 42 });
    const calls: PutCall[] = [];
    const deps = {
      client: {
        putProgress: async (spaceId: string, bookId: string, op: PutCall['op']) => {
          calls.push({ spaceId, bookId, op });
          if (calls.length === 1) {
            throw new LmError('conflict', '409 revisionConflict', 'revisionConflict', { expectedRevision: 0, currentRevision: 5 });
          }
          return receipt(6);
        },
      } as unknown as Pick<LmClient, 'putProgress'>,
      repo,
      installationId: 'inst',
      newOperationId: () => 'fresh-op',
    };
    const summary = await flushProgressJournal(deps);
    expect(summary).toEqual({ sent: 1, remaining: 0 });
    expect(calls[0]!.op.operationId).toBe('o1');
    expect(calls[0]!.op.expectedRevision).toBe(0);
    expect(calls[1]!.op.operationId).toBe('fresh-op');
    expect(calls[1]!.op.expectedRevision).toBe(5);
    expect(await repo.getLastRevision('b1')).toBe(6);
  });

  it('a second 409 drops the op instead of looping — the next page turn re-attempts', async () => {
    const repo = await makeRepo(['b1']);
    await repo.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1' });
    await repo.enqueueOp({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', operationId: 'o1', cfi: null, chapterId: null, percent: 42 });
    const conflict = new LmError('conflict', '409 revisionConflict', 'revisionConflict', { expectedRevision: 0, currentRevision: 5 });
    const deps = {
      client: {
        putProgress: async () => { throw conflict; },
      } as unknown as Pick<LmClient, 'putProgress'>,
      repo,
      installationId: 'inst',
      newOperationId: () => 'fresh-op',
    };
    const summary = await flushProgressJournal(deps);
    expect(summary).toEqual({ sent: 0, remaining: 0 });
    expect(await repo.pendingOps()).toHaveLength(0);
  });

  it('processes several books in order, keeping ops of later books when one drops', async () => {
    const repo = await makeRepo(['b1', 'b2']);
    await repo.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1' });
    await repo.linkBook({ bookId: 'b2', spaceId: 's1', serverBookId: 'sb2', versionId: 'v2' });
    await repo.enqueueOp({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', operationId: 'o1', cfi: null, chapterId: null, percent: 10 });
    await repo.enqueueOp({ bookId: 'b2', spaceId: 's1', serverBookId: 'sb2', versionId: 'v2', operationId: 'o2', cfi: null, chapterId: null, percent: 20 });
    const calls: PutCall[] = [];
    const deps = {
      client: {
        putProgress: async (spaceId: string, bookId: string, op: PutCall['op']) => {
          calls.push({ spaceId, bookId, op });
          if (bookId === 'sb1') throw new LmError('forbidden', '403 forbidden');
          return receipt(2);
        },
      } as unknown as Pick<LmClient, 'putProgress'>,
      repo,
      installationId: 'inst',
      newOperationId: () => 'gen',
    };
    const summary = await flushProgressJournal(deps);
    expect(summary).toEqual({ sent: 1, remaining: 0 });
    expect(calls.map((c) => c.bookId)).toEqual(['sb1', 'sb2']);
    expect(await repo.pendingOps()).toHaveLength(0);
  });
});
