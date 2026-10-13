import { enrichSeriesFromOpenLibrary, refreshLibraryMetadata } from '../metadataRefresh';
import type { Book } from '../../types';

const makeBook = (over: Partial<Book> & Pick<Book, 'id' | 'title' | 'format'>): Book => ({
  author: null, originalFormat: null, fileName: `${over.id}.x`, fileSize: 4, language: null,
  publisher: null, series: null, seriesIndex: null, drmIdentifier: null,
  addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null, ...over,
});

const makeDeps = () => {
  const updates: [string, Record<string, unknown>][] = [];
  const extract = jest.fn(async () => ({
    metadata: {
      title: 'Fondation', author: 'I. Asimov', language: 'fr', publisher: 'Présence',
      identifier: 'urn:isbn:1', series: 'Fondation', seriesIndex: 1,
    },
    coverJpegBase64: null, cbzBase64: null,
  }));
  const books: Book[] = [
    makeBook({ id: 'b1', title: 'Old', format: 'epub' }),
    makeBook({ id: 'b2', title: 'Comics', format: 'cbz', originalFormat: 'cbr', fileSize: 9 }),
  ];
  const deps = {
    fs: {} as never,
    paths: {
      bookPath: (id: string, ext: string) => `/doc/books/${id}.${ext}`,
      coverPath: (id: string) => `/doc/covers/${id}.jpg`,
    } as never,
    books: {
      listBooks: async () => books,
      updateMetadata: async (id: string, patch: Record<string, unknown>) => { updates.push([id, patch]); },
    },
    extractor: { extract },
  };
  return { deps, updates, extract, books };
};

describe('refreshLibraryMetadata', () => {
  it('re-extracts each stored file and pushes the file-provided metadata onto the row', async () => {
    const { deps, updates, extract } = makeDeps();
    const out = await refreshLibraryMetadata(deps);
    expect(extract).toHaveBeenCalledTimes(2);
    expect(extract).toHaveBeenCalledWith({ path: '/doc/books/b1.epub', format: 'epub', size: 4 });
    // cbr originals read their stored cbz
    expect(extract).toHaveBeenCalledWith({ path: '/doc/books/b2.cbz', format: 'cbz', size: 9 });
    expect(updates[0]).toEqual(['b1', {
      title: 'Fondation', author: 'I. Asimov', language: 'fr', publisher: 'Présence',
      drmIdentifier: 'urn:isbn:1', series: 'Fondation', seriesIndex: 1,
    }]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ bookId: 'b1', updated: true });
  });

  it('continues past a failing book and carries the error in its outcome', async () => {
    const { deps, updates, extract } = makeDeps();
    extract.mockImplementationOnce(async () => { throw new Error('bad zip'); });
    const out = await refreshLibraryMetadata(deps);
    expect(out[0]).toMatchObject({ bookId: 'b1', updated: false, detail: 'bad zip' });
    expect(out[1]).toMatchObject({ bookId: 'b2', updated: true });
    expect(updates).toHaveLength(1);
  });

  it('reports done/total progress after each book', async () => {
    const { deps } = makeDeps();
    const onProgress = jest.fn();
    await refreshLibraryMetadata(deps, onProgress);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, { done: 1, total: 2 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { done: 2, total: 2 });
  });
});

describe('enrichSeriesFromOpenLibrary', () => {
  const jsonResponse = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });

  it('queries Open Library for series-less books and fills the first series', async () => {
    const { deps, updates } = makeDeps();
    const fetchMock = jest.fn(async (_input: Parameters<typeof fetch>[0]) => jsonResponse({ docs: [{ series: ['Fondation', 'Robot'] }] }));
    const out = await enrichSeriesFromOpenLibrary(deps, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain('https://openlibrary.org/search.json');
    expect(url).toContain('title=');
    expect(updates).toContainEqual(['b1', { series: 'Fondation' }]);
    expect(out[0]).toMatchObject({ bookId: 'b1', updated: true });
  });

  it('skips books that already have a series', async () => {
    const { deps, books } = makeDeps();
    books[0]!.series = 'Déjà là';
    const fetchMock = jest.fn(async (_input: Parameters<typeof fetch>[0]) => jsonResponse({ docs: [] }));
    await enrichSeriesFromOpenLibrary(deps, fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toContain('title=Comics');
  });

  it('leaves a book untouched when the search returns no series', async () => {
    const { deps, updates } = makeDeps();
    const fetchMock = jest.fn(async (_input: Parameters<typeof fetch>[0]) => jsonResponse({ docs: [{ title: 'Fondation' }] }));
    const out = await enrichSeriesFromOpenLibrary(deps, fetchMock);
    expect(updates).toHaveLength(0);
    expect(out[0]).toMatchObject({ bookId: 'b1', updated: false });
  });

  it('survives network errors book by book', async () => {
    const { deps, updates } = makeDeps();
    let n = 0;
    const fetchMock = jest.fn(async () => {
      n += 1;
      if (n === 1) throw new Error('offline');
      return jsonResponse({ docs: [{ series: ['Cycle'] }] });
    });
    const out = await enrichSeriesFromOpenLibrary(deps, fetchMock);
    expect(out[0]).toMatchObject({ bookId: 'b1', updated: false, detail: 'offline' });
    expect(updates).toContainEqual(['b2', { series: 'Cycle' }]);
  });
});
