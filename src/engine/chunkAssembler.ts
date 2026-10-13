export interface AssemblerState {
  received: number;
  // Uint8Array<ArrayBuffer>: the assembled buffer is always freshly ArrayBuffer-backed
  // (required for BlobPart under TS 6 lib.dom strictness; subtype of the documented Uint8Array)
  push(seq: number, base64: string): { complete: boolean; bytes: Uint8Array<ArrayBuffer> | null };
}

export function createChunkAssembler(totalSize: number): AssemblerState {
  const parts = new Map<number, Uint8Array>();
  let received = 0;
  return {
    get received() { return received; },
    push(seq, base64) {
      // duplicates must throw exactly like out-of-order: silently overwriting the
      // stored part and double-counting `received` would corrupt the assembled book
      if (parts.has(seq)) throw new Error(`duplicate chunk: seq ${seq}`);
      if (seq !== parts.size) throw new Error(`out-of-order chunk: expected seq ${parts.size}, got ${seq}`);
      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (received + bytes.length > totalSize) throw new Error(`chunk exceeds declared size ${totalSize}`);
      parts.set(seq, bytes);
      received += bytes.length;
      if (received === totalSize) {
        const all = new Uint8Array(totalSize);
        let off = 0;
        for (let s = 0; s < parts.size; s++) { const p = parts.get(s)!; all.set(p, off); off += p.length; }
        return { complete: true, bytes: all };
      }
      return { complete: false, bytes: null };
    },
  };
}
