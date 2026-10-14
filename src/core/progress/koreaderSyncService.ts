import { partialMd5Hex } from './partialMd5';
import type { KoSyncClient } from './koreaderSync';
import type { ReadingProgress } from '../../types';

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
  | { kind: 'conflict'; digest: string; server: number; local: number };

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
  return { kind: 'conflict', digest, server: server!.percentage, local: local!.fraction };
}

export async function applyServerProgress(
  deps: BookSyncDeps,
  bookId: string,
  server: { percentage: number; timestamp: number | null },
): Promise<void> {
  // a KOReader percentage cannot resolve to our cfis: drop it, the reader
  // resumes from the fraction (engine-side init/goToFraction handles that)
  await deps.saveProgress({
    bookId,
    cfi: null,
    fraction: server.percentage,
    sectionIndex: null,
    updatedAt: server.timestamp !== null ? server.timestamp * 1000 : Date.now(),
  });
}

export async function pushLocalProgress(
  deps: BookSyncDeps,
  digest: string,
  local: ReadingProgress,
): Promise<boolean> {
  return deps.client.updateProgress(digest, progressString(local.fraction), local.fraction);
}
