import { computePurgeCutoff, RETENTION_MS } from '../startup';

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
