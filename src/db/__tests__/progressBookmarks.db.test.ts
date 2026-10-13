import { DatabaseSync } from 'node:sqlite';
import { createNodeSqliteDriver } from '../nodeSqliteDriver';
import { migrate } from '../migrate';
import { createBooksRepo } from '../booksRepo';
import { createProgressRepo } from '../progressRepo';
import { createBookmarksRepo } from '../bookmarksRepo';

const setup = async () => {
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  const books = createBooksRepo(db, () => 'fixed-book-id');
  await books.createBook({
    title: 'T', author: null, format: 'epub', originalFormat: null, fileName: 't.epub',
    fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null,
    addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null,
  });
  let n = 0;
  return { books, progress: createProgressRepo(db), bookmarks: createBookmarksRepo(db, () => `bm-${++n}`) };
};

describe('progressRepo', () => {
  it('upserts progress', async () => {
    const { progress } = await setup();
    expect(await progress.getProgress('fixed-book-id')).toBeNull();
    await progress.saveProgress({ bookId: 'fixed-book-id', cfi: 'c1', fraction: 0.25, sectionIndex: 1, updatedAt: 10 });
    await progress.saveProgress({ bookId: 'fixed-book-id', cfi: 'c2', fraction: 0.5, sectionIndex: 2, updatedAt: 20 });
    const p = await progress.getProgress('fixed-book-id');
    expect(p?.cfi).toBe('c2');
    expect(p?.fraction).toBe(0.5);
  });
});

describe('bookmarksRepo', () => {
  it('adds, lists and tombstones bookmarks', async () => {
    const { bookmarks } = await setup();
    const bm = await bookmarks.addBookmark({ bookId: 'fixed-book-id', cfi: 'x', fraction: 0.4, previewText: 'hello', createdAt: 5 });
    expect(await bookmarks.listByBook('fixed-book-id')).toHaveLength(1);
    await bookmarks.markDeleted(bm.id, 9);
    expect(await bookmarks.listByBook('fixed-book-id')).toHaveLength(0);
  });

  it('lists bookmarks in creation order', async () => {
    const { bookmarks } = await setup();
    await bookmarks.addBookmark({ bookId: 'fixed-book-id', cfi: 'a', fraction: 0.1, previewText: null, createdAt: 1 });
    await bookmarks.addBookmark({ bookId: 'fixed-book-id', cfi: 'b', fraction: 0.2, previewText: null, createdAt: 2 });
    const list = await bookmarks.listByBook('fixed-book-id');
    expect(list.map((b) => b.cfi)).toEqual(['a', 'b']);
  });
});
