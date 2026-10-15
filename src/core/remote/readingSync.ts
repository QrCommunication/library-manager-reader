// Live reading sync glue: pull the server position when a linked book opens
// (server strictly newer wins), and push the local position into the journal
// after every page-turn save (spec §8). Positions travel in the KOReader
// format: progress = XPointer (exact copies only), percentage = fraction 0..1.
// Everything here is best-effort and silent — reading must never wait on the
// network.

import type { AppServices } from '../services';
import { createLmAccountDeps } from '../storage/expoSecureStore';
import { lmClientFromAccount, lmInstallationId, lmIsConnected, type LmAccountDeps } from './lmAccount';
import { flushProgressJournal } from './liveSync';
import { uuidV7 } from '../uuid';

/** cloud account helpers bound to the app's settings repo (cheap to build) */
export const accountDeps = (services: AppServices): LmAccountDeps => createLmAccountDeps(services.settings);

/**
 * Server position for a linked book, applied locally when strictly newer.
 * Called when a book opens, before the reader settles on the local position —
 * best-effort: any failure keeps the local position untouched.
 */
export async function pullReadingPosition(services: AppServices, bookId: string): Promise<void> {
  try {
    const link = await services.remoteSync.getLink(bookId);
    if (!link) return;
    const account = accountDeps(services);
    if (!(await lmIsConnected(account))) return;
    const client = await lmClientFromAccount(account);
    const server = await client.getProgress(link.spaceId, link.serverBookId, link.versionId);
    if (!server) return;
    const local = await services.progress.getProgress(bookId);
    // newest wins: the reader is not open long enough for a real conflict here
    if (local && local.updatedAt >= server.updatedAtMs) return;
    await services.progress.saveProgress({
      bookId,
      // the engine resolves the XPointer on these exact bytes (else the fraction)
      cfi: null,
      xpointer: link.exactCopy ? server.progress : null,
      fraction: server.percentage,
      sectionIndex: null,
      updatedAt: server.updatedAtMs || Date.now(),
    });
  } catch {
    // offline/expired/no rights: local position stays
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
    const account = accountDeps(services);
    if (!(await lmIsConnected(account))) return;
    const client = await lmClientFromAccount(account);
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
    await flushProgressJournal({
      client,
      repo: services.remoteSync,
      installationId: await lmInstallationId(account),
      newOperationId: uuidV7,
    });
  } catch (err) {
    console.warn('[reading-sync] push failed (kept in journal)', err);
  }
}
