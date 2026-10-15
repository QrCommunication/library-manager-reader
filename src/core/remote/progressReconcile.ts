// Revision-based reconciliation of one linked book with library-manager.com
// (mobile API §8). Shared by the reader (open / back to foreground), the bulk
// "sync reading progress" action and the explicit conflict choice.
//
// Decision table, after replaying the journal (a lost receipt is recovered
// first, so our own last write is never mistaken for another device's):
//   server revision == last agreed revision → nothing new remotely: push the
//                                             local position if it moved
//   server moved, local unchanged since the  → fast-forward to the server
//   last agreement
//   server moved AND local moved             → explicit conflict (never a
//                                             clock or max-percentage rule)
// "Local moved" compares two LOCAL timestamps (position vs last agreement);
// the phone clock is never compared with the server or another device.

import { flushProgressJournal } from './liveSync';
import type { LmClient, LmProgress } from './lmClient';
import type { RemoteLinkState, RemoteSyncRepo } from '../../db/remoteSyncRepo';
import type { ReadingProgress } from '../types';

export interface ReconcileDeps {
  client: Pick<LmClient, 'getProgress' | 'putProgress'>;
  repo: RemoteSyncRepo;
  progress: {
    getProgress(bookId: string): Promise<ReadingProgress | null>;
    saveProgress(p: ReadingProgress): Promise<void>;
  };
  installationId: string;
  newOperationId(): string;
  now?: () => number;
}

export type ReconcileOutcome =
  | { kind: 'none' }
  | { kind: 'inSync' }
  | { kind: 'pushed' }
  | { kind: 'pulled'; progress: ReadingProgress }
  | { kind: 'conflict' };

// same rounding granularity as KOReader (1/10000)
const EPSILON = 0.0001;

export const samePosition = (local: ReadingProgress, server: LmProgress, exact: boolean): boolean =>
  Math.abs(local.fraction - server.percentage) <= EPSILON
  && (!exact || !local.xpointer || !server.progress || local.xpointer === server.progress);

const flush = (deps: ReconcileDeps) =>
  flushProgressJournal({ client: deps.client, repo: deps.repo, installationId: deps.installationId, now: deps.now });

const opFor = (bookId: string, link: RemoteLinkState, deps: ReconcileDeps, local: ReadingProgress) => ({
  bookId,
  spaceId: link.spaceId,
  serverBookId: link.serverBookId,
  versionId: link.versionId,
  operationId: deps.newOperationId(),
  // KOReader body: XPointer only for these exact bytes, never derived from the fraction
  progress: link.exactCopy ? (local.xpointer ?? null) : null,
  percentage: Math.min(1, Math.max(0, local.fraction)),
});

/** server position applied locally; the engine resolves the XPointer (else the fraction) */
async function applyServer(deps: ReconcileDeps, bookId: string, link: RemoteLinkState, server: LmProgress): Promise<ReadingProgress> {
  const at = (deps.now ?? Date.now)();
  const progress: ReadingProgress = {
    bookId,
    cfi: null,
    xpointer: link.exactCopy ? server.progress : null,
    fraction: server.percentage,
    sectionIndex: null,
    updatedAt: at,
  };
  await deps.progress.saveProgress(progress);
  await deps.repo.markSynced(bookId, server.revision, at);
  return progress;
}

const hasConflict = async (deps: ReconcileDeps, bookId: string): Promise<boolean> =>
  (await deps.repo.opsForBook(bookId)).some((o) => o.state === 'conflict');

/** journal the current local position and send it (in order, after any earlier op) */
async function pushLocal(deps: ReconcileDeps, bookId: string, link: RemoteLinkState, local: ReadingProgress, expectedRevision?: number): Promise<ReconcileOutcome> {
  await deps.repo.enqueueOp(opFor(bookId, link, deps, local), expectedRevision === undefined ? {} : { expectedRevision });
  await flush(deps);
  return (await hasConflict(deps, bookId)) ? { kind: 'conflict' } : { kind: 'pushed' };
}

export async function reconcileBook(deps: ReconcileDeps, bookId: string): Promise<ReconcileOutcome> {
  // replay first: a sent op whose response was lost gets its stored receipt
  await flush(deps);
  const ops = await deps.repo.opsForBook(bookId);
  if (ops.some((o) => o.state === 'conflict')) return { kind: 'conflict' };
  // journal not drained (offline, 5xx, 429…): decide nothing until it is —
  // an unacknowledged op may already be the server's latest revision
  if (ops.length > 0) return { kind: 'none' };
  const link = await deps.repo.getLink(bookId);
  if (!link) return { kind: 'none' };
  const server = await deps.client.getProgress(link.spaceId, link.serverBookId, link.versionId);
  const local = await deps.progress.getProgress(bookId);
  const localMoved = local !== null && local.updatedAt > link.syncedAt;

  // no server progress: the first record is written against revision 0
  if (!server) return local ? pushLocal(deps, bookId, link, local, 0) : { kind: 'none' };
  if (server.revision === link.lastRevision) {
    return localMoved && local ? pushLocal(deps, bookId, link, local) : { kind: 'inSync' };
  }
  // the server moved since our last agreement
  if (!local || !localMoved) return { kind: 'pulled', progress: await applyServer(deps, bookId, link, server) };
  if (samePosition(local, server, link.exactCopy)) {
    await deps.repo.markSynced(bookId, server.revision, (deps.now ?? Date.now)());
    return { kind: 'inSync' };
  }
  // both sides moved: park the local position as a conflict, nothing is overwritten
  await deps.repo.enqueueOp(opFor(bookId, link, deps, local));
  const [op] = await deps.repo.opsForBook(bookId);
  if (op) await deps.repo.markConflict(op.id, server.revision);
  return { kind: 'conflict' };
}

export interface ConflictView {
  bookId: string;
  versionId: string;
  server: LmProgress | null;
  local: ReadingProgress | null;
}

/** fresh view of both sides for the choice dialog (server re-read) */
export async function describeConflict(deps: ReconcileDeps, bookId: string): Promise<ConflictView | null> {
  const link = await deps.repo.getLink(bookId);
  if (!link) return null;
  const server = await deps.client.getProgress(link.spaceId, link.serverBookId, link.versionId);
  const local = await deps.progress.getProgress(bookId);
  return { bookId, versionId: link.versionId, server, local };
}

/**
 * Explicit choice (spec §8 conflict steps):
 *  - 'server': the server position replaces the local one (on this exact
 *    version only for the XPointer) and the parked op is closed;
 *  - 'local': the server revision is re-read and a NEW operation (new UUID)
 *    carries the current local position — a new conflict asks again.
 * Returns the position applied locally ('server'), else null.
 */
export async function resolveConflict(deps: ReconcileDeps, bookId: string, choice: 'server' | 'local'): Promise<ReadingProgress | null> {
  const link = await deps.repo.getLink(bookId);
  if (!link) return null;
  const server = await deps.client.getProgress(link.spaceId, link.serverBookId, link.versionId);
  const local = await deps.progress.getProgress(bookId);
  if (choice === 'server' && server) {
    await deps.repo.removeBookOps(bookId);
    return applyServer(deps, bookId, link, server);
  }
  await deps.repo.removeBookOps(bookId);
  if (local) await pushLocal(deps, bookId, link, local, server?.revision ?? 0);
  return null;
}
