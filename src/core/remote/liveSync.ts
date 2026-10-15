// Reading-progress push (mobile API §8): a durable SQLite journal drained in
// order by a single-flight flusher.
//  - The whole body is persisted before the call and frozen at its first send
//    (expected revision included): after an ambiguous failure the SAME
//    operation is re-sent, the server answers with the stored receipt.
//  - The next position of a book is only sent once the previous receipt is
//    persisted (one op in flight per book, journal order).
//  - A 409 is never resolved here: the op is parked as a conflict (local
//    position kept), the book's later ops wait, and listeners are told so the
//    UI can present both positions for an explicit choice.
//  - An op first sent more than the replay window ago is not replayed (its
//    receipt may be gone): it is parked for explicit reconciliation too.
//  - Offline / 5xx / 429 / expired session: the op stays, the flush stops.
//    Only a definitive 4xx refusal (403/404/422…) drops it.

import { LmError, type LmClient, type LmProgress } from './lmClient';
import type { PendingProgressOp, RemoteSyncRepo } from '../../db/remoteSyncRepo';

export interface LiveSyncDeps {
  client: Pick<LmClient, 'putProgress'>;
  repo: RemoteSyncRepo;
  installationId: string;
  /** injectable clock (tests) */
  now?: () => number;
}

export interface FlushSummary { sent: number; remaining: number; conflicts: string[] }

/** server keeps receipts 30 days; stay clear of the edge */
export const REPLAY_WINDOW_MS = 29 * 24 * 60 * 60 * 1000;

type ConflictListener = (bookId: string) => void;
const conflictListeners = new Set<ConflictListener>();

/** notified whenever a book's sync parks on a conflict awaiting a user choice */
export function onProgressConflict(cb: ConflictListener): () => void {
  conflictListeners.add(cb);
  return () => conflictListeners.delete(cb);
}

const notifyConflict = (bookId: string): void => {
  for (const cb of conflictListeners) {
    try { cb(bookId); } catch { /* a listener must not break the flush */ }
  }
};

let running: Promise<FlushSummary> | null = null;

/** one flusher at a time; concurrent callers await the running flush */
export function flushProgressJournal(deps: LiveSyncDeps): Promise<FlushSummary> {
  if (running) return running;
  running = drain(deps).finally(() => { running = null; });
  return running;
}

const keepsOp = (err: unknown): boolean =>
  err instanceof LmError && (
    err.kind === 'network' || err.kind === 'rate' || err.kind === 'auth'
    || (err.kind === 'server' && (err.status === undefined || err.status >= 500))
  );

async function drain(deps: LiveSyncDeps): Promise<FlushSummary> {
  const now = deps.now ?? Date.now;
  let sent = 0;
  const conflicts: string[] = [];
  const remaining = async (): Promise<FlushSummary> => ({
    sent, conflicts, remaining: (await deps.repo.pendingOps()).filter((o) => o.state === 'pending').length,
  });
  for (;;) {
    const ops = await deps.repo.pendingOps();
    const op = nextSendable(ops);
    if (!op) return remaining();
    if (op.attemptedAt !== null && now() - op.attemptedAt > REPLAY_WINDOW_MS) {
      await deps.repo.markConflict(op.id, null);
      conflicts.push(op.bookId);
      notifyConflict(op.bookId);
      continue;
    }
    const expectedRevision = op.expectedRevision ?? await deps.repo.getLastRevision(op.bookId);
    if (op.attemptedAt === null) await deps.repo.markAttempted(op.id, expectedRevision, now());
    try {
      const receipt = await push(deps, op, expectedRevision);
      await deps.repo.applyReceipt(op.id, op.bookId, receipt.revision, now());
      sent += 1;
    } catch (err) {
      if (err instanceof LmError && err.kind === 'conflict') {
        const details = err.details as { currentRevision?: unknown } | undefined;
        await deps.repo.markConflict(op.id, typeof details?.currentRevision === 'number' ? details.currentRevision : null);
        conflicts.push(op.bookId);
        notifyConflict(op.bookId);
        continue;
      }
      if (keepsOp(err)) return remaining();
      // definitive refusal: this exact op can never succeed
      await deps.repo.removeOp(op.id);
    }
  }
}

/** oldest op whose book has nothing parked or earlier in the journal */
function nextSendable(ops: PendingProgressOp[]): PendingProgressOp | null {
  const seen = new Set<string>();
  for (const op of ops) {
    if (seen.has(op.bookId)) continue;
    seen.add(op.bookId);
    if (op.state === 'pending') return op;
  }
  return null;
}

function push(deps: LiveSyncDeps, op: PendingProgressOp, expectedRevision: number): Promise<LmProgress> {
  return deps.client.putProgress(op.spaceId, op.serverBookId, {
    installationId: deps.installationId,
    operationId: op.operationId,
    expectedRevision,
    versionId: op.versionId,
    progress: op.progress,
    percentage: op.percentage,
  });
}
