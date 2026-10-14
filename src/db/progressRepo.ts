import type { DbDriver } from './driver';
import type { ReadingProgress } from '../core/types';

export function createProgressRepo(db: DbDriver) {
  return {
    async getProgress(bookId: string): Promise<ReadingProgress | null> {
      const r = await db.get<{ book_id: string; cfi: string | null; fraction: number; section_index: number | null; updated_at: number }>(
        'SELECT * FROM reading_progress WHERE book_id = ?', [bookId],
      );
      return r ? { bookId: r.book_id, cfi: r.cfi, fraction: r.fraction, sectionIndex: r.section_index, updatedAt: r.updated_at } : null;
    },
    async listProgress(): Promise<ReadingProgress[]> {
      const rows = await db.all<{ book_id: string; cfi: string | null; fraction: number; section_index: number | null; updated_at: number }>(
        'SELECT * FROM reading_progress',
      );
      return rows.map((r) => ({ bookId: r.book_id, cfi: r.cfi, fraction: r.fraction, sectionIndex: r.section_index, updatedAt: r.updated_at }));
    },
    async saveProgress(p: ReadingProgress): Promise<void> {
      await db.run(
        `INSERT INTO reading_progress (book_id, cfi, fraction, section_index, updated_at) VALUES (?,?,?,?,?)
         ON CONFLICT(book_id) DO UPDATE SET cfi=excluded.cfi, fraction=excluded.fraction, section_index=excluded.section_index, updated_at=excluded.updated_at`,
        [p.bookId, p.cfi, p.fraction, p.sectionIndex, p.updatedAt],
      );
    },
  };
}
