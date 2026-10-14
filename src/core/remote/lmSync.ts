import type { LmBook, LmClient } from './lmClient';
import type { ReadingProgress } from '../types';

// same rounding granularity as the KOReader bridge
const SYNC_EPSILON = 0.0001;

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

export interface SpaceSyncSummary { pulled: number; pushed: number; inSync: number; none: number; failed: number }

export interface LmSyncDeps {
  client: Pick<LmClient, 'getProgress' | 'putProgress'>;
  locals: readonly { id: string; title: string; author: string | null }[];
  getProgress(bookId: string): Promise<ReadingProgress | null>;
  saveProgress(p: ReadingProgress): Promise<void>;
}

export async function syncSpaceProgress(
  deps: LmSyncDeps,
  spaceId: string,
  remotes: readonly LmBook[],
): Promise<SpaceSyncSummary> {
  const summary: SpaceSyncSummary = { pulled: 0, pushed: 0, inSync: 0, none: 0, failed: 0 };
  const used = new Set<string>();
  for (const rb of remotes) {
    const local = matchRemoteBook(rb, deps.locals, used);
    if (!local) continue;
    used.add(local.id);
    try {
      const server = await deps.client.getProgress(spaceId, rb.id);
      const localProgress = await deps.getProgress(local.id);
      if (!server && !localProgress) { summary.none++; continue; }
      if (server && localProgress && Math.abs(server.fraction - localProgress.fraction) <= SYNC_EPSILON) {
        summary.inSync++;
        continue;
      }
      // newest wins; the server keeps unix seconds like KOReader
      if (server && (!localProgress || server.updatedAt * 1000 > localProgress.updatedAt)) {
        await deps.saveProgress({
          bookId: local.id,
          cfi: null,
          fraction: server.fraction,
          sectionIndex: null,
          updatedAt: server.updatedAt * 1000,
        });
        summary.pulled++;
      } else if (localProgress) {
        await deps.client.putProgress(spaceId, rb.id, {
          fraction: localProgress.fraction,
          updatedAt: Math.floor(localProgress.updatedAt / 1000),
        });
        summary.pushed++;
      }
    } catch {
      summary.failed++;
    }
  }
  return summary;
}
