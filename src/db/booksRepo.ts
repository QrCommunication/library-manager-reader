import type { DbDriver } from './driver';
import type { Book, BookFormat, NewBook, OriginalFormat } from '../core/types';

interface BookRow {
  id: string; title: string; author: string | null; format: string; original_format: string | null;
  file_name: string; file_size: number; language: string | null; publisher: string | null;
  series: string | null; series_index: number | null;
  drm_identifier: string | null; added_at: number; updated_at: number; deleted_at: number | null; last_read_at: number | null;
}

const rowToBook = (r: BookRow): Book => ({
  id: r.id, title: r.title, author: r.author, format: r.format as BookFormat,
  originalFormat: r.original_format as OriginalFormat | null, fileName: r.file_name, fileSize: r.file_size,
  language: r.language, publisher: r.publisher, series: r.series, seriesIndex: r.series_index,
  drmIdentifier: r.drm_identifier,
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
        series: input.series ?? null,
        seriesIndex: input.seriesIndex ?? null,
        drmIdentifier: input.drmIdentifier ?? null,
        originalFormat: input.originalFormat ?? null,
        deletedAt: null,
        lastReadAt: null,
      };
      await db.run(
        `INSERT INTO books (id,title,author,format,original_format,file_name,file_size,language,publisher,series,series_index,drm_identifier,added_at,updated_at,deleted_at,last_read_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [b.id, b.title, b.author, b.format, b.originalFormat, b.fileName, b.fileSize, b.language, b.publisher, b.series, b.seriesIndex, b.drmIdentifier, b.addedAt, b.updatedAt, b.deletedAt, b.lastReadAt],
      );
      return b;
    },
    async getBook(id: string): Promise<Book | null> {
      const row = await db.get<BookRow>('SELECT * FROM books WHERE id = ?', [id]);
      return row ? rowToBook(row) : null;
    },
    async listBooks(opts: { sort: 'recent' | 'added' | 'title' | 'series'; query?: string; series?: string }): Promise<Book[]> {
      const order = {
        recent: 'ORDER BY COALESCE(last_read_at, added_at) DESC, title COLLATE NOCASE ASC',
        added: 'ORDER BY added_at DESC',
        title: 'ORDER BY title COLLATE NOCASE ASC',
        // tome order within a series; series-less books grouped last
        series: 'ORDER BY (series IS NULL) ASC, series COLLATE NOCASE ASC, (series_index IS NULL) ASC, series_index ASC, title COLLATE NOCASE ASC',
      }[opts.sort];
      const where = ['deleted_at IS NULL'];
      const params: unknown[] = [];
      if (opts.query) {
        // user input is matched literally: % and _ are escaped and the ESCAPE
        // clause is declared, so "50%" does not match "50X"
        where.push("(title LIKE ? ESCAPE '\\' OR author LIKE ? ESCAPE '\\')");
        const like = `%${opts.query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
        params.push(like, like);
      }
      if (opts.series) {
        // case-insensitive so a chip picked from the series sheet matches books
        // whose metadata spells the series differently
        where.push('series COLLATE NOCASE = ?');
        params.push(opts.series);
      }
      const rows = await db.all<BookRow>(`SELECT * FROM books WHERE ${where.join(' AND ')} ${order}`, params);
      return rows.map(rowToBook);
    },
    async listSeries(): Promise<{ name: string; count: number }[]> {
      const rows = await db.all<{ series: string; n: number }>(
        'SELECT series, COUNT(*) AS n FROM books WHERE deleted_at IS NULL AND series IS NOT NULL GROUP BY series COLLATE NOCASE ORDER BY series COLLATE NOCASE ASC',
      );
      return rows.map((r) => ({ name: r.series, count: r.n }));
    },
    async findDuplicate(key: { identifier: string | null; title: string | null; author: string | null }): Promise<Book | null> {
      // identifier match wins; fallback compares trimmed/lowercased title AND
      // author (a missing incoming author must not match a book that has one)
      const row = await db.get<BookRow>(
        `SELECT * FROM books WHERE deleted_at IS NULL AND (
           (? IS NOT NULL AND drm_identifier IS NOT NULL AND LOWER(TRIM(drm_identifier)) = LOWER(TRIM(?)))
           OR (LOWER(TRIM(title)) = LOWER(TRIM(?)) AND LOWER(COALESCE(author,'')) = LOWER(COALESCE(?,'')))
         ) LIMIT 1`,
        [key.identifier, key.identifier, key.title, key.author ?? ''],
      );
      return row ? rowToBook(row) : null;
    },
    async listDeleted(): Promise<Book[]> {
      const rows = await db.all<BookRow>('SELECT * FROM books WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC');
      return rows.map(rowToBook);
    },
    async restoreBook(id: string, at: number = Date.now()): Promise<void> {
      await db.run('UPDATE books SET deleted_at = NULL, updated_at = ? WHERE id = ?', [at, id]);
    },
    async purgeBook(id: string): Promise<void> {
      await db.run('DELETE FROM books WHERE id = ?', [id]);
    },
    async updateMetadata(id: string, patch: {
      title?: string; author?: string | null; language?: string | null; publisher?: string | null;
      series?: string | null; seriesIndex?: number | null; drmIdentifier?: string | null;
    }): Promise<void> {
      const COLS = {
        title: 'title', author: 'author', language: 'language', publisher: 'publisher',
        series: 'series', seriesIndex: 'series_index', drmIdentifier: 'drm_identifier',
      } as const;
      const sets = ['updated_at = ?'];
      const params: unknown[] = [Date.now()];
      for (const [k, col] of Object.entries(COLS)) {
        const v = (patch as Record<string, unknown>)[k];
        if (v !== undefined) { sets.push(`${col} = ?`); params.push(v); }
      }
      params.push(id);
      await db.run(`UPDATE books SET ${sets.join(', ')} WHERE id = ?`, params);
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
