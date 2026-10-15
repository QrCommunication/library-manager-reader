import { partialMd5Hex } from './partialMd5';
import type { KoSyncClient } from './koreaderSync';
import type { ReadingProgress } from '../types';
import { xpointerOrNull } from './xpointer';

export interface BookSyncDeps {
  readAt(path: string, offset: number, length: number): Promise<Uint8Array | null>;
  getProgress(bookId: string): Promise<ReadingProgress | null>;
  saveProgress(p: ReadingProgress): Promise<void>;
  client: KoSyncClient;
}

export type BookSyncResult =
  | { kind: 'none' }
  | { kind: 'in_sync' }
  | { kind: 'pulled'; fraction: number }
  | { kind: 'pushed'; fraction: number }
  | {
      kind: 'conflict';
      digest: string;
      server: number;
      serverProgress: string | null;
      local: number;
      localXPointer: string | null;
      serverTimestamp: number | null;
      serverDevice: string | null;
      localUpdatedAt: number;
    };

// percentages compared with KOReader's own rounding granularity (1/10000)
const SYNC_EPSILON = 0.0001;

const progressString = (fraction: number): string => (fraction * 100).toFixed(1);

export async function syncBookProgress(
  deps: BookSyncDeps,
  book: { id: string },
  filePath: string,
): Promise<BookSyncResult> {
  const digest = await partialMd5Hex((offset, length) => deps.readAt(filePath, offset, length));
  const server = await deps.client.getProgress(digest);
  const local = await deps.getProgress(book.id);
  if (!server && !local) return { kind: 'none' };
  if (server && !local) {
    await applyServerProgress(deps, book.id, server);
    return { kind: 'pulled', fraction: server.percentage };
  }
  if (!server && local) {
    await pushLocalProgress(deps, digest, local);
    return { kind: 'pushed', fraction: local.fraction };
  }
  if (Math.abs(server!.percentage - local!.fraction) <= SYNC_EPSILON) return { kind: 'in_sync' };
  return {
    kind: 'conflict',
    digest,
    server: server!.percentage,
    serverProgress: server!.progress,
    local: local!.fraction,
    localXPointer: local!.xpointer ?? null,
    serverTimestamp: server!.timestamp,
    serverDevice: server!.device,
    localUpdatedAt: local!.updatedAt,
  };
}

export type KoSyncConflict = Extract<BookSyncResult, { kind: 'conflict' }> & { bookId: string };

export interface LibrarySyncSummary {
  pushed: number;
  pulled: number;
  inSync: number;
  none: number;
  // diverging positions are NOT resolved here (no clock / max-percentage
  // rule): the caller presents each one for an explicit choice, then calls
  // applyServerProgress or pushLocalProgress
  conflicts: KoSyncConflict[];
  failed: number;
}

export async function syncLibraryProgress(
  deps: BookSyncDeps,
  books: readonly { id: string; filePath: string }[],
): Promise<LibrarySyncSummary> {
  const summary: LibrarySyncSummary = { pushed: 0, pulled: 0, inSync: 0, none: 0, conflicts: [], failed: 0 };
  for (const book of books) {
    try {
      const r = await syncBookProgress(deps, book, book.filePath);
      if (r.kind === 'none') summary.none++;
      else if (r.kind === 'in_sync') summary.inSync++;
      else if (r.kind === 'pulled') summary.pulled++;
      else if (r.kind === 'pushed') summary.pushed++;
      else summary.conflicts.push({ ...r, bookId: book.id });
    } catch {
      summary.failed++;
    }
  }
  return summary;
}

/** explicit choice for one conflict (kosync document key = r.digest) */
export async function resolveKoSyncConflict(deps: BookSyncDeps, c: KoSyncConflict, choice: 'server' | 'local'): Promise<void> {
  if (choice === 'server') {
    await applyServerProgress(deps, c.bookId, { percentage: c.server, progress: c.serverProgress, timestamp: c.serverTimestamp });
  } else {
    await pushLocalProgress(deps, c.digest, { fraction: c.local, xpointer: c.localXPointer });
  }
}

export async function applyServerProgress(
  deps: BookSyncDeps,
  bookId: string,
  server: { percentage: number; progress?: string | null; timestamp: number | null },
): Promise<void> {
  // the kosync document key is the partial MD5 of THIS file, so a KOReader
  // XPointer addresses these exact bytes: keep it (the engine resolves it on
  // open, else falls back to the fraction). Our cfi cannot be derived here.
  await deps.saveProgress({
    bookId,
    cfi: null,
    xpointer: xpointerOrNull(server.progress),
    fraction: server.percentage,
    sectionIndex: null,
    // local change time (local clock): Library Manager reconciliation compares
    // it with its own local agreement time, never with another device's clock
    updatedAt: Date.now(),
  });
}

export async function pushLocalProgress(
  deps: BookSyncDeps,
  digest: string,
  local: Pick<ReadingProgress, 'fraction' | 'xpointer'>,
): Promise<boolean> {
  // KOReader reads `progress` as an XPointer for reflowable books; the legacy
  // percent string only remains when no precise anchor is known
  return deps.client.updateProgress(digest, xpointerOrNull(local.xpointer) ?? progressString(local.fraction), local.fraction);
}
