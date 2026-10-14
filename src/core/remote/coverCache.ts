// App-managed cover cache per the cover endpoint contract: one WebP file plus
// its exact ETag sidecar per version (profile cover_v1). Conditional GET with
// If-None-Match; 304 keeps the stored bytes, 404 (pending/noCover) keeps them
// too when present, and 200 re-publishes the verified pair atomically.

import type { LmClient } from './lmClient';

export interface CoverDeps {
  client: Pick<LmClient, 'getCover'>;
  fs: {
    exists(path: string): Promise<boolean>;
    readText(path: string): Promise<string>;
    writeBytes(path: string, bytes: Uint8Array): Promise<void>;
    ensureDir(path: string): Promise<void>;
  };
  coverPaths(versionId: string): { bytes: string; etag: string };
}

const inflight = new Map<string, Promise<string | null>>();

export async function ensureCoverFile(
  deps: CoverDeps,
  spaceId: string,
  bookId: string,
  versionId: string,
): Promise<string | null> {
  const paths = deps.coverPaths(versionId);
  const pending = inflight.get(paths.bytes);
  if (pending) return pending;
  const job = (async () => {
    let storedEtag: string | null = null;
    let haveBytes = false;
    try {
      if (await deps.fs.exists(paths.bytes)) {
        storedEtag = (await deps.fs.readText(paths.etag)).trim() || null;
        haveBytes = true;
      }
    } catch { /* unreadable entry: unconditional fetch */ }
    const result = await deps.client.getCover(spaceId, bookId, versionId, storedEtag);
    if (result.kind === 'unmodified' || result.kind === 'none') {
      return haveBytes ? paths.bytes : null;
    }
    await deps.fs.ensureDir(paths.bytes.split('/').slice(0, -1).join('/'));
    await deps.fs.writeBytes(paths.bytes, result.bytes);
    await deps.fs.writeBytes(paths.etag, new TextEncoder().encode(result.etag));
    return paths.bytes;
  })();
  inflight.set(paths.bytes, job);
  void job.finally(() => inflight.delete(paths.bytes));
  return job;
}
