import { matchRemoteBook, progressUpdatedAtMs, syncSpaceProgress, type LmSyncDeps } from '../lmSync';
import type { LmBook, LmBookDetails } from '../lmClient';
import { fakeLmServer, makeSyncDb } from './fakeLmServer';

const XP = '/body/DocFragment[2]/body/p[3]/text().12';

const remote = (over: Partial<LmBook> = {}): LmBook => ({
  id: 'r1', title: 'Dune', author: 'F. Herbert', series: null, seriesIndex: null,
  updatedAt: 1, ...over,
});

const ready = (versionId = 'v1'): LmBookDetails['versions'] => [{ id: versionId, format: 'epub', status: 'ready', sizeBytes: 1, sha256: 'a'.repeat(64) }];

describe('helpers', () => {
  it('normalizes the server updatedAt whatever its unit', () => {
    expect(progressUpdatedAtMs(1700000000)).toBe(1700000000000);
    expect(progressUpdatedAtMs(1700000000123)).toBe(1700000000123);
    expect(progressUpdatedAtMs('2023-11-14T22:13:20Z')).toBe(1700000000000);
    expect(progressUpdatedAtMs('garbage')).toBe(0);
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

describe('syncSpaceProgress — link, then the shared revision-based reconciliation', () => {
  const setup = async (versions: Record<string, LmBookDetails['versions']> = { r1: ready() }) => {
    const env = await makeSyncDb(['b1', 'b2']);
    const server = fakeLmServer();
    let seq = 0;
    let now = 10_000;
    const deps: LmSyncDeps = {
      client: {
        ...server.client,
        getBook: async (_s: string, id: string) => ({ id, title: '', author: null, versions: versions[id] ?? [] }),
      },
      locals: [{ id: 'b1', title: 'Dune', author: 'F. Herbert' }, { id: 'b2', title: 'Fondation', author: null }],
      repo: env.repo,
      progress: env.progress,
      installationId: 'inst',
      newOperationId: () => `op-${++seq}`,
      now: () => now,
      // server book ids double as fake-server keys
      linkBook: (localId, remoteId, versionId) => env.repo.linkBook({ bookId: localId, spaceId: 's1', serverBookId: remoteId, versionId }),
    };
    const read = (bookId: string, fraction: number) => {
      now += 1000;
      return env.progress.saveProgress({ bookId, cfi: null, xpointer: XP, fraction, sectionIndex: null, updatedAt: now });
    };
    return { ...env, server, deps, read };
  };

  it('pushes a local position (percentage only for a title-matched copy) and links the book', async () => {
    const { deps, server, repo, read } = await setup();
    await read('b1', 0.25);
    const summary = await syncSpaceProgress(deps, 's1', [remote()]);
    expect(summary).toMatchObject({ pushed: 1, pulled: 0, failed: 0, conflicts: [] });
    expect(server.puts[0]!.op).toMatchObject({ expectedRevision: 0, percentage: 0.25, progress: null });
    expect(await repo.getLink('b1')).toMatchObject({ serverBookId: 'r1', versionId: 'v1', lastRevision: 1 });
  });

  it('pulls a server position onto an untouched local book', async () => {
    const { deps, server, progress } = await setup();
    server.otherDeviceWrites('r1', 0.5);
    expect(await syncSpaceProgress(deps, 's1', [remote()])).toMatchObject({ pulled: 1 });
    expect(await progress.getProgress('b1')).toMatchObject({ fraction: 0.5 });
  });

  it('a second pass is in sync — relinking keeps the revision baseline (no forced 409)', async () => {
    const { deps, server, read } = await setup();
    await read('b1', 0.25);
    await syncSpaceProgress(deps, 's1', [remote()]);
    expect(await syncSpaceProgress(deps, 's1', [remote()])).toMatchObject({ inSync: 1, pushed: 0, conflicts: [] });
    expect(server.puts).toHaveLength(1);
  });

  it('reports a divergence as a conflict for an explicit choice, writing nothing', async () => {
    const { deps, server, read } = await setup();
    await read('b1', 0.25);
    await syncSpaceProgress(deps, 's1', [remote()]);
    server.otherDeviceWrites('r1', 0.8);
    await read('b1', 0.3);
    const summary = await syncSpaceProgress(deps, 's1', [remote()]);
    expect(summary.conflicts).toEqual([{ localId: 'b1', remoteTitle: 'Dune' }]);
    expect(server.state.get('r1')).toMatchObject({ percentage: 0.8 });
  });

  it('counts remotes without a ready version as nothing-to-do and failures separately', async () => {
    const { deps, read } = await setup({ r1: [] , r2: ready() });
    await read('b2', 0.4);
    deps.client.getBook = async (_s: string, id: string) => {
      if (id === 'r2') throw new Error('boom');
      return { id, title: '', author: null, versions: [] };
    };
    const summary = await syncSpaceProgress(deps, 's1', [remote(), remote({ id: 'r2', title: 'Fondation', author: null })]);
    expect(summary).toMatchObject({ none: 1, failed: 1 });
  });
});
