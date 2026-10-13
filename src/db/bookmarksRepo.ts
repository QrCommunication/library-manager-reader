import type { DbDriver } from './driver';
import type { Bookmark, NewBookmark } from '../core/types';

interface BmRow { id: string; book_id: string; cfi: string; fraction: number; preview_text: string | null; created_at: number; updated_at: number; deleted_at: number | null }
const toBookmark = (r: BmRow): Bookmark => ({ id: r.id, bookId: r.book_id, cfi: r.cfi, fraction: r.fraction, previewText: r.preview_text, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at });

export function createBookmarksRepo(db: DbDriver, newId: () => string) {
  return {
    async addBookmark(input: NewBookmark): Promise<Bookmark> {
      const bm: Bookmark = { ...input, id: input.id ?? newId(), updatedAt: input.createdAt, deletedAt: null };
      await db.run(
        'INSERT INTO bookmarks (id,book_id,cfi,fraction,preview_text,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?)',
        [bm.id, bm.bookId, bm.cfi, bm.fraction, bm.previewText, bm.createdAt, bm.updatedAt, bm.deletedAt],
      );
      return bm;
    },
    async listByBook(bookId: string): Promise<Bookmark[]> {
      const rows = await db.all<BmRow>('SELECT * FROM bookmarks WHERE book_id = ? AND deleted_at IS NULL ORDER BY created_at ASC', [bookId]);
      return rows.map(toBookmark);
    },
    async markDeleted(id: string, at: number): Promise<void> {
      await db.run('UPDATE bookmarks SET deleted_at = ?, updated_at = ? WHERE id = ?', [at, at, id]);
    },
  };
}
