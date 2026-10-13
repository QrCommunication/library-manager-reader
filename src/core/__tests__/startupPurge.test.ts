import { computePurgeCutoff, createAppServices, RETENTION_MS } from '../startup';

jest.mock('../../db/expoDriver', () => ({ createExpoDriver: jest.fn(() => ({})) }));
jest.mock('../../db/migrate', () => ({ migrate: jest.fn(async () => {}) }));
jest.mock('../storage/expoFsAdapter', () => ({
  createExpoFsAdapter: () => ({ ensureDir: async () => {} }),
  documentRoot: () => '/docs',
}));
jest.mock('../services', () => ({
  createServices: () => ({
    paths: { ensureAll: async () => {} },
    books: { purgeDeletedBefore: jest.fn(async () => 0) },
    annotations: { purgeDeletedBefore: jest.fn(async () => {}) },
  }),
}));

// dedicated file: createAppServices memoizes, so the first (and only) call in this
// file's fresh module registry observes a real startup
describe('startup purge', () => {
  it('purges tombstoned books then annotations with the 30-day cutoff, once at startup', async () => {
    const dateNow = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    try {
      const services = await createAppServices();
      const cutoff = computePurgeCutoff(1_000_000);
      expect(RETENTION_MS).toBe(30 * 24 * 3600 * 1000);
      expect(services.books.purgeDeletedBefore).toHaveBeenCalledTimes(1);
      expect(services.books.purgeDeletedBefore).toHaveBeenCalledWith(cutoff);
      expect(services.annotations.purgeDeletedBefore).toHaveBeenCalledTimes(1);
      expect(services.annotations.purgeDeletedBefore).toHaveBeenCalledWith(cutoff);
      // annotations purge runs after the books purge
      const booksOrder = (services.books.purgeDeletedBefore as jest.Mock).mock.invocationCallOrder[0] ?? 0;
      const annotationsOrder = (services.annotations.purgeDeletedBefore as jest.Mock).mock.invocationCallOrder[0] ?? 0;
      expect(annotationsOrder).toBeGreaterThan(booksOrder);
    } finally {
      dateNow.mockRestore();
    }
  });
});
