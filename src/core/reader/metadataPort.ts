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

// The headless WebView may never boot (or its render process may die), so both
// the boot handshake and the extraction reply are bounded: without this the
// pending promise never settles and the import FAB spins forever.
const READY_TIMEOUT_MS = 15_000;
const RESULT_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ExtractionError(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
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
  let booted = false;
  let resolveReady!: () => void;
  const readyPromise = new Promise<void>((resolve) => { resolveReady = resolve; });

  return {
    async extract({ path, format, size }) {
      // wait for the engine to announce itself before sending anything — a
      // request posted into a page that has not booted is simply lost
      await withTimeout(readyPromise, READY_TIMEOUT_MS, 'headless engine did not become ready');
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
      return withTimeout(promise, RESULT_TIMEOUT_MS, 'headless extraction timed out');
    },
    handleRaw(raw: string) {
      const msg = parseMessage(raw);
      if (msg.type === 'engineReady') {
        if (!booted) { booted = true; resolveReady(); }
        return;
      }
      if (msg.type === 'extractResult' && pending && msg.requestId === pending.requestId) {
        if (msg.ok) pending.resolve({ metadata: { title: msg.metadata.title, author: msg.metadata.author, language: msg.metadata.language, publisher: msg.metadata.publisher, identifier: msg.metadata.identifier, series: msg.metadata.series, seriesIndex: msg.metadata.seriesIndex }, coverJpegBase64: msg.metadata.coverJpegBase64, cbzBase64: msg.cbzBase64 });
        else pending.reject(new ExtractionError(msg.error));
        pending = null;
      }
    },
  };
}
