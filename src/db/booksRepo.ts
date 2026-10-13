import type { DbDriver } from './driver';
import type { Book, BookFormat, NewBook, OriginalFormat } from '../core/types';

interface BookRow {
  id: string; title: string; author: string | null; format: string; original_format: string | null;
  file_name: string; file_size: number; language: string | null; publisher: string | null;
  drm_identifier: string | null; added_at: number; updated_at: number; deleted_at: number | null; last_read_at: number | null;
}

const rowToBook = (r: BookRow): Book => ({
  id: r.id, title: r.title, author: r.author, format: r.format as BookFormat,
  originalFormat: r.original_format as OriginalFormat | null, fileName: r.file_name, fileSize: r.file_size,
  language: r.language, publisher: r.publisher, drmIdentifier: r.drm_identifier,
  addedAt: r.added_at, updatedAt: r.updated_at, deletedAt: r.deleted_at, lastReadAt: r.last_read_at,
});

export function createBooksRepo(db: DbDriver, newId: () => string) {
  return {
    async createBook(input: NewBook): Promise<Book> {
      const b: Book = {
        ...input,
        id: input.id ?? newId(),
        author: input.author ?? null,
        language: input.language ?? null,
        publisher: input.publisher ?? null,
        drmIdentifier: input.drmIdentifier ?? null,
        originalFormat: input.originalFormat ?? null,
        deletedAt: null,
        lastReadAt: null,
      };
      await db.run(
        `INSERT INTO books (id,title,author,format,original_format,file_name,file_size,language,publisher,drm_identifier,added_at,updated_at,deleted_at,last_read_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [b.id, b.title, b.author, b.format, b.originalFormat, b.fileName, b.fileSize, b.language, b.publisher, b.drmIdentifier, b.addedAt, b.updatedAt, b.deletedAt, b.lastReadAt],
      );
      return b;
    },
    async getBook(id: string): Promise<Book | null> {
      const row = await db.get<BookRow>('SELECT * FROM books WHERE id = ?', [id]);
      return row ? rowToBook(row) : null;
    },
    async listBooks(opts: { sort: 'recent' | 'added' | 'title'; query?: string }): Promise<Book[]> {
      const order = {
        recent: 'ORDER BY COALESCE(last_read_at, added_at) DESC, title COLLATE NOCASE ASC',
        added: 'ORDER BY added_at DESC',
        title: 'ORDER BY title COLLATE NOCASE ASC',
      }[opts.sort];
      const where = ['deleted_at IS NULL'];
      const params: unknown[] = [];
      if (opts.query) {
        where.push('(title LIKE ? OR author LIKE ?)');
        const like = `%${opts.query}%`;
        params.push(like, like);
      }
      const rows = await db.all<BookRow>(`SELECT * FROM books WHERE ${where.join(' AND ')} ${order}`, params);
      return rows.map(rowToBook);
    },
    async markDeleted(id: string, at: number): Promise<void> {
      await db.run('UPDATE books SET deleted_at = ?, updated_at = ? WHERE id = ?', [at, at, id]);
    },
    async purgeDeletedBefore(at: number): Promise<number> {
      const r = await db.run('DELETE FROM books WHERE deleted_at IS NOT NULL AND deleted_at <= ?', [at]);
      return r.changes ?? 0;
    },
    async touchLastRead(id: string, at: number): Promise<void> {
      await db.run('UPDATE books SET last_read_at = ? WHERE id = ?', [at, id]);
    },
    async countAll(): Promise<number> {
      const row = await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM books WHERE deleted_at IS NULL');
      return row?.n ?? 0;
    },
  };
}
