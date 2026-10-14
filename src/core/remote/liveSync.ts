// Live reading-progress push (spec §8): a coalescing SQLite journal drained
// in order by a single-flight flusher. Offline failures keep the op queued;
// a 409 while the reader is active retries once with a fresh operationId and
// the server revision carried by the error (local position wins — the user is
// reading HERE), and a second 409 drops the op so the next page turn
// re-attempts instead of looping against other devices.

import { LmError, type LmClient, type LmProgress } from './lmClient';
import type { RemoteSyncRepo } from '../../db/remoteSyncRepo';

export interface LiveSyncDeps {
  client: Pick<LmClient, 'putProgress'>;
  repo: RemoteSyncRepo;
  installationId: string;
  newOperationId(): string;
}

export interface FlushSummary { sent: number; remaining: number }

const singleFlight = new Map<string, Promise<FlushSummary>>();
const LAST = 'liveSync.flush';

/** one flusher at a time; concurrent callers await the running flush */
export function flushProgressJournal(deps: LiveSyncDeps): Promise<FlushSummary> {
  const running = singleFlight.get(LAST);
  if (running) return running;
  const job = drain(deps).finally(() => singleFlight.delete(LAST));
  singleFlight.set(LAST, job);
  return job;
}

async function drain(deps: LiveSyncDeps): Promise<FlushSummary> {
  let sent = 0;
  for (;;) {
    const pending = await deps.repo.pendingOps();
    if (pending.length === 0) return { sent, remaining: 0 };
    const op = pending[0]!;
    try {
      const receipt = await push(deps, op, await deps.repo.getLastRevision(op.bookId), op.operationId);
      await deps.repo.removeOp(op.id);
      await deps.repo.setLastRevision(op.bookId, receipt.revision);
      sent += 1;
    } catch (err) {
      if (err instanceof LmError && err.kind === 'conflict') {
        // 409 with details {currentRevision} → local wins, one fresh retry
        const details = err.details as { currentRevision?: number } | undefined;
        const current = typeof details?.currentRevision === 'number' ? details.currentRevision : 0;
        try {
          const receipt = await push(deps, op, current, deps.newOperationId());
          await deps.repo.removeOp(op.id);
          await deps.repo.setLastRevision(op.bookId, receipt.revision);
          sent += 1;
        } catch (retryErr) {
          if (retryErr instanceof LmError && retryErr.kind === 'network') return { sent, remaining: (await deps.repo.pendingOps()).length };
          // second conflict, or a hard refusal: drop, the next page turn re-attempts
          await deps.repo.removeOp(op.id);
        }
        continue;
      }
      if (err instanceof LmError && err.kind === 'network') {
        // offline: keep the op durable, stop draining until connectivity returns
        return { sent, remaining: (await deps.repo.pendingOps()).length };
      }
      // hard refusal (403/404/422…): this op will never succeed — drop it
      await deps.repo.removeOp(op.id);
    }
  }
}

async function push(
  deps: LiveSyncDeps,
  op: { spaceId: string; serverBookId: string; versionId: string; operationId: string; cfi: string | null; chapterId: string | null; percent: number; bookId: string },
  expectedRevision: number,
  operationId: string,
): Promise<LmProgress> {
  return deps.client.putProgress(op.spaceId, op.serverBookId, {
    installationId: deps.installationId,
    operationId,
    expectedRevision,
    versionId: op.versionId,
    cfi: op.cfi,
    chapterId: op.chapterId,
    percent: op.percent,
  });
}
