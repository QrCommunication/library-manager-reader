import type { MetadataPort } from '../reader/metadataPort';
import type { StoragePaths } from '../storage/paths';
import type { Book } from '../types';

export interface RefreshDeps {
  fs: unknown;
  paths: StoragePaths;
  books: {
    listBooks(opts: { sort: 'added' }): Promise<Book[]>;
    updateMetadata(id: string, patch: Record<string, unknown>): Promise<void>;
  };
  extractor: MetadataPort;
}

export type RefreshOutcome = { bookId: string; title: string; updated: boolean; detail?: string };

// the stored file is the source of truth: every field it provides overwrites the
// row, fields it does not provide (null) are left untouched (a MOBI must not
// erase a series that came from elsewhere)
const patchFrom = (m: Awaited<ReturnType<MetadataPort['extract']>>['metadata']): Record<string, unknown> => ({
  ...(m.title != null ? { title: m.title } : {}),
  ...(m.author != null ? { author: m.author } : {}),
  ...(m.language != null ? { language: m.language } : {}),
  ...(m.publisher != null ? { publisher: m.publisher } : {}),
  ...(m.identifier != null ? { drmIdentifier: m.identifier } : {}),
  ...(m.series != null ? { series: m.series } : {}),
  ...(m.seriesIndex != null ? { seriesIndex: m.seriesIndex } : {}),
});

// cbr originals live on disk as converted cbz files
const storedFormat = (b: Pick<Book, 'format' | 'originalFormat'>): Book['format'] =>
  b.originalFormat === 'cbr' ? 'cbz' : b.format;

export async function refreshLibraryMetadata(
  deps: RefreshDeps,
  onProgress?: (p: { done: number; total: number }) => void,
  ids?: string[],
): Promise<RefreshOutcome[]> {
  const books = await deps.books.listBooks({ sort: 'added' });
  const selected = ids ? books.filter((b) => ids.includes(b.id)) : books;
  const out: RefreshOutcome[] = [];
  let done = 0;
  for (const b of selected) {
    try {
      const extracted = await deps.extractor.extract({
        path: deps.paths.bookPath(b.id, storedFormat(b)),
        format: storedFormat(b),
        size: b.fileSize,
      });
      await deps.books.updateMetadata(b.id, patchFrom(extracted.metadata));
      out.push({ bookId: b.id, title: b.title, updated: true });
    } catch (err) {
      out.push({ bookId: b.id, title: b.title, updated: false, detail: err instanceof Error ? err.message : String(err) });
    }
    done += 1;
    onProgress?.({ done, total: selected.length });
  }
  return out;
}

// Open Library search API: free, anonymous, CORS-friendly. Fills ONLY missing
// series — never touches other fields — on the user's explicit bulk action.
export async function enrichSeriesFromOpenLibrary(
  deps: RefreshDeps,
  fetchImpl: typeof fetch = globalThis.fetch,
  onProgress?: (p: { done: number; total: number }) => void,
): Promise<RefreshOutcome[]> {
  const books = (await deps.books.listBooks({ sort: 'added' })).filter((b) => b.series == null);
  const out: RefreshOutcome[] = [];
  let done = 0;
  for (const b of books) {
    try {
      const url = new URL('https://openlibrary.org/search.json');
      url.searchParams.set('title', b.title);
      if (b.author) url.searchParams.set('author', b.author);
      url.searchParams.set('fields', 'series');
      url.searchParams.set('limit', '1');
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`openlibrary ${res.status}`);
      const body = (await res.json()) as { docs?: { series?: unknown }[] };
      const series = body.docs?.[0]?.series;
      const name = Array.isArray(series) && typeof series[0] === 'string' ? series[0] : null;
      if (name) {
        await deps.books.updateMetadata(b.id, { series: name });
        out.push({ bookId: b.id, title: b.title, updated: true });
      } else {
        out.push({ bookId: b.id, title: b.title, updated: false });
      }
    } catch (err) {
      out.push({ bookId: b.id, title: b.title, updated: false, detail: err instanceof Error ? err.message : String(err) });
    }
    done += 1;
    onProgress?.({ done, total: books.length });
  }
  return out;
}
