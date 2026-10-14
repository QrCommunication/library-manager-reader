import {
  matchRemoteBook, syncSpaceProgress, applyServerProgress, pushLocalChoice,
  fractionToPercent, percentToFraction, progressUpdatedAtMs,
  type LmConflict, type LmSyncDeps,
} from '../lmSync';
import { LmError } from '../lmClient';
import type { LmBook, LmBookDetails, LmProgress } from '../lmClient';
import type { ReadingProgress } from '../../../core/types';

const remote = (over: Partial<LmBook> = {}): LmBook => ({
  id: 'r1', title: 'Dune', author: 'F. Herbert', series: null, seriesIndex: null,
  updatedAt: 1, ...over,
});

const local = (over: {
  id?: string; title?: string; author?: string | null; progress?: ReadingProgress | null;
} = {}) => ({
  id: over.id ?? 'b1',
  title: over.title ?? 'Dune',
  author: over.author ?? 'F. Herbert',
  progress: over.progress !== undefined ? over.progress : null,
});

const progress = (over: Partial<ReadingProgress> = {}): ReadingProgress => ({
  bookId: 'b1', cfi: 'epubcfi(/6/2)', fraction: 0.25, sectionIndex: 1, updatedAt: 1700000000000, ...over,
});

const serverProgress = (over: Partial<LmProgress> = {}): LmProgress => ({
  bookId: 'r1', versionId: 'v1', cfi: 'epubcfi(/8/4)', chapterId: 'ch-2',
  percent: 50, revision: 3, updatedAt: 1700000000, ...over,
});

const makeDeps = (
  locals: ReturnType<typeof local>[],
  remotes: Record<string, LmBookDetails> = {},
  serverProgressByBook: Record<string, LmProgress | null> = {},
) => {
  const calls: string[] = [];
  let operationSeq = 0;
  const deps: LmSyncDeps = {
    client: {
      getBook: async (_spaceId: string, bookId: string) => {
        calls.push(`details:${bookId}`);
        return remotes[bookId] ?? { id: bookId, title: '', author: null, versions: [] };
      },
      getProgress: async (_spaceId: string, bookId: string, _versionId: string) => {
        calls.push(`get:${bookId}`);
        return serverProgressByBook[bookId] ?? null;
      },
      putProgress: async (_spaceId: string, bookId: string, op: { expectedRevision: number; versionId: string; percent: number; operationId: string; cfi: string | null }) => {
        calls.push(`put:${bookId}:${op.expectedRevision}:${op.percent}:${op.operationId}:${op.cfi ?? ''}`);
        return serverProgress(bookId === 'r1' ? {} : { bookId });
      },
    },
    locals,
    getProgress: async (bookId: string) => locals.find((l) => l.id === bookId)?.progress ?? null,
    saveProgress: async (p: ReadingProgress) => {
      calls.push(`save:${p.bookId}:${p.fraction}:${p.updatedAt}:${p.cfi ?? ''}`);
    },
    installationId: 'inst-1',
    newOperationId: () => `op-${++operationSeq}`,
  };
  return { calls, deps };
};

const withReadyVersion = (bookId: string, versionId = 'v1'): Record<string, LmBookDetails> => ({
  [bookId]: { id: bookId, title: '', author: null, versions: [{ id: versionId, format: 'epub', status: 'ready', sizeBytes: 1, sha256: 'a'.repeat(64) }] },
});

describe('helpers', () => {
  it('converts between the local fraction and the wire percent', () => {
    expect(fractionToPercent(0.125)).toBeCloseTo(12.5);
    expect(percentToFraction(12.5)).toBeCloseTo(0.125);
  });

  it('normalizes the server updatedAt whatever its unit', () => {
    expect(progressUpdatedAtMs(1700000000)).toBe(1700000000000);
    expect(progressUpdatedAtMs(1700000000123)).toBe(1700000000123);
  });
});

describe('matchRemoteBook', () => {
  it('matches on title and author, case-insensitively', () => {
    expect(matchRemoteBook({ title: 'dune', author: 'f. herbert' }, [remote()])).toMatchObject({ id: 'r1' });
    expect(matchRemoteBook({ title: 'DUNE', author: null }, [remote({ author: null })])).toMatchObject({ id: 'r1' });
  });

  it('refuses mismatched authors or titles', () => {
    expect(matchRemoteBook({ title: 'Dune', author: 'Someone else' }, [remote()])).toBeNull();
    expect(matchRemoteBook({ title: 'Dune II', author: 'F. Herbert' }, [remote()])).toBeNull();
  });

  it('never returns an already-used local twice', () => {
    const used = new Set(['b1']);
    expect(matchRemoteBook({ title: 'Dune', author: 'F. Herbert' }, [{ id: 'b1', title: 'Dune', author: 'F. Herbert' }], used)).toBeNull();
  });
});

describe('syncSpaceProgress', () => {
  it('pushes the local position as a revision-0 operation when the server has none', async () => {
    const { calls, deps } = makeDeps(
      [local({ progress: progress() })],
      withReadyVersion('r1'),
      { r1: null },
    );
    const summary = await syncSpaceProgress(deps, 's1', [remote()]);
    expect(summary).toMatchObject({ pulled: 0, pushed: 1, inSync: 0, none: 0, failed: 0 });
    expect(summary.conflicts).toHaveLength(0);
    expect(calls).toContain('details:r1');
    expect(calls).toContain('put:r1:0:25:op-1:epubcfi(/6/2)');
    expect(calls).toContain('get:r1');
  });

  it('pulls the server position onto the matched local book when it has none', async () => {
    const { calls, deps } = makeDeps([local()], withReadyVersion('r1'), { r1: serverProgress() });
    const summary = await syncSpaceProgress(deps, 's1', [remote()]);
    expect(summary).toMatchObject({ pulled: 1, pushed: 0 });
    // percent 50 → fraction 0.5; unix seconds on the wire → ms locally; cfi preserved
    expect(calls).toContain('save:b1:0.5:1700000000000:epubcfi(/8/4)');
  });

  it('counts a diverging position as an explicit conflict, touching nothing', async () => {
    const { calls, deps } = makeDeps(
      [local({ progress: progress({ fraction: 0.2, updatedAt: 1690000000000 }) })],
      withReadyVersion('r1'),
      { r1: serverProgress({ percent: 80 }) },
    );
    const summary = await syncSpaceProgress(deps, 's1', [remote()]);
    expect(summary.pulled).toBe(0);
    expect(summary.pushed).toBe(0);
    expect(summary.conflicts).toHaveLength(1);
    const conflict = summary.conflicts[0]!;
    expect(conflict).toMatchObject({ remoteId: 'r1', localId: 'b1', versionId: 'v1' });
    expect(conflict.server.percent).toBe(80);
    expect(conflict.local.fraction).toBe(0.2);
    expect(calls).toEqual(['details:r1', 'get:r1']);
  });

  it('skips matched books already at the same fraction', async () => {
    const { calls, deps } = makeDeps(
      [local({ progress: progress({ fraction: 0.50001 }) })],
      withReadyVersion('r1'),
      { r1: serverProgress({ percent: 50 }) },
    );
    const summary = await syncSpaceProgress(deps, 's1', [remote()]);
    expect(summary).toMatchObject({ inSync: 1, pulled: 0, pushed: 0 });
    expect(calls).toEqual(['details:r1', 'get:r1']);
  });

  it('ignores remote books without a local counterpart and books without any position', async () => {
    const { calls, deps } = makeDeps([local()], withReadyVersion('r1'), {});
    const summary = await syncSpaceProgress(deps, 's1', [remote({ id: 'r9', title: 'Elsewhere' }), remote()]);
    expect(summary).toMatchObject({ pulled: 0, pushed: 0, inSync: 0, none: 1, failed: 0 });
    expect(calls).toEqual(['details:r1', 'get:r1']);
  });

  it('skips remotes with no ready version as nothing-to-do', async () => {
    const { calls, deps } = makeDeps(
      [local({ progress: progress() })],
      { r1: { id: 'r1', title: '', author: null, versions: [{ id: 'v2', format: 'epub', status: 'processing', sizeBytes: 1, sha256: 'a'.repeat(64) }] } },
    );
    const summary = await syncSpaceProgress(deps, 's1', [remote()]);
    expect(summary).toMatchObject({ pulled: 0, pushed: 0, inSync: 0, none: 1, failed: 0 });
    expect(calls).toEqual(['details:r1']);
  });

  it('counts a failing exchange and keeps syncing the rest', async () => {
    const calls: string[] = [];
    let operationSeq = 0;
    const locals = [
      local({ id: 'b1', title: 'Broken' }),
      local({ id: 'b2', title: 'Good', progress: progress({ bookId: 'b2', fraction: 0.6, cfi: null }) }),
    ];
    const deps: LmSyncDeps = {
      client: {
        getBook: async (_s: string, bookId: string) => withReadyVersion(bookId)[bookId]!,
        getProgress: async (_s: string, bookId: string) => {
          if (bookId === 'r1') throw new Error('boom');
          calls.push(`get:${bookId}`);
          return null;
        },
        putProgress: async (_s: string, bookId: string, op: { expectedRevision: number; percent: number; operationId: string }) => {
          calls.push(`put:${bookId}:${op.expectedRevision}:${op.percent}:${op.operationId}`);
          return serverProgress({ bookId });
        },
      },
      locals,
      getProgress: async (bookId: string) => locals.find((l) => l.id === bookId)?.progress ?? null,
      saveProgress: async () => {},
      installationId: 'inst-1',
      newOperationId: () => `op-${++operationSeq}`,
    };
    const summary = await syncSpaceProgress(deps, 's1', [remote({ id: 'r1', title: 'Broken' }), remote({ id: 'r2', title: 'Good' })]);
    expect(summary).toMatchObject({ pulled: 0, pushed: 1, failed: 1 });
    expect(calls).toContain('put:r2:0:60:op-1');
  });
});

describe('conflict resolution', () => {
  const conflict = (over: Partial<LmConflict> = {}): LmConflict => ({
    remoteId: 'r1',
    remoteTitle: 'Dune',
    localId: 'b1',
    versionId: 'v1',
    server: serverProgress({ percent: 80, revision: 5 }),
    local: progress({ fraction: 0.2, updatedAt: 1690000000000 }),
    ...over,
  });

  it('applyServerProgress writes the server percent and anchor onto the local book', async () => {
    const { calls, deps } = makeDeps([local()]);
    await applyServerProgress(deps, 'b1', conflict().server);
    expect(calls).toContain('save:b1:0.8:1700000000000:epubcfi(/8/4)');
  });

  it('pushLocalChoice re-reads the server revision, then sends a fresh operation', async () => {
    const { calls, deps } = makeDeps([local()], withReadyVersion('r1'), { r1: serverProgress({ percent: 80, revision: 5 }) });
    await pushLocalChoice(deps, 's1', conflict());
    expect(calls).toContain('get:r1');
    expect(calls).toContain('put:r1:5:20:op-1:epubcfi(/6/2)');
  });

  it('pushLocalChoice uses revision 0 when the server progress vanished meanwhile', async () => {
    const { calls, deps } = makeDeps([local()], withReadyVersion('r1'), {});
    await pushLocalChoice(deps, 's1', conflict());
    expect(calls).toContain('put:r1:0:20:op-1:epubcfi(/6/2)');
  });

  it('pushLocalChoice lets a raced 409 propagate: the UI re-presents the choice', async () => {
    const { deps } = makeDeps([local()], withReadyVersion('r1'), { r1: serverProgress({ revision: 5 }) });
    deps.client.putProgress = async () => {
      throw new LmError('conflict', '409 revisionConflict', 'revisionConflict');
    };
    await expect(pushLocalChoice(deps, 's1', conflict())).rejects.toMatchObject({ kind: 'conflict' });
  });
});
