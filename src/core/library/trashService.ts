import type { FsAdapter } from '../storage/fsAdapter';
import type { StoragePaths } from '../storage/paths';
import type { Book } from '../types';

export const TRASH_RETENTION_DAYS = 30;

export interface TrashDeps {
  fs: Pick<FsAdapter, 'remove'>;
  paths: StoragePaths;
  books: {
    listDeleted(): Promise<Book[]>;
    purgeBook(id: string): Promise<void>;
  };
}

// file removal rides with the hard delete: a purged book must not leave
// orphaned blobs behind (the tombstone era keeps them for restore)
export async function purgeBookFiles(deps: TrashDeps, book: Pick<Book, 'id' | 'format'>): Promise<void> {
  await deps.books.purgeBook(book.id);
  await deps.fs.remove(deps.paths.bookPath(book.id, book.format)).catch(() => {});
  await deps.fs.remove(deps.paths.coverPath(book.id)).catch(() => {});
}

export async function emptyTrash(deps: TrashDeps): Promise<number> {
  const deleted = await deps.books.listDeleted();
  for (const b of deleted) await purgeBookFiles(deps, b);
  return deleted.length;
}

export async function purgeExpiredTrash(deps: TrashDeps, now: number = Date.now()): Promise<number> {
  const cutoff = now - TRASH_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  const deleted = await deps.books.listDeleted();
  const expired = deleted.filter((b) => (b.deletedAt ?? 0) <= cutoff);
  for (const b of expired) await purgeBookFiles(deps, b);
  return expired.length;
}
