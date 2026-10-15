import { LmError } from '../lmClient';
import { flushProgressJournal, onProgressConflict, REPLAY_WINDOW_MS } from '../liveSync';
import { fakeLmServer, journalOp, makeSyncDb } from './fakeLmServer';

const XP = '/body/DocFragment[3]/body/p[2]/text().7';

const setup = async (books = ['b1']) => {
  const env = await makeSyncDb(books);
  for (const b of books) await env.repo.linkBook({ bookId: b, spaceId: 's1', serverBookId: `srv-${b}`, versionId: 'v1' });
  const server = fakeLmServer();
  let now = 10_000;
  const deps = { client: server.client, repo: env.repo, installationId: 'inst', now: () => now };
  return { ...env, server, deps, tick: (ms: number) => { now += ms; } };
};

describe('flushProgressJournal — exact replay, one op in flight per book, explicit conflicts', () => {
  it('sends the KOReader body with the stored revision and records the agreement', async () => {
    const { repo, server, deps } = await setup();
    await repo.enqueueOp(journalOp('b1', 'o1', 0.2, XP));
    expect(await flushProgressJournal(deps)).toEqual({ sent: 1, remaining: 0, conflicts: [] });
    expect(server.puts[0]!.op).toEqual({
      installationId: 'inst', operationId: 'o1', expectedRevision: 0, versionId: 'v1', progress: XP, percentage: 0.2,
    });
    expect(await repo.pendingOps()).toEqual([]);
    expect(await repo.getLink('b1')).toMatchObject({ lastRevision: 1, syncedAt: 10_000 });
  });

  it('a lost response is recovered by re-sending the SAME operation (same id, same body)', async () => {
    const { repo, server, deps } = await setup();
    await repo.enqueueOp(journalOp('b1', 'o1', 0.2));
    server.loseNextResponse();
    expect(await flushProgressJournal(deps)).toMatchObject({ sent: 0, remaining: 1 });
    // the next page turn must not coalesce away the ambiguous op
    await repo.enqueueOp(journalOp('b1', 'o2', 0.3));
    expect(await flushProgressJournal(deps)).toMatchObject({ sent: 2, remaining: 0 });
    expect(server.puts.map((p) => [p.op.operationId, p.op.expectedRevision])).toEqual([['o1', 0], ['o1', 0], ['o2', 1]]);
    // the replay was answered with the stored receipt: no double revision
    expect(server.state.get('srv-b1')).toMatchObject({ revision: 2, percentage: 0.3 });
    expect(await repo.getLastRevision('b1')).toBe(2);
  });

  it('a 409 parks the op as a conflict: nothing overwritten, later ops of that book wait, others go on', async () => {
    const { repo, server, deps } = await setup(['b1', 'b2']);
    server.otherDeviceWrites('srv-b1', 0.9);
    const seen: string[] = [];
    const off = onProgressConflict((b) => seen.push(b));
    await repo.enqueueOp(journalOp('b1', 'o1', 0.2));
    await repo.enqueueOp(journalOp('b2', 'o2', 0.4));
    const summary = await flushProgressJournal(deps);
    off();
    expect(summary).toEqual({ sent: 1, remaining: 0, conflicts: ['b1'] });
    expect(seen).toEqual(['b1']);
    // the other device's position is intact
    expect(server.state.get('srv-b1')).toMatchObject({ percentage: 0.9, revision: 1 });
    expect((await repo.opsForBook('b1'))[0]).toMatchObject({ state: 'conflict', conflictRevision: 1 });
    // a new page turn is journaled but waits behind the conflict
    await repo.enqueueOp(journalOp('b1', 'o3', 0.25));
    await flushProgressJournal(deps);
    expect(server.puts.map((p) => p.op.operationId)).toEqual(['o1', 'o2']);
    expect((await repo.opsForBook('b1')).map((o) => [o.operationId, o.state])).toEqual([['o1', 'conflict'], ['o3', 'pending']]);
  });

  it('offline, 5xx, 429 and an expired session keep the op; a definitive 4xx drops it', async () => {
    const { repo, server, deps } = await setup();
    await repo.enqueueOp(journalOp('b1', 'o1', 0.2));
    for (const err of [
      new LmError('network', 'offline'),
      new LmError('server', '503', undefined, undefined, 503),
      new LmError('rate', '429', undefined, undefined, 429),
      new LmError('auth', undefined, undefined, undefined, 401),
    ]) {
      server.failNext(err);
      expect(await flushProgressJournal(deps)).toMatchObject({ sent: 0, remaining: 1 });
    }
    server.failNext(new LmError('server', '422', 'validationFailed', undefined, 422));
    expect(await flushProgressJournal(deps)).toMatchObject({ sent: 0, remaining: 0 });
    expect(await repo.pendingOps()).toEqual([]);
  });

  it('an op first sent beyond the replay window is not replayed: it waits for explicit reconciliation', async () => {
    const { repo, server, deps, tick } = await setup();
    await repo.enqueueOp(journalOp('b1', 'o1', 0.2));
    server.failNext(new LmError('network', 'offline'));
    await flushProgressJournal(deps);
    tick(REPLAY_WINDOW_MS + 1);
    const summary = await flushProgressJournal(deps);
    expect(summary.conflicts).toEqual(['b1']);
    expect(server.puts).toHaveLength(1);
    expect((await repo.opsForBook('b1'))[0]).toMatchObject({ state: 'conflict' });
  });

  it('is single-flight: concurrent callers share one drain', async () => {
    const { repo, server, deps } = await setup();
    await repo.enqueueOp(journalOp('b1', 'o1', 0.2));
    const [a, b] = await Promise.all([flushProgressJournal(deps), flushProgressJournal(deps)]);
    expect(a).toBe(b);
    expect(server.puts).toHaveLength(1);
  });
});
