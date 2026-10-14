// Live reading sync glue: pull the server position when a linked book opens
// (server strictly newer wins), and push the local position into the journal
// after every page-turn save (spec §8). Everything here is best-effort and
// silent — reading must never wait on the network.

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
    if (local && local.updatedAt >= server.updatedAt * 1000) return;
    await services.progress.saveProgress({
      bookId,
      cfi: server.cfi,
      fraction: server.percent / 100,
      sectionIndex: null,
      updatedAt: server.updatedAt * 1000,
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
  position: { cfi: string | null; fraction: number },
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
      cfi: position.cfi,
      chapterId: null,
      percent: Math.min(100, Math.max(0, position.fraction * 100)),
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
