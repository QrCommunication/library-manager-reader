import { uuidV7 } from '../uuid';

const fixedRandom = (n: number): Uint8Array => new Uint8Array(n).fill(0xab);

describe('uuidV7', () => {
  it('produces a valid v7 uuid shape', () => {
    const id = uuidV7(fixedRandom);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('encodes the current timestamp in the first 48 bits', () => {
    const before = Date.now();
    const id = uuidV7(fixedRandom);
    const after = Date.now();
    const ts = parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('produces unique ids', () => {
    const set = new Set(Array.from({ length: 50 }, () => uuidV7(fixedRandom)));
    expect(set.size).toBe(50);
  });
});
