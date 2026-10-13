import { getRandomValues } from 'expo-crypto';

// Monotonic guard (RFC 9562 §6.2): when two ids are generated within the same
// millisecond, the random bits alone cannot guarantee uniqueness (e.g. a fixed
// or weak random source), so a per-millisecond counter replaces rand_a's low
// byte. The first id of a millisecond keeps its full random bytes.
let lastTs = 0;
let seq = 0;

export function uuidV7(random: (n: number) => Uint8Array = (n) => getRandomValues(new Uint8Array(n))): string {
  const b = random(16);
  const ts = Date.now();
  if (ts === lastTs) {
    seq = (seq + 1) & 0xff;
  } else {
    lastTs = ts;
    seq = 0;
  }
  b[0] = (ts / 2 ** 40) & 0xff;
  b[1] = (ts / 2 ** 32) & 0xff;
  b[2] = (ts / 2 ** 24) & 0xff;
  b[3] = (ts / 2 ** 16) & 0xff;
  b[4] = (ts / 2 ** 8) & 0xff;
  b[5] = ts & 0xff;
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x70;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  if (seq !== 0) {
    b[7] = seq & 0xff;
  }
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
