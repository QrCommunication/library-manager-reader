import { matchRemoteBook, syncSpaceProgress } from '../lmSync';
import type { LmBook } from '../lmClient';
import type { ReadingProgress } from '../../../core/types';

const remote = (over: Partial<LmBook> = {}): LmBook => ({
  id: 'r1', title: 'Dune', author: 'F. Herbert', series: null, seriesIndex: null,
  format: 'epub', fileSize: 1, updatedAt: 1, ...over,
});

const local = (over: {
  id?: string; title?: string; author?: string | null; progress?: ReadingProgress | null;
} = {}) => ({
  id: over.id ?? 'b1',
  title: over.title ?? 'Dune',
  author: over.author ?? 'F. Herbert',
  progress: over.progress !== undefined ? over.progress : null,
});

const makeDeps = (
  locals: ReturnType<typeof local>[],
  remoteProgress: Record<string, { fraction: number; updatedAt: number } | null> = {},
) => {
  const calls: string[] = [];
  const deps = {
    client: {
      getProgress: async (_spaceId: string, bookId: string) => {
        calls.push(`get:${bookId}`);
        return remoteProgress[bookId] ?? null;
      },
      putProgress: async (_spaceId: string, bookId: string, p: { fraction: number; updatedAt: number }) => {
        calls.push(`put:${bookId}:${p.fraction}:${p.updatedAt}`);
      },
    },
    locals,
    getProgress: async (bookId: string) => locals.find((l) => l.id === bookId)?.progress ?? null,
    saveProgress: async (p: ReadingProgress) => { calls.push(`save:${p.bookId}:${p.fraction}:${p.updatedAt}`); },
  };
  return { calls, deps };
};

describe('matchRemoteBook', () => {
  it('matches on title and author, case-insensitively', () => {
    expect(matchRemoteBook({ title: 'dune', author: 'f. herbert' }, [remote()])).toMatchObject({ id: 'r1' });
    expect(matchRemoteBook({ title: 'DUNE', author: null }, [remote({ author: null })])).toMatchObject({ id: 'r1' });
  });

  it('refuses mismatched authors or titles', () => {
    expect(matchRemoteBook({ title: 'Dune', author: 'Someone else' }, [remote()])).toBeNull();
    expect(matchRemoteBook({ title: 'Dune II', author: 'F. Herbert' }, [remote()])).toBeNull();
  });

  it('never returns an already-used remote twice', () => {
    const used = new Set(['r1']);
    expect(matchRemoteBook({ title: 'Dune', author: 'F. Herbert' }, [remote()], used)).toBeNull();
  });
});

describe('syncSpaceProgress', () => {
  it('pushes the local position when the server has none', async () => {
    const { calls, deps } = makeDeps([local({ progress: { bookId: 'b1', cfi: 'c', fraction: 0.25, sectionIndex: 1, updatedAt: 1700000000000 } })], { r1: null });
    const summary = await syncSpaceProgress(deps, 's1', [remote()]);
    expect(summary).toEqual({ pulled: 0, pushed: 1, inSync: 0, none: 0, failed: 0 });
    // timestamps ride the wire in unix seconds
    expect(calls).toContain('put:r1:0.25:1700000000');
  });

  it('pulls the server position onto the matched local book when it has none', async () => {
    const { calls, deps } = makeDeps([local()], { r1: { fraction: 0.5, updatedAt: 1700000000 } });
    const summary = await syncSpaceProgress(deps, 's1', [remote()]);
    expect(summary).toEqual({ pulled: 1, pushed: 0, inSync: 0, none: 0, failed: 0 });
    expect(calls).toContain('save:b1:0.5:1700000000000');
  });

  it('resolves a diverging position newest-wins in both directions', async () => {
    const { calls, deps } = makeDeps(
      [
        local({ id: 'b1', title: 'Old local', progress: { bookId: 'b1', cfi: null, fraction: 0.2, sectionIndex: null, updatedAt: 1690000000000 } }),
        local({ id: 'b2', title: 'Fresh local', progress: { bookId: 'b2', cfi: null, fraction: 0.9, sectionIndex: null, updatedAt: 1710000000000 } }),
      ],
      {
        r1: { fraction: 0.8, updatedAt: 1700000000 },
        r2: { fraction: 0.1, updatedAt: 1700000000 },
      },
    );
    const summary = await syncSpaceProgress(deps, 's1', [remote({ id: 'r1', title: 'Old local' }), remote({ id: 'r2', title: 'Fresh local' })]);
    expect(summary).toEqual({ pulled: 1, pushed: 1, inSync: 0, none: 0, failed: 0 });
    expect(calls).toContain('save:b1:0.8:1700000000000');
    expect(calls).toContain('put:r2:0.9:1710000000');
  });

  it('skips matched books already at the same fraction', async () => {
    const { calls, deps } = makeDeps(
      [local({ progress: { bookId: 'b1', cfi: 'c', fraction: 0.40001, sectionIndex: 1, updatedAt: 1600000000000 } })],
      { r1: { fraction: 0.4, updatedAt: 1700000000 } },
    );
    const summary = await syncSpaceProgress(deps, 's1', [remote()]);
    expect(summary).toEqual({ pulled: 0, pushed: 0, inSync: 1, none: 0, failed: 0 });
    expect(calls).toEqual(['get:r1']);
  });

  it('ignores remote books without a local counterpart and books without any position', async () => {
    const { calls, deps } = makeDeps([local()], {});
    const summary = await syncSpaceProgress(deps, 's1', [remote({ id: 'r9', title: 'Elsewhere' }), remote()]);
    expect(summary).toEqual({ pulled: 0, pushed: 0, inSync: 0, none: 1, failed: 0 });
    expect(calls).toEqual(['get:r1']);
  });

  it('matches duplicate-title remotes one-to-one, never the same local twice', async () => {
    const { calls, deps } = makeDeps(
      [
        local({ id: 'b1', progress: { bookId: 'b1', cfi: null, fraction: 0.1, sectionIndex: null, updatedAt: 1700000000000 } }),
        local({ id: 'b2', progress: { bookId: 'b2', cfi: null, fraction: 0.2, sectionIndex: null, updatedAt: 1700000000000 } }),
      ],
      { r1: { fraction: 0.05, updatedAt: 1600000000 }, r2: { fraction: 0.15, updatedAt: 1600000000 } },
    );
    const summary = await syncSpaceProgress(deps, 's1', [remote({ id: 'r1' }), remote({ id: 'r2' })]);
    expect(summary).toEqual({ pulled: 0, pushed: 2, inSync: 0, none: 0, failed: 0 });
    expect(calls).toEqual(expect.arrayContaining(['put:r1:0.1:1700000000', 'put:r2:0.2:1700000000']));
  });

  it('counts a failing exchange and keeps syncing the rest', async () => {
    const calls: string[] = [];
    const locals = [
      local({ id: 'b1', title: 'Broken' }),
      local({ id: 'b2', title: 'Good', progress: { bookId: 'b2', cfi: null, fraction: 0.6, sectionIndex: null, updatedAt: 1700000000000 } }),
    ];
    const deps = {
      client: {
        getProgress: async (_s: string, bookId: string) => {
          if (bookId === 'r1') throw new Error('boom');
          calls.push(`get:${bookId}`);
          return null;
        },
        putProgress: async (_s: string, bookId: string, p: { fraction: number; updatedAt: number }) => {
          calls.push(`put:${bookId}:${p.fraction}:${p.updatedAt}`);
        },
      },
      locals,
      getProgress: async (bookId: string) => locals.find((l) => l.id === bookId)?.progress ?? null,
      saveProgress: async () => {},
    };
    const summary = await syncSpaceProgress(deps, 's1', [remote({ id: 'r1', title: 'Broken' }), remote({ id: 'r2', title: 'Good' })]);
    expect(summary).toEqual({ pulled: 0, pushed: 1, inSync: 0, none: 0, failed: 1 });
    expect(calls).toContain('put:r2:0.6:1700000000');
  });
});
