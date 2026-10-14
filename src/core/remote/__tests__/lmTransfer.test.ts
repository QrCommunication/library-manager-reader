import { readyVersion, uploadBookFile, pollImport, DEFAULT_POLL_DELAYS } from '../lmTransfer';
import type { LmClient, LmUploadPlan } from '../lmClient';

const plan = (over: Partial<LmUploadPlan> = {}): LmUploadPlan => ({
  session: { id: 'imp-1', revision: 1 },
  upload: { url: 'https://objects.example/signed-put', method: 'PUT', headers: { 'x-signed': '1' } },
  ...over,
});

const file = { filename: 'dune.epub', format: 'epub', sizeBytes: 3, sha256: 'a'.repeat(64) };
const bytes = new Uint8Array([1, 2, 3]);

const makeDeps = (opts: {
  plan?: LmUploadPlan;
  uploadStatus?: number;
  completeStatus?: string;
  pollStatuses?: string[];
  uploadThrows?: boolean;
} = {}) => {
  const calls: string[] = [];
  let pollIndex = 0;
  const deps = {
    calls,
    client: {
      beginImport: async (_spaceId: string, input: { filename: string; sha256?: string; idempotencyKey: string }) => {
        calls.push(`begin:${input.filename}:${input.sha256 ?? ''}:${input.idempotencyKey}`);
        return opts.plan ?? plan();
      },
      completeImport: async (_spaceId: string, importId: string, input: { expectedRevision: number; sha256: string }) => {
        calls.push(`complete:${importId}:${input.expectedRevision}`);
        return { id: importId, status: opts.completeStatus ?? 'processing' };
      },
      getImport: async (_spaceId: string, importId: string) => {
        const statuses = opts.pollStatuses ?? ['ready'];
        const status = statuses[Math.min(pollIndex++, statuses.length - 1)]!;
        calls.push(`poll:${importId}:${status}`);
        return { id: importId, status };
      },
    },
    spaceId: 's1',
    fetchImpl: async (url: RequestInfo | URL, init?: RequestInit) => {
      if (opts.uploadThrows) throw new TypeError('offline');
      calls.push(`upload:${String(url)}:${init?.method}:${JSON.stringify(init?.headers)}`);
      return new Response(null, { status: opts.uploadStatus ?? 200 });
    },
    newId: () => 'idem-1',
    wait: async (ms: number) => { calls.push(`wait:${ms}`); },
  };
  return deps;
};

describe('readyVersion', () => {
  it('picks the first ready version, null when none', () => {
    const versions = [
      { id: 'v1', format: 'epub', status: 'processing', sizeBytes: 1, sha256: 'a'.repeat(64) },
      { id: 'v2', format: 'mobi', status: 'ready', sizeBytes: 2, sha256: 'b'.repeat(64) },
    ];
    expect(readyVersion(versions)?.id).toBe('v2');
    expect(readyVersion([{ id: 'v3', format: 'epub', status: 'review', sizeBytes: 1, sha256: 'c'.repeat(64) }])).toBeNull();
  });
});

describe('uploadBookFile — begin, signed PUT, complete, poll', () => {
  it('runs the three steps and never sends a bearer to the object storage', async () => {
    const { calls, ...deps } = makeDeps({ pollStatuses: ['ready'] });
    const outcome = await uploadBookFile(deps, file, bytes);
    expect(outcome).toBe('ready');
    expect(calls[0]).toBe('begin:dune.epub:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:idem-1');
    expect(calls[1]).toBe('upload:https://objects.example/signed-put:PUT:{"x-signed":"1"}');
    expect(calls[2]).toBe('complete:imp-1:1');
    expect(calls[3]).toBe('wait:500');
    expect(calls[4]).toBe('poll:imp-1:ready');
    // only the signed header rides to object storage — never the account bearer
    expect(calls[1]).toContain('"x-signed":"1"');
    expect(calls[1]).not.toContain('Authorization');
    expect(calls[1]).not.toContain('Bearer');
  });

  it('stops early when complete already reports ready or duplicate', async () => {
    const { calls, ...deps } = makeDeps({ completeStatus: 'duplicate' });
    const outcome = await uploadBookFile(deps, file, bytes);
    expect(outcome).toBe('duplicate');
    expect(calls.some((c) => c.startsWith('wait:'))).toBe(false);
  });

  it('maps a failed signed PUT to failed without completing', async () => {
    const { calls, ...deps } = makeDeps({ uploadStatus: 403 });
    const outcome = await uploadBookFile(deps, file, bytes);
    expect(outcome).toBe('failed');
    expect(calls.some((c) => c.startsWith('complete:'))).toBe(false);
  });

  it('maps a network failure on the upload to failed', async () => {
    const { ...deps } = makeDeps({ uploadThrows: true });
    const outcome = await uploadBookFile(deps, file, bytes);
    expect(outcome).toBe('failed');
  });
});

describe('pollImport — growing bounded delays', () => {
  it('waits through the default ladder until ready', async () => {
    const { calls, ...deps } = makeDeps({ pollStatuses: ['processing', 'processing', 'ready'] });
    const outcome = await pollImport(deps, 'imp-9');
    expect(outcome).toBe('ready');
    expect(calls.filter((c) => c.startsWith('wait:'))).toEqual(DEFAULT_POLL_DELAYS.slice(0, 3).map((d) => `wait:${d}`));
  });

  it('returns duplicate as soon as the server deduplicates', async () => {
    const { ...deps } = makeDeps({ pollStatuses: ['duplicate'] });
    await expect(pollImport(deps, 'imp-9')).resolves.toBe('duplicate');
  });

  it('gives up as timeout after the bounded ladder', async () => {
    const { calls, ...deps } = makeDeps({ pollStatuses: ['processing'] });
    const outcome = await pollImport(deps, 'imp-9');
    expect(outcome).toBe('timeout');
    expect(calls.filter((c) => c.startsWith('wait:'))).toHaveLength(DEFAULT_POLL_DELAYS.length);
  });
});
