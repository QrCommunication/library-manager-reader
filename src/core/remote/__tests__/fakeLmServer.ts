// In-memory library-manager.com progress endpoint for tests: per-book
// revisions, revision-checked writes, idempotent operationIds (same id + same
// body → stored receipt; same id + other body → 409), injectable failures.
import { DatabaseSync } from 'node:sqlite';
import { createNodeSqliteDriver } from '../../../db/nodeSqliteDriver';
import { migrate } from '../../../db/migrate';
import { createProgressRepo } from '../../../db/progressRepo';
import { createRemoteSyncRepo } from '../../../db/remoteSyncRepo';
import { LmError, type LmProgress, type LmProgressOp } from '../lmClient';

export function fakeLmServer() {
  const state = new Map<string, LmProgress>();
  const receipts = new Map<string, { body: string; receipt: LmProgress }>();
  const puts: { bookId: string; op: LmProgressOp }[] = [];
  let nextError: Error | null = null;
  let loseNext = false;
  let clock = 1_700_000_000_000;
  const client = {
    getProgress: async (_spaceId: string, bookId: string, _versionId: string): Promise<LmProgress | null> => {
      if (nextError) { const e = nextError; nextError = null; throw e; }
      return state.get(bookId) ?? null;
    },
    putProgress: async (_spaceId: string, bookId: string, op: LmProgressOp): Promise<LmProgress> => {
      puts.push({ bookId, op });
      if (nextError) { const e = nextError; nextError = null; throw e; }
      const body = JSON.stringify(op);
      const seen = receipts.get(op.operationId);
      if (seen) {
        if (seen.body !== body) throw new LmError('conflict', '409 idempotencyConflict', 'idempotencyConflict', undefined, 409);
        return seen.receipt;
      }
      const current = state.get(bookId)?.revision ?? 0;
      if (op.expectedRevision !== current) {
        throw new LmError('conflict', '409 revisionConflict', 'revisionConflict', { expectedRevision: op.expectedRevision, currentRevision: current }, 409);
      }
      const receipt: LmProgress = {
        bookId, versionId: op.versionId, progress: op.progress, percentage: op.percentage,
        revision: current + 1, updatedAtMs: (clock += 1000),
      };
      state.set(bookId, receipt);
      receipts.set(op.operationId, { body, receipt });
      if (loseNext) { loseNext = false; throw new LmError('network', 'response lost'); }
      return receipt;
    },
  };
  return {
    client,
    state,
    puts,
    failNext(err: Error) { nextError = err; },
    /** the write is applied server-side but its response never arrives */
    loseNextResponse() { loseNext = true; },
    /** another device wrote this position */
    otherDeviceWrites(bookId: string, percentage: number, progress: string | null = null) {
      const current = state.get(bookId)?.revision ?? 0;
      state.set(bookId, { bookId, versionId: 'v1', progress, percentage, revision: current + 1, updatedAtMs: (clock += 1000) });
    },
  };
}

/** real SQLite (node:sqlite) with linkable books */
export async function makeSyncDb(bookIds: string[] = ['b1']) {
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  for (const id of bookIds) {
    await db.run(
      'INSERT INTO books (id, title, format, file_name, file_size, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, id, 'epub', `${id}.epub`, 1, 1, 1],
    );
  }
  return { db, repo: createRemoteSyncRepo(db), progress: createProgressRepo(db) };
}

export const journalOp = (bookId: string, operationId: string, percentage: number, progress: string | null = null) => ({
  bookId, spaceId: 's1', serverBookId: `srv-${bookId}`, versionId: 'v1', operationId, progress, percentage,
});
