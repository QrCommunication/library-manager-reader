import type { DbDriver } from './driver';

// Server identity of a local book (which cloud copy it came from) plus the
// last revision this installation knows — the optimistic-concurrency starting
// point for the next progress push.
export interface RemoteLink {
  spaceId: string;
  serverBookId: string;
  versionId: string;
  /**
   * the local file holds exactly the bytes of versionId (sha256 verified).
   * Only then do XPointers travel: a KOReader position belongs to the bytes
   * of its version, a title-matched local file only shares the percentage.
   */
  exactCopy?: boolean;
}

export interface PendingProgressOp {
  id: number;
  bookId: string;
  spaceId: string;
  serverBookId: string;
  versionId: string;
  operationId: string;
  /** KOReader XPointer, null when no precise anchor is known */
  progress: string | null;
  /** fraction 0..1 */
  percentage: number;
}

export interface JournalInput {
  bookId: string;
  spaceId: string;
  serverBookId: string;
  versionId: string;
  operationId: string;
  progress: string | null;
  percentage: number;
}

export function createRemoteSyncRepo(db: DbDriver) {
  return {
    /**
     * link (or relink — resets the revision baseline) a local book to the
     * cloud copy. A relink to the SAME version never downgrades a verified
     * exact copy (a title-matched relink carries no byte proof).
     */
    async linkBook(link: RemoteLink & { bookId: string }): Promise<void> {
      await db.run(
        `INSERT INTO remote_books (book_id, space_id, server_book_id, version_id, last_revision, exact_copy, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)
         ON CONFLICT(book_id) DO UPDATE SET
           exact_copy = CASE WHEN remote_books.version_id = excluded.version_id
                             THEN MAX(remote_books.exact_copy, excluded.exact_copy)
                             ELSE excluded.exact_copy END,
           space_id = excluded.space_id,
           server_book_id = excluded.server_book_id,
           version_id = excluded.version_id,
           last_revision = 0,
           updated_at = excluded.updated_at`,
        [link.bookId, link.spaceId, link.serverBookId, link.versionId, link.exactCopy ? 1 : 0, Date.now()],
      );
    },

    async getLink(bookId: string): Promise<RemoteLink | null> {
      const row = await db.get<{ spaceId: string; serverBookId: string; versionId: string; exactCopy: number }>(
        'SELECT space_id AS spaceId, server_book_id AS serverBookId, version_id AS versionId, exact_copy AS exactCopy FROM remote_books WHERE book_id = ?',
        [bookId],
      );
      return row ? { spaceId: row.spaceId, serverBookId: row.serverBookId, versionId: row.versionId, exactCopy: row.exactCopy === 1 } : null;
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
          `INSERT INTO progress_journal (book_id, space_id, server_book_id, version_id, operation_id, progress, percentage, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [op.bookId, op.spaceId, op.serverBookId, op.versionId, op.operationId, op.progress, op.percentage, Date.now()],
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
                version_id AS versionId, operation_id AS operationId, progress, percentage
         FROM progress_journal ORDER BY created_at ASC, id ASC`,
      );
    },

    async removeOp(id: number): Promise<void> {
      await db.run('DELETE FROM progress_journal WHERE id = ?', [id]);
    },
  };
}

export type RemoteSyncRepo = ReturnType<typeof createRemoteSyncRepo>;
