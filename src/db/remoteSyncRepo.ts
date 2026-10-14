import type { DbDriver } from './driver';

// Server identity of a local book (which cloud copy it came from) plus the
// last revision this installation knows — the optimistic-concurrency starting
// point for the next progress push.
export interface RemoteLink {
  spaceId: string;
  serverBookId: string;
  versionId: string;
}

export interface PendingProgressOp {
  id: number;
  bookId: string;
  spaceId: string;
  serverBookId: string;
  versionId: string;
  operationId: string;
  cfi: string | null;
  chapterId: string | null;
  percent: number;
}

export interface JournalInput {
  bookId: string;
  spaceId: string;
  serverBookId: string;
  versionId: string;
  operationId: string;
  cfi: string | null;
  chapterId: string | null;
  percent: number;
}

export function createRemoteSyncRepo(db: DbDriver) {
  return {
    /** link (or relink — resets the revision baseline) a local book to the cloud copy */
    async linkBook(link: RemoteLink & { bookId: string }): Promise<void> {
      await db.run(
        `INSERT INTO remote_books (book_id, space_id, server_book_id, version_id, last_revision, updated_at)
         VALUES (?, ?, ?, ?, 0, ?)
         ON CONFLICT(book_id) DO UPDATE SET
           space_id = excluded.space_id,
           server_book_id = excluded.server_book_id,
           version_id = excluded.version_id,
           last_revision = 0,
           updated_at = excluded.updated_at`,
        [link.bookId, link.spaceId, link.serverBookId, link.versionId, Date.now()],
      );
    },

    async getLink(bookId: string): Promise<RemoteLink | null> {
      const row = await db.get<RemoteLink>('SELECT space_id AS spaceId, server_book_id AS serverBookId, version_id AS versionId FROM remote_books WHERE book_id = ?', [bookId]);
      return row ?? null;
    },

    async unlinkBook(bookId: string): Promise<void> {
      await db.run('DELETE FROM remote_books WHERE book_id = ?', [bookId]);
    },

    async getLastRevision(bookId: string): Promise<number> {
      const row = await db.get<{ last_revision: number }>('SELECT last_revision FROM remote_books WHERE book_id = ?', [bookId]);
      return row?.last_revision ?? 0;
    },

    async setLastRevision(bookId: string, revision: number): Promise<void> {
      await db.run('UPDATE remote_books SET last_revision = ? WHERE book_id = ?', [revision, bookId]);
    },

    /** coalescing journal: one pending op per book — a newer position replaces the unsent one */
    async enqueueOp(op: JournalInput): Promise<void> {
      await db.exec('BEGIN');
      try {
        await db.run('DELETE FROM progress_journal WHERE book_id = ?', [op.bookId]);
        await db.run(
          `INSERT INTO progress_journal (book_id, space_id, server_book_id, version_id, operation_id, cfi, chapter_id, percent, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [op.bookId, op.spaceId, op.serverBookId, op.versionId, op.operationId, op.cfi, op.chapterId, op.percent, Date.now()],
        );
        await db.exec('COMMIT');
      } catch (err) {
        await db.exec('ROLLBACK').catch(() => { /* no tx */ });
        throw err;
      }
    },

    /** pending ops, oldest book first — the flusher works in order */
    async pendingOps(): Promise<PendingProgressOp[]> {
      return db.all<PendingProgressOp>(
        `SELECT id, book_id AS bookId, space_id AS spaceId, server_book_id AS serverBookId,
                version_id AS versionId, operation_id AS operationId, cfi, chapter_id AS chapterId, percent
         FROM progress_journal ORDER BY created_at ASC, id ASC`,
      );
    },

    async removeOp(id: number): Promise<void> {
      await db.run('DELETE FROM progress_journal WHERE id = ?', [id]);
    },
  };
}

export type RemoteSyncRepo = ReturnType<typeof createRemoteSyncRepo>;
