import { createChunkAssembler } from '../chunkAssembler';

// tiny helper: Uint8Array → base64 (browser-style, available in jest jsdom env)
const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

describe('chunkAssembler', () => {
  it('reassembles ordered chunks and completes on total size', () => {
    const bytes = new Uint8Array(1000).map((_, i) => i % 251);
    const a = createChunkAssembler(1000);
    const r1 = a.push(0, toB64(bytes.slice(0, 600)));
    expect(r1.complete).toBe(false);
    const r2 = a.push(1, toB64(bytes.slice(600)));
    expect(r2.complete).toBe(true);
    expect(Buffer.from(r2.bytes!)).toEqual(Buffer.from(bytes));
  });

  it('rejects out-of-order chunks', () => {
    const a = createChunkAssembler(100);
    expect(() => a.push(1, toB64(new Uint8Array(50)))).toThrow(/seq/);
  });

  it('rejects overflow beyond declared size', () => {
    const a = createChunkAssembler(10);
    expect(() => a.push(0, toB64(new Uint8Array(11)))).toThrow(/size/);
  });
});
