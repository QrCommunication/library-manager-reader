import { ensureCoverFile } from '../coverCache';
import type { LmClient } from '../../remote/lmClient';

const bytesOf = (n: number) => new Uint8Array([n, n, n]);

const makeDeps = (result: { kind: 'ok'; bytes: Uint8Array; etag: string } | { kind: 'unmodified' } | { kind: 'none' }) => {
  const files = new Map<string, string>();
  const calls: (string | null)[] = [];
  const deps = {
    client: {
      getCover: async (_s: string, _b: string, _v: string, etag: string | null) => {
        calls.push(etag);
        return result;
      },
    } as unknown as Pick<LmClient, 'getCover'>,
    fs: {
      exists: async (p: string) => files.has(p),
      readBytes: async (p: string) => new TextEncoder().encode(files.get(p)!) as unknown as Uint8Array,
      readText: async (p: string) => files.get(p)!,
      writeBytes: async (p: string, b: Uint8Array) => { files.set(p, new TextDecoder().decode(b)); },
      ensureDir: async () => {},
    },
    coverPaths: (versionId: string) => ({ bytes: `/covers/${versionId}.webp`, etag: `/covers/${versionId}.etag` }),
  };
  return { deps, files, calls };
};

describe('ensureCoverFile', () => {
  it('downloads, publishes bytes + etag atomically and returns the path', async () => {
    const { deps, files, calls } = makeDeps({ kind: 'ok', bytes: bytesOf(1), etag: '"sha256-a"' });
    await expect(ensureCoverFile(deps, 's1', 'b1', 'v1')).resolves.toBe('/covers/v1.webp');
    expect(calls).toEqual([null]);
    expect(files.get('/covers/v1.webp')).toBeDefined();
    expect(files.get('/covers/v1.etag')).toBe('"sha256-a"');
  });

  it('sends the stored etag and keeps local bytes on 304', async () => {
    const { deps, files, calls } = makeDeps({ kind: 'unmodified' });
    files.set('/covers/v1.webp', 'old');
    files.set('/covers/v1.etag', '"sha256-a"');
    await expect(ensureCoverFile(deps, 's1', 'b1', 'v1')).resolves.toBe('/covers/v1.webp');
    expect(calls).toEqual(['"sha256-a"']);
    expect(files.get('/covers/v1.webp')).toBe('old');
  });

  it('republishes when the server returns new bytes', async () => {
    const { deps, files } = makeDeps({ kind: 'ok', bytes: bytesOf(9), etag: '"sha256-b"' });
    files.set('/covers/v1.webp', 'old');
    files.set('/covers/v1.etag', '"sha256-a"');
    await ensureCoverFile(deps, 's1', 'b1', 'v1');
    expect(files.get('/covers/v1.etag')).toBe('"sha256-b"');
  });

  it('falls back to the local copy on 404, null when nothing is stored', async () => {
    const none = makeDeps({ kind: 'none' });
    await expect(ensureCoverFile(none.deps, 's1', 'b1', 'v1')).resolves.toBeNull();
    none.files.set('/covers/v1.webp', 'kept');
    none.files.set('/covers/v1.etag', '"sha256-a"');
    await expect(ensureCoverFile(none.deps, 's1', 'b1', 'v1')).resolves.toBe('/covers/v1.webp');
  });
});
