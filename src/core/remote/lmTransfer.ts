// Moving files between the phone and a library-manager.com space (spec §6-§7):
// downloads go through signed URLs that never see the account bearer; uploads
// run the begin → signed PUT → complete → poll session.

import type { LmClient, LmUploadPlan, LmVersion } from './lmClient';

export function readyVersion(versions: readonly LmVersion[]): LmVersion | null {
  return versions.find((v) => v.status === 'ready') ?? null;
}

export type UploadOutcome = 'ready' | 'duplicate' | 'timeout' | 'failed';

export const DEFAULT_POLL_DELAYS = [500, 1000, 2000, 4000, 8000, 8000];

export interface UploadDeps {
  client: Pick<LmClient, 'beginImport' | 'completeImport' | 'getImport'>;
  spaceId: string;
  fetchImpl: typeof fetch;
  /** idempotency key: one per upload attempt, kept by the caller across a retry */
  newId: () => string;
  wait?: (ms: number) => Promise<void>;
  pollDelays?: number[];
}

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer as ArrayBuffer
    : bytes.slice().buffer as ArrayBuffer;

export async function uploadBookFile(
  deps: UploadDeps,
  file: { filename: string; format: string; sizeBytes: number; sha256: string },
  bytes: Uint8Array,
): Promise<UploadOutcome> {
  const idempotencyKey = deps.newId();
  const session: LmUploadPlan = await deps.client.beginImport(deps.spaceId, {
    filename: file.filename,
    format: file.format,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    idempotencyKey,
  });

  // only the signed headers go to the object storage — never the account bearer
  let uploaded = false;
  try {
    const res = await deps.fetchImpl(session.upload.url, {
      method: session.upload.method,
      headers: session.upload.headers,
      body: toArrayBuffer(bytes),
    });
    uploaded = res.ok;
  } catch {
    return 'failed';
  }
  if (!uploaded) return 'failed';

  const status = await deps.client.completeImport(deps.spaceId, session.session.id, {
    expectedRevision: session.session.revision,
    sha256: file.sha256,
  });
  if (status.status === 'ready' || status.status === 'duplicate') return status.status;
  return pollImport(deps, session.session.id);
}

export async function pollImport(deps: UploadDeps, importId: string): Promise<UploadOutcome> {
  const wait = deps.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const delays = deps.pollDelays ?? DEFAULT_POLL_DELAYS;
  for (const delay of delays) {
    await wait(delay);
    const status = await deps.client.getImport(deps.spaceId, importId);
    if (status.status === 'ready') return 'ready';
    if (status.status === 'duplicate') return 'duplicate';
  }
  return 'timeout';
}
