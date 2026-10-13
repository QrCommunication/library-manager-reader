import { fractionForSection } from '../searchFraction';

// Pure math behind the engine's searchResult fraction (Task 11 brief): foliate
// exposes no per-CFI fraction, so each search hit reports an approximate
// section position ((index + 0.5) / sectionCount, clamped to [0,1], 0 when the
// section count is unknown) — sufficient for ordering a result list.
describe('fractionForSection', () => {
  it('returns the section midpoint for an interior index', () => {
    expect(fractionForSection(2, 10)).toBeCloseTo(0.25, 12);
    expect(fractionForSection(0, 4)).toBeCloseTo(0.125, 12);
  });

  it('stays strictly below 1 for the last section', () => {
    expect(fractionForSection(9, 10)).toBeCloseTo(0.95, 12);
  });

  it('returns 0 when the section count is unknown (empty book / not loaded)', () => {
    expect(fractionForSection(0, 0)).toBe(0);
    expect(fractionForSection(3, -1)).toBe(0);
  });

  it('clamps out-of-range indexes into [0,1]', () => {
    expect(fractionForSection(20, 10)).toBe(1);
    expect(fractionForSection(-4, 10)).toBe(0);
  });
});
