import { computePurgeCutoff, RETENTION_MS, createAppServices } from '../startup';

jest.mock('../../db/expoDriver', () => ({ createExpoDriver: jest.fn() }));
jest.mock('../../db/migrate', () => ({ migrate: jest.fn(async () => {}) }));
jest.mock('../storage/expoFsAdapter', () => ({
  createExpoFsAdapter: () => ({ ensureDir: async () => {} }),
  documentRoot: () => '/docs',
}));
jest.mock('../services', () => ({
  createServices: () => ({
    paths: { ensureAll: async () => {} },
    books: { purgeDeletedBefore: async () => 0 },
  }),
}));

describe('computePurgeCutoff', () => {
  it('subtracts the 30-day retention from the given timestamp', () => {
    expect(computePurgeCutoff(1_000_000)).toBe(1_000_000 - 30 * 24 * 3600 * 1000);
    expect(RETENTION_MS).toBe(30 * 24 * 3600 * 1000);
  });

  it('never returns a cutoff in the future relative to now', () => {
    const now = Date.now();
    expect(computePurgeCutoff(now)).toBeLessThanOrEqual(now);
  });
});

describe('createAppServices', () => {
  it('retries startup after a transient failure instead of caching the rejection', async () => {
    const { createExpoDriver } = require('../../db/expoDriver');
    (createExpoDriver as jest.Mock).mockImplementationOnce(() => {
      throw new Error('db locked');
    });
    await expect(createAppServices()).rejects.toThrow('db locked');
    // next launch attempt must actually retry (fresh memo), not replay the rejection
    (createExpoDriver as jest.Mock).mockImplementation(() => ({}));
    await expect(createAppServices()).resolves.toBeDefined();
  });
});