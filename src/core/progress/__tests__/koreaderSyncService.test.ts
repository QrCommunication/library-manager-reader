import { syncBookProgress, applyServerProgress, pushLocalProgress } from '../koreaderSyncService';
import type { KoSyncClient, KoSyncProgress } from '../koreaderSync';
import type { ReadingProgress } from '../../../core/types';

// deterministic 80 KB pseudo-random file
const file = (() => {
  const out = new Uint8Array(80 * 1024);
  let seed = 0x2545f491;
  for (let i = 0; i < out.length; i++) {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    out[i] = seed & 0xff;
  }
  return out;
})();

const readAt = async (offset: number, length: number) => file.subarray(offset, Math.min(offset + length, file.length));

const makeDeps = (opts: {
  server?: KoSyncProgress | null;
  local?: ReadingProgress | null;
} = {}) => {
  const calls: string[] = [];
  let local = opts.local ?? null;
  const client: KoSyncClient = {
    register: async () => 'created',
    authorize: async () => true,
    getProgress: async () => {
      calls.push('get');
      return opts.server ?? null;
    },
    updateProgress: async (_d, progress, percentage) => {
      calls.push(`put:${progress}:${percentage}`);
      return true;
    },
  };
  return {
    calls,
    getLocal: () => local,
    deps: {
      readAt: (_path: string, offset: number, length: number) => readAt(offset, length),
      getProgress: async () => {
        calls.push('localGet');
        return local;
      },
      saveProgress: async (p: ReadingProgress) => {
        calls.push(`save:${p.fraction}:${p.cfi}:${p.updatedAt}`);
        local = p;
      },
      client,
    },
  };
};

const serverProgress = (percentage: number): KoSyncProgress =>
  ({ percentage, progress: `${(percentage * 100).toFixed(1)}`, device: 'Kobo', deviceId: 'k1', timestamp: 1700000000 });

const localProgress = (fraction: number): ReadingProgress =>
  ({ bookId: 'b1', cfi: 'cfi-1', fraction, sectionIndex: 2, updatedAt: 1690000000 });

describe('syncBookProgress', () => {
  it('reports none when neither side has progress', async () => {
    const { deps } = makeDeps();
    expect(await syncBookProgress(deps, { id: 'b1', fileName: 'b.epub' }, '/books/b.epub')).toEqual({ kind: 'none' });
  });

  it('pushes the local position when the server has none', async () => {
    const { deps, calls } = makeDeps({ local: localProgress(0.25) });
    expect(await syncBookProgress(deps, { id: 'b1', fileName: 'b.epub' }, '/books/b.epub')).toEqual({ kind: 'pushed', fraction: 0.25 });
    expect(calls.some((c) => c.startsWith('put:25.0:0.25'))).toBe(true);
  });

  it('pulls the server position when the book has none locally', async () => {
    const { deps, calls } = makeDeps({ server: serverProgress(0.5) });
    expect(await syncBookProgress(deps, { id: 'b1', fileName: 'b.epub' }, '/books/b.epub')).toEqual({ kind: 'pulled', fraction: 0.5 });
    // cfi is dropped: a KOReader percentage cannot resolve to our cfis
    expect(calls).toContain('save:0.5:null:1700000000000');
  });

  it('reports in_sync when both sides agree', async () => {
    const { deps } = makeDeps({ server: serverProgress(0.4), local: localProgress(0.4) });
    expect(await syncBookProgress(deps, { id: 'b1', fileName: 'b.epub' }, '/books/b.epub')).toEqual({ kind: 'in_sync' });
  });

  it('surfaces a conflict (with the digest) when the positions diverge', async () => {
    const { deps } = makeDeps({ server: serverProgress(0.8), local: localProgress(0.2) });
    const r = await syncBookProgress(deps, { id: 'b1', fileName: 'b.epub' }, '/books/b.epub');
    expect(r).toMatchObject({ kind: 'conflict', server: 0.8, local: 0.2 });
    expect((r as { digest: string }).digest).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe('conflict resolution helpers', () => {
  it('applyServerProgress saves the server fraction without a cfi', async () => {
    const { deps, calls } = makeDeps({});
    await applyServerProgress(deps, 'b1', serverProgress(0.9));
    expect(calls).toContain('save:0.9:null:1700000000000');
  });

  it('pushLocalProgress sends the stored local fraction', async () => {
    const { deps, calls } = makeDeps({});
    await expect(pushLocalProgress(deps, 'digest-1', localProgress(0.35))).resolves.toBe(true);
    expect(calls).toContain('put:35.0:0.35');
  });
});
