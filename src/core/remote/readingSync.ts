// Live reading sync glue (mobile API §8), bound to the app services:
//  - reconcileReadingPosition: at open and on return to the foreground —
//    replays the journal, re-reads the server and applies the revision-based
//    decision (fast-forward, push, or an explicit conflict);
//  - pushReadingPosition: after each (debounced) page-turn save — journal the
//    KOReader body, then flush in order;
//  - describe/resolve: the explicit conflict choice.
// Reading never waits on the network: failures keep the local position and
// the durable journal.

import type { AppServices } from '../services';
import { createLmAccountDeps } from '../storage/expoSecureStore';
import { lmClientFromAccount, lmInstallationId, lmIsConnected, type LmAccountDeps } from './lmAccount';
import { flushProgressJournal } from './liveSync';
import {
  describeConflict, reconcileBook, resolveConflict,
  type ConflictView, type ReconcileDeps, type ReconcileOutcome,
} from './progressReconcile';
import { uuidV7 } from '../uuid';
import type { ReadingProgress } from '../types';

/** cloud account helpers bound to the app's settings repo (cheap to build) */
export const accountDeps = (services: AppServices): LmAccountDeps => createLmAccountDeps(services.settings);

/** reconcile deps for a connected account, else null (signed out) */
export async function reconcileDeps(services: AppServices): Promise<ReconcileDeps | null> {
  const account = accountDeps(services);
  if (!(await lmIsConnected(account))) return null;
  return {
    client: await lmClientFromAccount(account),
    repo: services.remoteSync,
    progress: services.progress,
    installationId: await lmInstallationId(account),
    newOperationId: uuidV7,
  };
}

/** best-effort: offline / signed out / unlinked → { kind: 'none' } */
export async function reconcileReadingPosition(services: AppServices, bookId: string): Promise<ReconcileOutcome> {
  try {
    if (!(await services.remoteSync.getLink(bookId))) return { kind: 'none' };
    const deps = await reconcileDeps(services);
    return deps ? await reconcileBook(deps, bookId) : { kind: 'none' };
  } catch {
    return { kind: 'none' };
  }
}

/**
 * Journal the local position of a linked book (cloud-connected only) and try
 * to flush. Offline the op stays durable in SQLite and the next page turn —
 * or any later flush — drains it; nothing here blocks or throws.
 */
export async function pushReadingPosition(
  services: AppServices,
  bookId: string,
  position: { xpointer: string | null; fraction: number },
): Promise<void> {
  try {
    const link = await services.remoteSync.getLink(bookId);
    if (!link) return;
    const deps = await reconcileDeps(services);
    if (!deps) return;
    await services.remoteSync.enqueueOp({
      bookId,
      spaceId: link.spaceId,
      serverBookId: link.serverBookId,
      versionId: link.versionId,
      operationId: uuidV7(),
      // KOReader body: XPointer of these exact bytes (or null), fraction 0..1
      progress: link.exactCopy ? position.xpointer : null,
      percentage: Math.min(1, Math.max(0, position.fraction)),
    });
    await flushProgressJournal({ client: deps.client, repo: deps.repo, installationId: deps.installationId });
  } catch (err) {
    console.warn('[reading-sync] push failed (kept in journal)', err);
  }
}

export async function hasReadingConflict(services: AppServices, bookId: string): Promise<boolean> {
  return (await services.remoteSync.opsForBook(bookId)).some((o) => o.state === 'conflict');
}

export async function describeReadingConflict(services: AppServices, bookId: string): Promise<ConflictView | null> {
  const deps = await reconcileDeps(services);
  return deps ? describeConflict(deps, bookId) : null;
}

/** explicit user choice; returns the position now applied locally ('server') */
export async function resolveReadingConflict(
  services: AppServices,
  bookId: string,
  choice: 'server' | 'local',
): Promise<ReadingProgress | null> {
  const deps = await reconcileDeps(services);
  if (!deps) return null;
  return resolveConflict(deps, bookId, choice);
}
