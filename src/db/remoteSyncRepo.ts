import type { DbDriver } from './driver';

// Server identity of a local book (which cloud copy it came from), the last
// server revision this installation agreed on, and when (local clock) that
// agreement happened — the optimistic-concurrency starting point for the next
// progress push and the "did the local position move since?" test.
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

export interface RemoteLinkState extends RemoteLink {
  exactCopy: boolean;
  lastRevision: number;
  /** local ms of the last agreement with the server (0: never) */
  syncedAt: number;
}

export type JournalState = 'pending' | 'conflict';

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
  /** frozen at the first send (or by an explicit conflict choice); null: not yet */
  expectedRevision: number | null;
  /** local ms of the first send; null: never sent — only such ops may be coalesced */
  attemptedAt: number | null;
  state: JournalState;
  /** server revision reported by the 409, when known */
  conflictRevision: number | null;
  createdAt: number;
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

const OP_COLUMNS = `id, book_id AS bookId, space_id AS spaceId, server_book_id AS serverBookId,
  version_id AS versionId, operation_id AS operationId, progress, percentage,
  expected_revision AS expectedRevision, attempted_at AS attemptedAt, state,
  conflict_revision AS conflictRevision, created_at AS createdAt`;

export function createRemoteSyncRepo(db: DbDriver) {
  const tx = async (work: () => Promise<void>): Promise<void> => {
    await db.exec('BEGIN');
    try {
      await work();
      await db.exec('COMMIT');
    } catch (err) {
      await db.exec('ROLLBACK').catch(() => { /* no tx */ });
      throw err;
    }
  };

  return {
    /**
     * link (or relink) a local book to the cloud copy. Relinking the SAME
     * server book + version keeps the revision baseline and never downgrades
     * a verified exact copy; another identity starts from scratch.
     */
    async linkBook(link: RemoteLink & { bookId: string }): Promise<void> {
      await db.run(
        `INSERT INTO remote_books (book_id, space_id, server_book_id, version_id, last_revision, exact_copy, synced_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, 0, ?)
         ON CONFLICT(book_id) DO UPDATE SET
           exact_copy = CASE WHEN same THEN MAX(remote_books.exact_copy, excluded.exact_copy) ELSE excluded.exact_copy END,
           last_revision = CASE WHEN same THEN remote_books.last_revision ELSE 0 END,
           synced_at = CASE WHEN same THEN remote_books.synced_at ELSE 0 END,
           space_id = excluded.space_id,
           server_book_id = excluded.server_book_id,
           version_id = excluded.version_id,
           updated_at = excluded.updated_at`
          .replace(/\bsame\b/g, '(remote_books.version_id = excluded.version_id AND remote_books.server_book_id = excluded.server_book_id)'),
        [link.bookId, link.spaceId, link.serverBookId, link.versionId, link.exactCopy ? 1 : 0, Date.now()],
      );
    },

    async getLink(bookId: string): Promise<RemoteLinkState | null> {
      const row = await db.get<{ spaceId: string; serverBookId: string; versionId: string; exactCopy: number; lastRevision: number; syncedAt: number }>(
        `SELECT space_id AS spaceId, server_book_id AS serverBookId, version_id AS versionId, exact_copy AS exactCopy,
                last_revision AS lastRevision, synced_at AS syncedAt
         FROM remote_books WHERE book_id = ?`,
        [bookId],
      );
      return row
        ? { spaceId: row.spaceId, serverBookId: row.serverBookId, versionId: row.versionId, exactCopy: row.exactCopy === 1, lastRevision: row.lastRevision, syncedAt: row.syncedAt }
        : null;
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

    /** agreement reached at `revision` (receipt persisted, or server position applied) */
    async markSynced(bookId: string, revision: number, at: number = Date.now()): Promise<void> {
      await db.run('UPDATE remote_books SET last_revision = ?, synced_at = ? WHERE book_id = ?', [revision, at, bookId]);
    },

    /**
     * journal a new position. Coalescing only replaces this book's ops that
     * were never sent: an op already sent (maybe applied, response lost) is
     * kept and replayed as-is before the new one.
     */
    async enqueueOp(op: JournalInput, opts: { expectedRevision?: number } = {}): Promise<void> {
      await tx(async () => {
        await db.run("DELETE FROM progress_journal WHERE book_id = ? AND attempted_at IS NULL AND state = 'pending'", [op.bookId]);
        await db.run(
          `INSERT INTO progress_journal (book_id, space_id, server_book_id, version_id, operation_id, progress, percentage, expected_revision, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [op.bookId, op.spaceId, op.serverBookId, op.versionId, op.operationId, op.progress, op.percentage, opts.expectedRevision ?? null, Date.now()],
        );
      });
    },

    /** every journaled op (pending and parked conflicts), oldest first */
    async pendingOps(): Promise<PendingProgressOp[]> {
      return db.all<PendingProgressOp>(`SELECT ${OP_COLUMNS} FROM progress_journal ORDER BY id ASC`);
    },

    async opsForBook(bookId: string): Promise<PendingProgressOp[]> {
      return db.all<PendingProgressOp>(`SELECT ${OP_COLUMNS} FROM progress_journal WHERE book_id = ? ORDER BY id ASC`, [bookId]);
    },

    /** freeze the body before the first send (no-op when already frozen) */
    async markAttempted(id: number, expectedRevision: number, at: number = Date.now()): Promise<void> {
      await db.run(
        'UPDATE progress_journal SET expected_revision = COALESCE(expected_revision, ?), attempted_at = COALESCE(attempted_at, ?) WHERE id = ?',
        [expectedRevision, at, id],
      );
    },

    async markConflict(id: number, serverRevision: number | null): Promise<void> {
      await db.run("UPDATE progress_journal SET state = 'conflict', conflict_revision = ? WHERE id = ?", [serverRevision, id]);
    },

    /** receipt persisted: the op leaves the journal and the revision moves on, atomically */
    async applyReceipt(id: number, bookId: string, revision: number, at: number = Date.now()): Promise<void> {
      await tx(async () => {
        await db.run('DELETE FROM progress_journal WHERE id = ?', [id]);
        await db.run('UPDATE remote_books SET last_revision = ?, synced_at = ? WHERE book_id = ?', [revision, at, bookId]);
      });
    },

    async removeOp(id: number): Promise<void> {
      await db.run('DELETE FROM progress_journal WHERE id = ?', [id]);
    },

    async removeBookOps(bookId: string): Promise<void> {
      await db.run('DELETE FROM progress_journal WHERE book_id = ?', [bookId]);
    },

    /** books whose sync waits on an explicit user choice */
    async conflictedBooks(): Promise<string[]> {
      const rows = await db.all<{ bookId: string }>("SELECT DISTINCT book_id AS bookId FROM progress_journal WHERE state = 'conflict' ORDER BY id");
      return rows.map((r) => r.bookId);
    },
  };
}

export type RemoteSyncRepo = ReturnType<typeof createRemoteSyncRepo>;
