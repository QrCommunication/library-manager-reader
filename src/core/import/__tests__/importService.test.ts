import { runImport } from '../importService';
import { ExtractionError } from '../../reader/metadataPort';

const makeFs = () => {
  const files = new Map<string, string>();
  // tracks the real byte size of each written/copied file; unknown paths fall
  // back to the picked-file size sentinel (1000) so tests can tell them apart
  const sizes = new Map<string, number>();
  return {
    files,
    freeDiskBytes: async () => 1024 * 1024 * 1024,
    ensureDir: async () => {},
    copy: async (from: string, to: string) => {
      files.set(to, files.get(from) ?? 'data');
      sizes.set(to, sizes.get(from) ?? 4);
    },
    exists: async (p: string) => files.has(p),
    remove: async (p: string) => { files.delete(p); },
    fileSize: async (p: string) => sizes.get(p) ?? 1000,
    writeBase64: async (p: string, b64: string) => {
      files.set(p, b64);
      sizes.set(p, Buffer.from(b64, 'base64').length);
    },
    readBase64Chunks: async () => {},
    directorySize: async () => 0,
  };
};

const baseDeps = (fs: ReturnType<typeof makeFs>, over: Record<string, unknown> = {}) => ({
  fs: fs as never,
  paths: {
    root: '/doc',
    booksDir: '/doc/books', coversDir: '/doc/covers',
    bookPath: (id: string, ext: string) => `/doc/books/${id}.${ext}`,
    coverPath: (id: string) => `/doc/covers/${id}.jpg`,
    ensureAll: async () => {},
  },
  books: {
    createBook: async (b: { fileName: string }) => ({ id: `book-${b.fileName}` }),
    findDuplicate: async () => null,
  },
  extractor: {
    extract: async () => ({ metadata: { title: 'T', author: 'A', language: 'en', publisher: null, identifier: 'urn:isbn:1', series: null, seriesIndex: null }, coverJpegBase64: 'Y292ZXI=', cbzBase64: null }),
  },
  newId: (() => { let n = 0; return () => `id-${++n}`; })(),
  ...over,
});

describe('runImport', () => {
  it('imports an epub end to end', async () => {
    const fs = makeFs();
    const outcomes = await runImport(['file:///x/Book.epub'], baseDeps(fs));
    expect(outcomes[0]).toMatchObject({ ok: true });
  });

  it('records the series metadata into the book row', async () => {
    const fs = makeFs();
    const createBook = jest.fn(async (b: { fileName: string }) => ({ id: `book-${b.fileName}` }));
    const extractor = {
      extract: async () => ({
        metadata: { title: 'T', author: 'A', language: 'en', publisher: null, identifier: null, series: 'Fondation', seriesIndex: 3 },
        coverJpegBase64: null, cbzBase64: null,
      }),
    };
    await runImport(['file:///x/Book.epub'], baseDeps(fs, { extractor, books: { createBook, findDuplicate: async () => null } }));
    expect(createBook.mock.calls[0]![0]).toMatchObject({ series: 'Fondation', seriesIndex: 3 });
  });

  it('rejects unsupported extensions without calling the extractor', async () => {
    const fs = makeFs();
    const extractor = { extract: jest.fn() };
    const outcomes = await runImport(['file:///x/Book.pdf'], baseDeps(fs, { extractor }));
    expect(outcomes[0]).toMatchObject({ ok: false, reason: 'unsupported' });
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  it('rejects when free space is insufficient', async () => {
    const fs = makeFs();
    fs.freeDiskBytes = async () => 1000;
    const outcomes = await runImport(['file:///x/Book.epub'], baseDeps(fs));
    expect(outcomes[0]).toMatchObject({ ok: false, reason: 'no_space' });
  });

  it('imports cbr by writing the converted cbz and recording originalFormat', async () => {
    const fs = makeFs();
    const extractor = { extract: async () => ({ metadata: { title: 'C', author: null, language: null, publisher: null, identifier: null, series: null, seriesIndex: null }, coverJpegBase64: null, cbzBase64: 'aGk=' }) };
    const createBook = jest.fn(async (b: { format: string; originalFormat: string | null }) => ({ id: 'cbr-book' }));
    const outcomes = await runImport(['file:///x/Comics.cbr'], baseDeps(fs, { extractor, books: { createBook, findDuplicate: async () => null } }));
    expect(outcomes[0]).toMatchObject({ ok: true, bookId: 'cbr-book' });
    expect(createBook.mock.calls[0]![0]).toMatchObject({ format: 'cbz', originalFormat: 'cbr', fileName: expect.stringMatching(/\.cbz$/) });
    expect(fs.files.get('/doc/covers/id-1.jpg') ?? fs.files.get('/doc/books/id-1.cbz')).toBeDefined();
  });

  it('maps extractor rejection to parse_failed and leaves no temp files', async () => {
    const fs = makeFs();
    const extractor = { extract: async () => { throw new ExtractionError('bad zip'); } };
    const outcomes = await runImport(['file:///x/Broken.epub'], baseDeps(fs, { extractor }));
    expect(outcomes[0]).toMatchObject({ ok: false, reason: 'parse_failed' });
    const first = outcomes[0]!;
    if (!first.ok) expect(first.detail).toBe('bad zip');
    expect([...fs.files.keys()].filter((k) => k.includes('.importing'))).toHaveLength(0);
  });

  it('captures the underlying error message on io_error instead of swallowing it', async () => {
    const fs = makeFs();
    fs.fileSize = async () => { throw new Error('EACCES: permission denied'); };
    const outcomes = await runImport(['file:///x/Book.epub'], baseDeps(fs));
    expect(outcomes[0]).toMatchObject({ ok: false, reason: 'io_error', detail: 'EACCES: permission denied' });
  });

  it('rejects a picked file reporting size <= 0 with the value in detail', async () => {
    const fs = makeFs();
    fs.fileSize = async () => -1; // expo-file-system File.size can report -1 when unknown
    const extractor = { extract: jest.fn() };
    const outcomes = await runImport(['file:///x/Book.epub'], baseDeps(fs, { extractor }));
    expect(outcomes[0]).toMatchObject({ ok: false, reason: 'io_error' });
    const first = outcomes[0]!;
    if (!first.ok) expect(first.detail).toContain('-1');
    expect(extractor.extract).not.toHaveBeenCalled();
  });

  it('records the STORED cbz size for a converted cbr, not the picked size', async () => {
    const fs = makeFs();
    // picked file size is the makeFs sentinel (1000); the converted cbz is 5 bytes
    const extractor = { extract: async () => ({ metadata: { title: 'C', author: null, language: null, publisher: null, identifier: null, series: null, seriesIndex: null }, coverJpegBase64: null, cbzBase64: 'aGVsbG8=' }) };
    const createBook = jest.fn(async (b: { fileSize: number }) => ({ id: 'cbr-book' }));
    const outcomes = await runImport(['file:///x/Comics.cbr'], baseDeps(fs, { extractor, books: { createBook, findDuplicate: async () => null } }));
    expect(outcomes[0]).toMatchObject({ ok: true });
    expect(createBook.mock.calls[0]![0].fileSize).toBe(5);
    expect(createBook.mock.calls[0]![0].fileSize).not.toBe(1000);
  });

  it('recomputes fileSize from the stored copy for non-converted imports too', async () => {
    const fs = makeFs();
    const createBook = jest.fn(async (b: { fileSize: number }) => ({ id: 'epub-book' }));
    const outcomes = await runImport(['file:///x/Book.epub'], baseDeps(fs, { books: { createBook, findDuplicate: async () => null } }));
    expect(outcomes[0]).toMatchObject({ ok: true });
    // stored copy size ('data' → 4), not the picked-file sentinel (1000)
    expect(createBook.mock.calls[0]![0].fileSize).toBe(4);
  });
});

describe('runImport progress', () => {
  it('reports done/total after each file', async () => {
    const fs = makeFs();
    const onProgress = jest.fn();
    await runImport(
      ['file:///x/A.epub', 'file:///x/B.epub', 'file:///x/C.epub'],
      baseDeps(fs, { onProgress }),
    );
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, { done: 1, total: 3, uri: 'file:///x/A.epub' });
    expect(onProgress).toHaveBeenNthCalledWith(2, { done: 2, total: 3, uri: 'file:///x/B.epub' });
    expect(onProgress).toHaveBeenNthCalledWith(3, { done: 3, total: 3, uri: 'file:///x/C.epub' });
  });

  it('reports progress for failed files too', async () => {
    const fs = makeFs();
    const onProgress = jest.fn();
    await runImport(
      ['file:///x/NotSupported.pdf', 'file:///x/B.epub'],
      baseDeps(fs, { onProgress }),
    );
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, { done: 1, total: 2, uri: 'file:///x/NotSupported.pdf' });
  });
});

describe('runImport duplicate detection', () => {
  it('skips a book already in the library and creates no row or stored copy', async () => {
    const fs = makeFs();
    const createBook = jest.fn(async (b: { fileName: string }) => ({ id: `book-${b.fileName}` }));
    const findDuplicate = jest.fn(async () => ({ id: 'existing', title: 'Dune' }));
    const outcomes = await runImport(
      ['file:///x/Book.epub'],
      baseDeps(fs, { books: { createBook, findDuplicate } }),
    );
    expect(outcomes[0]).toMatchObject({ ok: false, reason: 'duplicate', detail: 'Dune' });
    expect(createBook).not.toHaveBeenCalled();
    expect(fs.files.has('/doc/books/id-1.epub')).toBe(false);
    expect(fs.files.has('/doc/covers/id-1.jpg')).toBe(false);
    expect([...fs.files.keys()].filter((k) => k.includes('.importing'))).toHaveLength(0);
  });

  it('passes the extracted identity (identifier, title, author) to the repo lookup', async () => {
    const fs = makeFs();
    const findDuplicate = jest.fn(async () => null);
    await runImport(
      ['file:///x/Book.epub'],
      baseDeps(fs, { books: { createBook: async (b: { fileName: string }) => ({ id: `book-${b.fileName}` }), findDuplicate } }),
    );
    expect(findDuplicate).toHaveBeenCalledWith({ identifier: 'urn:isbn:1', title: 'T', author: 'A' });
  });

  it('imports a same-title book when the repo reports no duplicate', async () => {
    const fs = makeFs();
    const findDuplicate = jest.fn(async () => null);
    const outcomes = await runImport(
      ['file:///x/Book.epub'],
      baseDeps(fs, { books: { createBook: async (b: { fileName: string }) => ({ id: `book-${b.fileName}` }), findDuplicate } }),
    );
    expect(outcomes[0]).toMatchObject({ ok: true });
  });
});
