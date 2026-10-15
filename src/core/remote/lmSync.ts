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

// KOReader contract: percentage is a fraction 0..1 on the wire AND in the
// local DB; progress is an XPointer valid only for the exact bytes of the
// version. The timestamp helper lives with the client normalizer.
export { progressUpdatedAtMs } from './lmClient';

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
  /**
   * the local file is byte-identical to versionId (verified download/upload).
   * Without that proof only the percentage is exchanged: an XPointer from
   * other bytes is not a valid position in this version.
   */
  isExactCopy?(localId: string, versionId: string): Promise<boolean>;
}

const exactCopy = async (deps: Pick<LmSyncDeps, 'isExactCopy'>, localId: string, versionId: string): Promise<boolean> =>
  (await deps.isExactCopy?.(localId, versionId).catch(() => false)) ?? false;

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
      if (server && localProgress && Math.abs(server.percentage - localProgress.fraction) <= SYNC_EPSILON) {
        summary.inSync++;
        continue;
      }
      if (server && localProgress) {
        // diverging: park it for an explicit user choice (spec §8)
        summary.conflicts.push({ remoteId: rb.id, remoteTitle: rb.title, localId: local.id, versionId, server, local: localProgress });
        continue;
      }
      const exact = await exactCopy(deps, local.id, versionId);
      if (server) {
        await applyServerProgress(deps, local.id, server, exact);
        summary.pulled++;
      } else if (localProgress) {
        await pushLocalProgress(deps, spaceId, rb.id, versionId, localProgress, 0, exact);
        summary.pushed++;
      }
    } catch {
      summary.failed++;
    }
  }
  return summary;
}

/**
 * Server side chosen (or the only side): the percentage always applies; the
 * XPointer only on a verified copy of the same version. The local cfi is
 * dropped — the engine resolves the XPointer (else the fraction) on open.
 */
export async function applyServerProgress(
  deps: Pick<LmSyncDeps, 'saveProgress'>,
  localId: string,
  server: LmProgress,
  exact: boolean,
): Promise<void> {
  await deps.saveProgress({
    bookId: localId,
    cfi: null,
    xpointer: exact ? server.progress : null,
    fraction: server.percentage,
    sectionIndex: null,
    updatedAt: server.updatedAtMs || Date.now(),
  });
}

async function pushLocalProgress(
  deps: LmSyncDeps,
  spaceId: string,
  remoteId: string,
  versionId: string,
  local: ReadingProgress,
  expectedRevision: number,
  exact: boolean,
): Promise<void> {
  await deps.client.putProgress(spaceId, remoteId, {
    installationId: deps.installationId,
    operationId: deps.newOperationId(),
    expectedRevision,
    versionId,
    // never fabricated from the fraction: no verified anchor → null
    progress: exact ? (local.xpointer ?? null) : null,
    percentage: local.fraction,
  });
}

/** user chose the local side: re-read the server revision, then send a brand-new operation (spec §8 step 5) */
export async function pushLocalChoice(deps: LmSyncDeps, spaceId: string, conflict: LmConflict): Promise<void> {
  const server = await deps.client.getProgress(spaceId, conflict.remoteId, conflict.versionId);
  const exact = await exactCopy(deps, conflict.localId, conflict.versionId);
  await pushLocalProgress(deps, spaceId, conflict.remoteId, conflict.versionId, conflict.local, server?.revision ?? 0, exact);
}
