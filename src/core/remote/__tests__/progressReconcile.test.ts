import { describeConflict, reconcileBook, resolveConflict, type ReconcileDeps } from '../progressReconcile';
import { fakeLmServer, journalOp, makeSyncDb } from './fakeLmServer';

const XP_LOCAL = '/body/DocFragment[2]/body/p[3]/text().12';
const XP_SERVER = '/body/DocFragment[5]/body/p/text().0';

const setup = async (opts: { exactCopy?: boolean } = {}) => {
  const env = await makeSyncDb(['b1']);
  await env.repo.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'srv-b1', versionId: 'v1', exactCopy: opts.exactCopy ?? true });
  const server = fakeLmServer();
  let now = 50_000;
  let seq = 0;
  const deps: ReconcileDeps = {
    client: server.client,
    repo: env.repo,
    progress: env.progress,
    installationId: 'inst',
    newOperationId: () => `op-${++seq}`,
    now: () => now,
  };
  const readLocally = (fraction: number, xpointer: string | null = XP_LOCAL) => {
    now += 1000;
    return env.progress.saveProgress({ bookId: 'b1', cfi: 'epubcfi(/6/4)', xpointer, fraction, sectionIndex: 1, updatedAt: now });
  };
  return { ...env, server, deps, readLocally };
};

describe('reconcileBook — revision-based, no clock comparison across devices', () => {
  it('fast-forwards to another device when the local position did not move', async () => {
    const { deps, server, progress, repo } = await setup();
    server.otherDeviceWrites('srv-b1', 0.6, XP_SERVER);
    const r = await reconcileBook(deps, 'b1');
    expect(r.kind).toBe('pulled');
    expect(await progress.getProgress('b1')).toMatchObject({ fraction: 0.6, xpointer: XP_SERVER, cfi: null });
    expect(await repo.getLink('b1')).toMatchObject({ lastRevision: 1 });
  });

  it('keeps only the percentage of a title-matched (non exact) copy', async () => {
    const { deps, server, progress } = await setup({ exactCopy: false });
    server.otherDeviceWrites('srv-b1', 0.6, XP_SERVER);
    await reconcileBook(deps, 'b1');
    expect(await progress.getProgress('b1')).toMatchObject({ fraction: 0.6, xpointer: null });
  });

  it('writes the first record against revision 0 when the server has none', async () => {
    const { deps, server, readLocally } = await setup();
    await readLocally(0.3);
    expect((await reconcileBook(deps, 'b1')).kind).toBe('pushed');
    expect(server.puts[0]!.op).toMatchObject({ expectedRevision: 0, progress: XP_LOCAL, percentage: 0.3 });
  });

  it('pushes a local move when nothing new happened remotely', async () => {
    const { deps, server, readLocally } = await setup();
    await readLocally(0.3);
    await reconcileBook(deps, 'b1');
    await readLocally(0.4);
    expect((await reconcileBook(deps, 'b1')).kind).toBe('pushed');
    expect(server.state.get('srv-b1')).toMatchObject({ revision: 2, percentage: 0.4 });
  });

  it('both sides moved → explicit conflict: nothing overwritten on either side', async () => {
    const { deps, server, progress, repo, readLocally } = await setup();
    await readLocally(0.3);
    await reconcileBook(deps, 'b1');
    server.otherDeviceWrites('srv-b1', 0.8, XP_SERVER);
    await readLocally(0.35);
    expect((await reconcileBook(deps, 'b1')).kind).toBe('conflict');
    expect(server.state.get('srv-b1')).toMatchObject({ percentage: 0.8, revision: 2 });
    expect(await progress.getProgress('b1')).toMatchObject({ fraction: 0.35, xpointer: XP_LOCAL });
    expect((await repo.opsForBook('b1'))[0]).toMatchObject({ state: 'conflict', conflictRevision: 2 });
    // a re-check keeps reporting it until the user chooses
    expect((await reconcileBook(deps, 'b1')).kind).toBe('conflict');
  });

  it('a moving back is valid: no max-percentage rule', async () => {
    const { deps, server, readLocally } = await setup();
    await readLocally(0.8);
    await reconcileBook(deps, 'b1');
    await readLocally(0.1);
    expect((await reconcileBook(deps, 'b1')).kind).toBe('pushed');
    expect(server.state.get('srv-b1')).toMatchObject({ percentage: 0.1 });
  });

  it('a lost receipt is recovered before deciding: our own write is not seen as another device', async () => {
    const { deps, server, repo, readLocally } = await setup();
    await readLocally(0.3);
    await repo.enqueueOp(journalOp('b1', 'op-x', 0.3, XP_LOCAL));
    server.loseNextResponse();
    await reconcileBook(deps, 'b1'); // the op reached the server, the answer did not
    expect(await repo.getLastRevision('b1')).toBe(0);
    expect((await reconcileBook(deps, 'b1')).kind).toBe('inSync');
    expect(await repo.getLastRevision('b1')).toBe(1);
    expect(server.state.get('srv-b1')!.revision).toBe(1);
  });

  it('decides nothing while the journal cannot drain (offline)', async () => {
    const { deps, server, repo, readLocally } = await setup();
    await readLocally(0.3);
    await repo.enqueueOp(journalOp('b1', 'op-x', 0.3));
    const { LmError } = jest.requireActual('../lmClient');
    server.failNext(new LmError('network', 'offline'));
    expect((await reconcileBook(deps, 'b1')).kind).toBe('none');
  });
});

describe('explicit conflict choice', () => {
  const conflicted = async () => {
    const env = await setup();
    await env.readLocally(0.3);
    await reconcileBook(env.deps, 'b1');
    env.server.otherDeviceWrites('srv-b1', 0.8, XP_SERVER);
    await env.readLocally(0.35);
    await reconcileBook(env.deps, 'b1');
    return env;
  };

  it('describeConflict shows both positions, the version and fresh server data', async () => {
    const { deps } = await conflicted();
    expect(await describeConflict(deps, 'b1')).toMatchObject({
      versionId: 'v1',
      server: { percentage: 0.8, progress: XP_SERVER, revision: 2 },
      local: { fraction: 0.35, xpointer: XP_LOCAL },
    });
  });

  it("'server' applies the server position and closes the parked op", async () => {
    const { deps, progress, repo } = await conflicted();
    const applied = await resolveConflict(deps, 'b1', 'server');
    expect(applied).toMatchObject({ fraction: 0.8, xpointer: XP_SERVER });
    expect(await progress.getProgress('b1')).toMatchObject({ fraction: 0.8 });
    expect(await repo.opsForBook('b1')).toEqual([]);
    expect(await repo.getLink('b1')).toMatchObject({ lastRevision: 2 });
  });

  it("'local' sends a NEW operation against the re-read revision", async () => {
    const { deps, server, repo } = await conflicted();
    const parkedId = (await repo.opsForBook('b1'))[0]!.operationId;
    await resolveConflict(deps, 'b1', 'local');
    const last = server.puts[server.puts.length - 1]!.op;
    expect(last.operationId).not.toBe(parkedId);
    expect(last).toMatchObject({ expectedRevision: 2, percentage: 0.35, progress: XP_LOCAL });
    expect(server.state.get('srv-b1')).toMatchObject({ revision: 3, percentage: 0.35 });
    expect(await repo.opsForBook('b1')).toEqual([]);
  });

  it("'local' meeting yet another device parks a new conflict (asked again)", async () => {
    const { deps, server, repo } = await conflicted();
    const realGet = server.client.getProgress;
    // another device writes between our re-read and our write
    server.client.getProgress = async (...args) => {
      const r = await realGet(...args);
      server.otherDeviceWrites('srv-b1', 0.95);
      return r;
    };
    await resolveConflict(deps, 'b1', 'local');
    expect((await repo.opsForBook('b1'))[0]).toMatchObject({ state: 'conflict' });
    expect(server.state.get('srv-b1')).toMatchObject({ percentage: 0.95 });
  });
});
