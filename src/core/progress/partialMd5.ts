import SparkMD5 from 'spark-md5';

// KOReader's util.partialMD5: md5 over 1024-byte samples taken at offsets
// 1024<<2i for i = -1..10 — head-weighted sampling that stays stable when
// KOReader appends data at the end of PDFs. The app and KOReader must agree
// on this exact digest: it is the document key on the KOSync server.
export const SAMPLE_OFFSETS: readonly number[] = [
  256, 1024, 4096, 16384, 65536, 262144,
  1048576, 4194304, 16777216, 67108864, 268435456, 1073741824,
];

export async function partialMd5Hex(
  readAt: (offset: number, length: number) => Promise<Uint8Array | null>,
): Promise<string> {
  const md5 = new SparkMD5.ArrayBuffer();
  for (const offset of SAMPLE_OFFSETS) {
    const sample = await readAt(offset, 1024);
    if (!sample || sample.length === 0) break;
    md5.append(sample.buffer.slice(sample.byteOffset, sample.byteOffset + sample.byteLength));
  }
  return md5.end();
}

const utf8Bytes = (text: string): Uint8Array => {
  const out = new Uint8Array(text.length * 4);
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    let cp = text.codePointAt(i)!;
    if (cp > 0xffff) i++;
    if (cp < 0x80) out[n++] = cp;
    else if (cp < 0x800) {
      out[n++] = 0xc0 | (cp >> 6); out[n++] = 0x80 | (cp & 0x3f);
    } else if (cp < 0x10000) {
      out[n++] = 0xe0 | (cp >> 12); out[n++] = 0x80 | ((cp >> 6) & 0x3f); out[n++] = 0x80 | (cp & 0x3f);
    } else {
      out[n++] = 0xf0 | (cp >> 18); out[n++] = 0x80 | ((cp >> 12) & 0x3f);
      out[n++] = 0x80 | ((cp >> 6) & 0x3f); out[n++] = 0x80 | (cp & 0x3f);
    }
  }
  return out.subarray(0, n);
};

// the KOSync protocol never sends the raw password — only this md5 (userkey)
export function md5Hex(text: string): string {
  const bytes = utf8Bytes(text);
  return SparkMD5.ArrayBuffer.hash(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
