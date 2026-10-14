import type { LmBook, LmBookDetails, LmClient, LmProgress } from './lmClient';
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

// progress rides the wire as percent 0-100; the local DB stores fraction 0-1
export const fractionToPercent = (fraction: number): number => fraction * 100;
export const percentToFraction = (percent: number): number => percent / 100;

// the spec shows unix seconds in examples but does not pin the unit
export function progressUpdatedAtMs(updatedAt: number): number {
  return updatedAt > 1e12 ? updatedAt : updatedAt * 1000;
}

/** positions diverge and the user must choose — never resolved silently */
export interface LmConflict {
  remoteId: string;
  remoteTitle: string;
  localId: string;
  versionId: string;
  server: LmProgress;
  local: ReadingProgress;
}

export interface SpaceSyncSummary {
  pulled: number;
  pushed: number;
  inSync: number;
  none: number;
  failed: number;
  conflicts: LmConflict[];
}

export interface LmSyncDeps {
  client: Pick<LmClient, 'getBook' | 'getProgress' | 'putProgress'>;
  locals: readonly { id: string; title: string; author: string | null }[];
  getProgress(bookId: string): Promise<ReadingProgress | null>;
  saveProgress(p: ReadingProgress): Promise<void>;
  installationId: string;
  newOperationId: () => string;
  /** observed local↔server pairing (drives the live page-turn sync) */
  onLink?(localId: string, remoteId: string, versionId: string): void;
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
      deps.onLink?.(local.id, rb.id, versionId);
      const server = await deps.client.getProgress(spaceId, rb.id, versionId);
      const localProgress = await deps.getProgress(local.id);
      if (!server && !localProgress) { summary.none++; continue; }
      if (server && localProgress && Math.abs(percentToFraction(server.percent) - localProgress.fraction) <= SYNC_EPSILON) {
        summary.inSync++;
        continue;
      }
      if (server && localProgress) {
        // diverging: park it for an explicit user choice (spec §8)
        summary.conflicts.push({ remoteId: rb.id, remoteTitle: rb.title, localId: local.id, versionId, server, local: localProgress });
        continue;
      }
      if (server) {
        await applyServerProgress(deps, local.id, server);
        summary.pulled++;
      } else if (localProgress) {
        await pushLocalProgress(deps, spaceId, rb.id, versionId, localProgress, 0);
        summary.pushed++;
      }
    } catch {
      summary.failed++;
    }
  }
  return summary;
}

export async function applyServerProgress(
  deps: Pick<LmSyncDeps, 'saveProgress'>,
  localId: string,
  server: LmProgress,
): Promise<void> {
  await deps.saveProgress({
    bookId: localId,
    cfi: server.cfi,
    fraction: percentToFraction(server.percent),
    sectionIndex: null,
    updatedAt: progressUpdatedAtMs(server.updatedAt),
  });
}

async function pushLocalProgress(
  deps: LmSyncDeps,
  spaceId: string,
  remoteId: string,
  versionId: string,
  local: ReadingProgress,
  expectedRevision: number,
): Promise<void> {
  await deps.client.putProgress(spaceId, remoteId, {
    installationId: deps.installationId,
    operationId: deps.newOperationId(),
    expectedRevision,
    versionId,
    cfi: local.cfi,
    chapterId: null,
    percent: fractionToPercent(local.fraction),
  });
}

/** user chose the local side: re-read the server revision, then send a brand-new operation (spec §8 step 5) */
export async function pushLocalChoice(deps: LmSyncDeps, spaceId: string, conflict: LmConflict): Promise<void> {
  const server = await deps.client.getProgress(spaceId, conflict.remoteId, conflict.versionId);
  await pushLocalProgress(deps, spaceId, conflict.remoteId, conflict.versionId, conflict.local, server?.revision ?? 0);
}
