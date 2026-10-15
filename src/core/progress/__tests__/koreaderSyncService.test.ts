import {
  syncBookProgress,
  applyServerProgress,
  pushLocalProgress,
  syncLibraryProgress,
  type BookSyncDeps,
} from '../koreaderSyncService';
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
    expect(await syncBookProgress(deps, { id: 'b1' }, '/books/b.epub')).toEqual({ kind: 'none' });
  });

  it('pushes the local position when the server has none', async () => {
    const { deps, calls } = makeDeps({ local: localProgress(0.25) });
    expect(await syncBookProgress(deps, { id: 'b1' }, '/books/b.epub')).toEqual({ kind: 'pushed', fraction: 0.25 });
    expect(calls.some((c) => c.startsWith('put:25.0:0.25'))).toBe(true);
  });

  it('pulls the server position when the book has none locally', async () => {
    const { deps, calls } = makeDeps({ server: serverProgress(0.5) });
    expect(await syncBookProgress(deps, { id: 'b1' }, '/books/b.epub')).toEqual({ kind: 'pulled', fraction: 0.5 });
    // cfi is dropped: a KOReader percentage cannot resolve to our cfis
    expect(calls).toContain('save:0.5:null:1700000000000');
  });

  it('reports in_sync when both sides agree', async () => {
    const { deps } = makeDeps({ server: serverProgress(0.4), local: localProgress(0.4) });
    expect(await syncBookProgress(deps, { id: 'b1' }, '/books/b.epub')).toEqual({ kind: 'in_sync' });
  });

  it('surfaces a conflict (with the digest) when the positions diverge', async () => {
    const { deps } = makeDeps({ server: serverProgress(0.8), local: localProgress(0.2) });
    const r = await syncBookProgress(deps, { id: 'b1' }, '/books/b.epub');
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

  it('pushLocalProgress sends the local XPointer as KOReader progress when known', async () => {
    const { deps, calls } = makeDeps({});
    const xp = '/body/DocFragment[3]/body/p[2]/text().17';
    await pushLocalProgress(deps, 'digest-1', { fraction: 0.35, xpointer: xp });
    expect(calls).toContain(`put:${xp}:0.35`);
  });

  it('applyServerProgress keeps a KOReader XPointer and ignores a non-XPointer progress', async () => {
    const { deps, getLocal } = makeDeps({});
    const xp = '/body/DocFragment[3]/body/p[2]/text().17';
    await applyServerProgress(deps, 'b1', { ...serverProgress(0.9), progress: xp });
    expect(getLocal()).toMatchObject({ fraction: 0.9, cfi: null, xpointer: xp });
    await applyServerProgress(deps, 'b1', { ...serverProgress(0.9), progress: '90.0' });
    expect(getLocal()).toMatchObject({ xpointer: null });
  });
});

describe('syncLibraryProgress', () => {
  interface BookCase { server?: KoSyncProgress | null; local?: ReadingProgress | null; fail?: boolean }

  const makeLibraryDeps = (cases: Record<string, BookCase>) => {
    const calls: string[] = [];
    const locals: Record<string, ReadingProgress | null> = {};
    for (const [id, c] of Object.entries(cases)) locals[id] = c.local ?? null;
    // books sync sequentially, so the book under the digest is the one whose
    // readAt just started
    let current = '';
    const deps: BookSyncDeps = {
      readAt: async (path: string, offset: number, length: number) => {
        const id = path.replace(/^\/books\//, '').replace(/\.epub$/, '');
        if (cases[id]?.fail) throw new Error('unreadable');
        current = id;
        return file.subarray(offset, Math.min(offset + length, file.length));
      },
      getProgress: async (bookId: string) => {
        calls.push(`localGet:${bookId}`);
        return locals[bookId] ?? null;
      },
      saveProgress: async (p: ReadingProgress) => {
        calls.push(`save:${p.bookId}:${p.fraction}:${p.updatedAt}`);
        locals[p.bookId] = p;
      },
      client: {
        register: async () => 'created',
        authorize: async () => true,
        getProgress: async (digest: string) => {
          calls.push(`get:${current}:${digest}`);
          return cases[current]?.server ?? null;
        },
        updateProgress: async (_d, progress, percentage) => {
          calls.push(`put:${current}:${progress}:${percentage}`);
          return true;
        },
      },
    };
    return { calls, deps, locals };
  };

  const book = (id: string) => ({ id, filePath: `/books/${id}.epub` });

  it('summarises pushed, pulled, in_sync and none across the library', async () => {
    const { deps, calls } = makeLibraryDeps({
      pushedBook: { local: localProgress(0.25) },
      pulledBook: { server: serverProgress(0.5) },
      sameBook: { server: serverProgress(0.4), local: localProgress(0.4) },
      emptyBook: {},
    });
    const summary = await syncLibraryProgress(deps, ['pushedBook', 'pulledBook', 'sameBook', 'emptyBook'].map(book));
    expect(summary).toEqual({ pushed: 1, pulled: 1, inSync: 1, none: 1, conflicts: 0, failed: 0 });
    expect(calls).toContain('put:pushedBook:25.0:0.25');
    expect(calls).toContain('save:pulledBook:0.5:1700000000000');
  });

  it('resolves a conflict newest-wins: a newer server position is pulled', async () => {
    const { deps, calls } = makeLibraryDeps({
      conflictBook: { server: serverProgress(0.8), local: { ...localProgress(0.2), updatedAt: 1690000000 } },
    });
    const summary = await syncLibraryProgress(deps, [book('conflictBook')]);
    expect(summary).toEqual({ pushed: 0, pulled: 1, inSync: 0, none: 0, conflicts: 1, failed: 0 });
    expect(calls).toContain('save:conflictBook:0.8:1700000000000');
  });

  it('resolves a conflict newest-wins: a newer local position is pushed', async () => {
    const { deps, calls } = makeLibraryDeps({
      conflictBook: { server: serverProgress(0.8), local: { ...localProgress(0.2), updatedAt: 1710000000000 } },
    });
    const summary = await syncLibraryProgress(deps, [book('conflictBook')]);
    expect(summary).toEqual({ pushed: 1, pulled: 0, inSync: 0, none: 0, conflicts: 1, failed: 0 });
    expect(calls).toContain('put:conflictBook:20.0:0.2');
  });

  it('prefers the local position on an exact timestamp tie', async () => {
    const { deps, calls } = makeLibraryDeps({
      tieBook: { server: serverProgress(0.8), local: { ...localProgress(0.2), updatedAt: 1700000000000 } },
    });
    const summary = await syncLibraryProgress(deps, [book('tieBook')]);
    expect(summary).toEqual({ pushed: 1, pulled: 0, inSync: 0, none: 0, conflicts: 1, failed: 0 });
    expect(calls).toContain('put:tieBook:20.0:0.2');
  });

  it('counts an unreadable file as failed and keeps syncing the rest', async () => {
    const { deps, calls } = makeLibraryDeps({
      brokenBook: { fail: true, local: localProgress(0.3) },
      goodBook: { local: localProgress(0.6) },
    });
    const summary = await syncLibraryProgress(deps, [book('brokenBook'), book('goodBook')]);
    expect(summary).toEqual({ pushed: 1, pulled: 0, inSync: 0, none: 0, conflicts: 0, failed: 1 });
    expect(calls).toContain('put:goodBook:60.0:0.6');
  });
});
