import { runImport } from '../importService';
import { ExtractionError } from '../../reader/metadataPort';

const makeFs = () => {
  const files = new Map<string, string>();
  return {
    files,
    freeDiskBytes: async () => 1024 * 1024 * 1024,
    ensureDir: async () => {},
    copy: async (from: string, to: string) => { files.set(to, files.get(from) ?? 'data'); },
    exists: async (p: string) => files.has(p),
    remove: async (p: string) => { files.delete(p); },
    fileSize: async (p: string) => 1000,
    writeBase64: async (p: string, b64: string) => { files.set(p, b64); },
    readBase64Chunks: async () => {},
    directorySize: async () => 0,
  };
};

const baseDeps = (fs: ReturnType<typeof makeFs>, over: Record<string, unknown> = {}) => ({
  fs: fs as never,
  paths: {
    booksDir: '/doc/books', coversDir: '/doc/covers',
    bookPath: (id: string, ext: string) => `/doc/books/${id}.${ext}`,
    coverPath: (id: string) => `/doc/covers/${id}.jpg`,
    ensureAll: async () => {},
  },
  books: {
    createBook: async (b: { fileName: string }) => ({ id: `book-${b.fileName}` }),
  },
  extractor: {
    extract: async () => ({ metadata: { title: 'T', author: 'A', language: 'en', publisher: null, identifier: 'urn:isbn:1' }, coverJpegBase64: 'Y292ZXI=', cbzBase64: null }),
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
    const extractor = { extract: async () => ({ metadata: { title: 'C', author: null, language: null, publisher: null, identifier: null }, coverJpegBase64: null, cbzBase64: 'aGk=' }) };
    const createBook = jest.fn(async (b: { format: string; originalFormat: string | null }) => ({ id: 'cbr-book' }));
    const outcomes = await runImport(['file:///x/Comics.cbr'], baseDeps(fs, { extractor, books: { createBook } }));
    expect(outcomes[0]).toMatchObject({ ok: true, bookId: 'cbr-book' });
    expect(createBook.mock.calls[0]![0]).toMatchObject({ format: 'cbz', originalFormat: 'cbr', fileName: expect.stringMatching(/\.cbz$/) });
    expect(fs.files.get('/doc/covers/id-1.jpg') ?? fs.files.get('/doc/books/id-1.cbz')).toBeDefined();
  });

  it('maps extractor rejection to parse_failed and leaves no temp files', async () => {
    const fs = makeFs();
    const extractor = { extract: async () => { throw new ExtractionError('bad zip'); } };
    const outcomes = await runImport(['file:///x/Broken.epub'], baseDeps(fs, { extractor }));
    expect(outcomes[0]).toMatchObject({ ok: false, reason: 'parse_failed' });
    expect([...fs.files.keys()].filter((k) => k.includes('.importing'))).toHaveLength(0);
  });
});
