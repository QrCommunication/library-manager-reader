import type { FsAdapter } from '../storage/fsAdapter';

export interface BookTransport {
  read(book: { path: string; size: number }, send: (base64: string, seq: number) => Promise<void>, onProgress?: (p: number) => void): Promise<void>;
}

export function createBase64BookTransport(fs: FsAdapter, chunkSize = 512 * 1024): BookTransport {
  return {
    async read(book, send, onProgress) {
      let seq = 0;
      await fs.readBase64Chunks(book.path, chunkSize, async (base64) => {
        await send(base64, seq);
        seq += 1;
        onProgress?.(seq * chunkSize / book.size);
      });
    },
  };
}
