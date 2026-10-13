import type { EngineToApp } from '../bridge/protocol';
import { parseMessage } from '../bridge/codec';
import type { BookMetadata } from '../types';
import type { FsAdapter } from '../storage/fsAdapter';
import type { OriginalFormat } from '../types';

export class ExtractionError extends Error {}

export interface MetadataPort {
  extract(args: { path: string; format: OriginalFormat; size: number }): Promise<{
    metadata: BookMetadata; coverJpegBase64: string | null; cbzBase64: string | null;
  }>;
}

export function createHeadlessExtractor(
  send: (raw: string) => void,
  fs: Pick<FsAdapter, 'readBase64Chunks' | 'fileSize'>,
  chunkSize = 512 * 1024,
): MetadataPort & { handleRaw(raw: string): void } {
  let pending: {
    requestId: string;
    resolve: (v: { metadata: BookMetadata; coverJpegBase64: string | null; cbzBase64: string | null }) => void;
    reject: (e: Error) => void;
  } | null = null;

  return {
    async extract({ path, format, size }) {
      const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const promise = new Promise<{ metadata: BookMetadata; coverJpegBase64: string | null; cbzBase64: string | null }>((resolve, reject) => {
        pending = { requestId, resolve, reject };
      });
      send(JSON.stringify({ type: 'extract', requestId, format, size }));
      // seq is per-extraction (data seq must restart at 0 for the engine assembler)
      let seq = 0;
      await fs.readBase64Chunks(path, chunkSize, async (base64) => {
        send(JSON.stringify({ type: 'data', seq: seq++, base64 }));
      });
      send(JSON.stringify({ type: 'dataEnd' }));
      return promise;
    },
    handleRaw(raw: string) {
      const msg = parseMessage(raw);
      if (msg.type === 'extractResult' && pending && msg.requestId === pending.requestId) {
        if (msg.ok) pending.resolve({ metadata: { title: msg.metadata.title, author: msg.metadata.author, language: msg.metadata.language, publisher: msg.metadata.publisher, identifier: msg.metadata.identifier }, coverJpegBase64: msg.metadata.coverJpegBase64, cbzBase64: msg.cbzBase64 });
        else pending.reject(new ExtractionError(msg.error));
        pending = null;
      }
    },
  };
}
