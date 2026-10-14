import { createHash } from 'node:crypto';
import { partialMd5Hex, md5Hex } from '../partialMd5';

// mirrors util.partialMD5: 1024-byte samples at offsets 1024<<2i, i = -1..10
const OFFSETS = [256, 1024, 4096, 16384, 65536, 262144, 1048576, 4194304, 16777216, 67108864, 268435456, 1073741824];

const expectedDigest = (file: Uint8Array): string => {
  const md5 = createHash('md5');
  for (const offset of OFFSETS) {
    if (offset >= file.length) break;
    md5.update(file.subarray(offset, Math.min(offset + 1024, file.length)));
  }
  return md5.digest('hex');
};

const readerFor = (file: Uint8Array) => async (offset: number, length: number) => {
  if (offset >= file.length) return null;
  return file.subarray(offset, Math.min(offset + length, file.length));
};

// deterministic pseudo-random content, larger than the first four sample ranges
const bigFile = ((): Uint8Array => {
  const out = new Uint8Array(80 * 1024);
  let seed = 0x2545f491;
  for (let i = 0; i < out.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    out[i] = seed & 0xff;
  }
  return out;
})();

describe('partialMd5Hex (KOReader document digest)', () => {
  it('hashes exactly the sampled ranges: offsets 1024<<2i, 1024 bytes each', async () => {
    expect(await partialMd5Hex(readerFor(bigFile))).toBe(expectedDigest(bigFile));
  });

  it('accepts a short tail: a final partial sample is hashed whole', async () => {
    const file = bigFile.subarray(0, 1024 * 3 + 17);
    expect(await partialMd5Hex(readerFor(file))).toBe(expectedDigest(file));
  });

  it('hashes a small file that only reaches the first sample', async () => {
    const file = bigFile.subarray(0, 300);
    expect(await partialMd5Hex(readerFor(file))).toBe(expectedDigest(file));
  });

  it('returns the md5 of nothing when the read fails at the first offset', async () => {
    expect(await partialMd5Hex(async () => null)).toBe('d41d8cd98f00b204e9800998ecf8427e');
  });
});

describe('md5Hex (KOSync userkey)', () => {
  it('hashes utf-8 text like KOReader ffi/sha2 md5', () => {
    expect(md5Hex('secret')).toBe(createHash('md5').update('secret', 'utf8').digest('hex'));
    expect(md5Hex('mot_de_passe_éàü')).toBe(createHash('md5').update('mot_de_passe_éàü', 'utf8').digest('hex'));
  });
});
