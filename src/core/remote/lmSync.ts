// Bulk "sync reading progress" for one space: pair each server book with a
// local one, link them, then reconcile through the same revision-based path
// as the reader (progressReconcile.ts) — journaled writes, exact replay,
// explicit conflicts. Nothing here compares clocks or keeps a max percentage.

import type { LmBook, LmBookDetails, LmClient } from './lmClient';
import { reconcileBook, type ReconcileDeps } from './progressReconcile';

const sameBook = (a: { title: string; author: string | null }, b: { title: string; author: string | null }): boolean => {
  if (a.title.trim().toLowerCase() !== b.title.trim().toLowerCase()) return false;
  if (a.author == null || b.author == null) return true;
  return a.author.trim().toLowerCase() === b.author.trim().toLowerCase();
};

export function matchRemoteBook<T extends { id: string; title: string; author: string | null }>(
  target: { title: string; author: string | null },
  items: readonly T[],
  used?: Set<string>,
): T | null {
  return items.find((r) => !used?.has(r.id) && sameBook(target, r)) ?? null;
}

export { progressUpdatedAtMs } from './lmClient';

/** a book whose sync waits on an explicit user choice */
export interface LmConflict { localId: string; remoteTitle: string }

export interface SpaceSyncSummary {
  pulled: number;
  pushed: number;
  inSync: number;
  none: number;
  failed: number;
  conflicts: LmConflict[];
}

export interface LmSyncDeps extends ReconcileDeps {
  client: Pick<LmClient, 'getBook' | 'getProgress' | 'putProgress'>;
  locals: readonly { id: string; title: string; author: string | null }[];
  /**
   * pair local↔server (keeps the revision baseline and a verified exact copy
   * when the identity is unchanged)
   */
  linkBook(localId: string, remoteId: string, versionId: string): Promise<void>;
}

async function readyVersionOf(deps: LmSyncDeps, spaceId: string, bookId: string): Promise<string | null> {
  const details: LmBookDetails = await deps.client.getBook(spaceId, bookId);
  return details.versions.find((v) => v.status === 'ready')?.id ?? null;
}

export async function syncSpaceProgress(
  deps: LmSyncDeps,
  spaceId: string,
  remotes: readonly LmBook[],
): Promise<SpaceSyncSummary> {
  const summary: SpaceSyncSummary = { pulled: 0, pushed: 0, inSync: 0, none: 0, failed: 0, conflicts: [] };
  const used = new Set<string>();
  for (const rb of remotes) {
    const local = matchRemoteBook(rb, deps.locals, used);
    if (!local) continue;
    used.add(local.id);
    try {
      const versionId = await readyVersionOf(deps, spaceId, rb.id);
      if (!versionId) { summary.none++; continue; }
      await deps.linkBook(local.id, rb.id, versionId);
      const outcome = await reconcileBook(deps, local.id);
      if (outcome.kind === 'conflict') summary.conflicts.push({ localId: local.id, remoteTitle: rb.title });
      else summary[outcome.kind]++;
    } catch {
      summary.failed++;
    }
  }
  return summary;
}
