import { createStoragePaths, extFromUri } from '../paths';

describe('paths', () => {
  const p = createStoragePaths('/doc', { ensureDir: async () => {} });
  it('builds book and cover paths', () => {
    expect(p.booksDir).toBe('/doc/books');
    expect(p.coversDir).toBe('/doc/covers');
    expect(p.bookPath('id1', 'epub')).toBe('/doc/books/id1.epub');
    expect(p.coverPath('id1')).toBe('/doc/covers/id1.jpg');
  });
});

describe('extFromUri', () => {
  it.each([
    ['file:///x/Book.epub', 'epub'],
    ['file:///x/Book.MOBI', 'mobi'],
    ['file:///x/Book.azw3', 'azw3'],
    ['file:///x/Book.cbz', 'cbz'],
    ['file:///x/Book.cbr', 'cbr'],
    ['file:///x/Book.pdf', null],
    ['file:///x/nocase.EPUB', 'epub'],
  ])('maps %s to %s', (uri, expected) => {
    expect(extFromUri(uri)).toBe(expected);
  });
});
