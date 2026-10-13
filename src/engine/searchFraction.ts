// Pure fraction math for search results (Task 11 brief): foliate exposes no
// per-CFI fraction, so each search hit reports an approximate section position
// ((index + 0.5) / sectionCount, clamped to [0,1]; 0 when the section count is
// unknown) — sufficient for positioning rows in the result list.
export const fractionForSection = (index: number, sectionCount: number): number =>
  sectionCount > 0 ? Math.min(1, Math.max(0, (index + 0.5) / sectionCount)) : 0;
