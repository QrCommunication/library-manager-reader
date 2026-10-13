import type { DbDriver } from './driver';
import type { Annotation, HighlightColor, NewAnnotation } from '../core/types';

interface AnnotationRow { id: string; book_id: string; cfi: string; color: HighlightColor; note: string | null; excerpt: string; created_at: number; updated_at: number; deleted_at: number | null }
const toAnnotation = (r: AnnotationRow): Annotation => ({ id: r.id, bookId: r.book_id, cfi: r.cfi, color: r.color, note: r.note, excerpt: r.excerpt, createdAt: r.created_at, updatedAt: r.updated_at, deletedAt: r.deleted_at });

export function createAnnotationsRepo(db: DbDriver, newId: () => string) {
  return {
    async add(input: NewAnnotation): Promise<Annotation> {
      const a: Annotation = { ...input, id: input.id ?? newId(), updatedAt: input.createdAt, deletedAt: null };
      await db.run(
        'INSERT INTO annotations (id,book_id,cfi,color,note,excerpt,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?)',
        [a.id, a.bookId, a.cfi, a.color, a.note, a.excerpt, a.createdAt, a.updatedAt, a.deletedAt],
      );
      return a;
    },
    async listByBook(bookId: string): Promise<Annotation[]> {
      // ruling: sort by created_at ASC — lexicographic CFI ordering is not reliable
      const rows = await db.all<AnnotationRow>('SELECT * FROM annotations WHERE book_id = ? AND deleted_at IS NULL ORDER BY created_at ASC', [bookId]);
      return rows.map(toAnnotation);
    },
    async setNote(id: string, note: string | null, at: number): Promise<void> {
      await db.run('UPDATE annotations SET note = ?, updated_at = ? WHERE id = ?', [note, at, id]);
    },
    async setColor(id: string, color: HighlightColor, at: number): Promise<void> {
      await db.run('UPDATE annotations SET color = ?, updated_at = ? WHERE id = ?', [color, at, id]);
    },
    async markDeleted(id: string, at: number): Promise<void> {
      await db.run('UPDATE annotations SET deleted_at = ?, updated_at = ? WHERE id = ?', [at, at, id]);
    },
    async purgeDeletedBefore(cutoff: number): Promise<void> {
      await db.run('DELETE FROM annotations WHERE deleted_at IS NOT NULL AND deleted_at < ?', [cutoff]);
    },
  };
}
