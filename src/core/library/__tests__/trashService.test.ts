import { emptyTrash, purgeBookFiles, purgeExpiredTrash, TRASH_RETENTION_DAYS, type TrashDeps } from '../trashService';

const DAY = 24 * 60 * 60 * 1000;

const makeDeps = () => {
  const removed: string[] = [];
  const purged: string[] = [];
  const books = [
    { id: 'recent', title: 'Recent', format: 'epub', deletedAt: Date.now() - 2 * DAY },
    { id: 'expired', title: 'Expired', format: 'epub', deletedAt: Date.now() - 31 * DAY },
  ];
  const deps: TrashDeps = {
    fs: { remove: async (p: string) => { removed.push(p); } } as never,
    paths: {
      bookPath: (id: string, ext: string) => `/doc/books/${id}.${ext}`,
      coverPath: (id: string) => `/doc/covers/${id}.jpg`,
    } as never,
    books: {
      listDeleted: async () => books,
      purgeBook: async (id: string) => { purged.push(id); },
      purgeDeletedBefore: async () => 0,
    } as never,
  };
  return { deps, removed, purged, books };
};

describe('trashService', () => {
  it('exposes the 30-day retention', () => {
    expect(TRASH_RETENTION_DAYS).toBe(30);
  });

  it('purges one book: hard-deletes the row, removes stored file and cover', async () => {
    const { deps, removed, purged, books } = makeDeps();
    await purgeBookFiles(deps, { id: 'b1', format: 'epub' } as never);
    expect(purged).toEqual(['b1']);
    expect(removed).toEqual(['/doc/books/b1.epub', '/doc/covers/b1.jpg']);
    expect(books).toHaveLength(2);
  });

  it('emptyTrash purges every deleted book and reports the count', async () => {
    const { deps, removed, purged } = makeDeps();
    const n = await emptyTrash(deps);
    expect(n).toBe(2);
    expect(purged).toEqual(['recent', 'expired']);
    expect(removed).toHaveLength(4);
  });

  it('purgeExpiredTrash only removes tombstones past the retention window', async () => {
    const { deps, purged, removed } = makeDeps();
    const n = await purgeExpiredTrash(deps);
    expect(n).toBe(1);
    expect(purged).toEqual(['expired']);
    expect(removed).toEqual(['/doc/books/expired.epub', '/doc/covers/expired.jpg']);
  });
});
