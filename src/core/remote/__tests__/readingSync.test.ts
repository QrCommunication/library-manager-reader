import { DatabaseSync } from 'node:sqlite';
import { createNodeSqliteDriver } from '../../../db/nodeSqliteDriver';
import { migrate } from '../../../db/migrate';
import { createBooksRepo } from '../../../db/booksRepo';
import { createProgressRepo } from '../../../db/progressRepo';
import { createSettingsRepo } from '../../../db/settingsRepo';
import { createRemoteSyncRepo, type RemoteSyncRepo } from '../../../db/remoteSyncRepo';
import { LM_TOKEN_KEYS } from '../lmTokens';
import type { LmClient, LmProgressOp } from '../lmClient';

const XP = '/body/DocFragment[2]/body/p[3]/text().42';
import { pullReadingPosition, pushReadingPosition } from '../readingSync';
import { DEFAULT_UI_PREFS, type UiPrefs } from '../../types';

jest.mock('expo-crypto', () => ({
  __esModule: true,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async () => new ArrayBuffer(32),
  getRandomValues: (arr: Uint8Array) => { require('node:crypto').webcrypto.getRandomValues(arr); return arr; },
}));

const makeEnv = async () => {
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  await db.run(
    'INSERT INTO books (id, title, format, file_name, file_size, added_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ['b1', 'T', 'epub', 'b1.epub', 1, 1, 1],
  );
  const books = createBooksRepo(db, () => 'id-x');
  const progress = createProgressRepo(db);
  const settings = createSettingsRepo(db);
  const remoteSync = createRemoteSyncRepo(db);
  const services = { books, progress, settings, remoteSync } as unknown as Parameters<typeof pullReadingPosition>[0];
  return { services: services as never, progress, remoteSync, settings };
};

const seedTokens = async (expiresAt = Date.now() + 3600_000) => {
  const SecureStore = require('expo-secure-store');
  await SecureStore.setItemAsync(LM_TOKEN_KEYS.access, 'tok');
  await SecureStore.setItemAsync(LM_TOKEN_KEYS.refresh, 'rt');
  await SecureStore.setItemAsync(LM_TOKEN_KEYS.expiresAt, String(expiresAt));
};

describe('readingSync — live page-turn glue', () => {
  beforeEach(async () => {
    const SecureStore = require('expo-secure-store');
    (SecureStore.__store as Map<string, string>).clear();
  });

  it('push: no link → nothing enqueued, no client call', async () => {
    const { services, remoteSync } = await makeEnv();
    const put = jest.fn();
    const client = { putProgress: put } as unknown as Pick<LmClient, 'putProgress'>;
    jest.spyOn(require('../lmAccount'), 'lmClientFromAccount').mockImplementation(async () => client as LmClient);
    await pushReadingPosition(services, 'b1', { xpointer: XP, fraction: 0.5 });
    expect(put).not.toHaveBeenCalled();
    expect(await remoteSync.pendingOps()).toHaveLength(0);
  });

  it('push: linked exact copy + connected → KOReader op sent (XPointer + fraction), receipt revision stored', async () => {
    const { services, remoteSync, settings } = await makeEnv();
    await remoteSync.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', exactCopy: true });
    const prefs: UiPrefs = { ...DEFAULT_UI_PREFS };
    await settings.putUiPrefs({ ...prefs, lmUsername: 'me', lmInstallationId: 'inst-1' });
    await seedTokens();
    const puts: LmProgressOp[] = [];
    const client = {
      putProgress: async (_s: string, _b: string, op: LmProgressOp) => {
        puts.push(op);
        return { bookId: 'sb1', versionId: 'v1', progress: op.progress, percentage: op.percentage, revision: 1, updatedAtMs: 1700000000000 };
      },
    } as unknown as Pick<LmClient, 'putProgress'>;
    const spy = jest.spyOn(require('../lmAccount'), 'lmClientFromAccount').mockImplementation(async () => client as LmClient);

    await pushReadingPosition(services, 'b1', { xpointer: XP, fraction: 0.5 });

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ expectedRevision: 0, progress: XP, percentage: 0.5, installationId: 'inst-1' });
    expect(puts[0]).not.toHaveProperty('cfi');
    expect(puts[0]).not.toHaveProperty('percent');
    expect(await remoteSync.pendingOps()).toHaveLength(0);
    expect(await remoteSync.getLastRevision('b1')).toBe(1);
    spy.mockRestore();
  });

  it('pull: server strictly newer → local progress replaced; local newer → untouched', async () => {
    const { services, progress, remoteSync } = await makeEnv();
    await remoteSync.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', exactCopy: true });
    await seedTokens();
    const spy = jest.spyOn(require('../lmAccount'), 'lmClientFromAccount');

    // server newer than the (absent) local progress → applied
    let client = {
      getProgress: async () => ({ bookId: 'sb1', versionId: 'v1', progress: XP, percentage: 0.7, revision: 2, updatedAtMs: 1700000000000 }),
    } as unknown as Pick<LmClient, 'getProgress'>;
    spy.mockImplementation(async () => client as LmClient);
    await pullReadingPosition(services, 'b1');
    // the engine resolves the XPointer on open: no stale local cfi survives
    expect(await progress.getProgress('b1')).toMatchObject({ fraction: 0.7, cfi: null, xpointer: XP });

    // local newer → untouched
    client = {
      getProgress: async () => ({ bookId: 'sb1', versionId: 'v1', progress: null, percentage: 0.1, revision: 3, updatedAtMs: 1600000000000 }),
    } as unknown as Pick<LmClient, 'getProgress'>;
    spy.mockImplementation(async () => client as LmClient);
    await pullReadingPosition(services, 'b1');
    expect(await progress.getProgress('b1')).toMatchObject({ fraction: 0.7 });
    spy.mockRestore();
  });

  it('push: a title-matched (non-exact) link sends the percentage only', async () => {
    const { services, remoteSync, settings } = await makeEnv();
    await remoteSync.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1' });
    await settings.putUiPrefs({ ...DEFAULT_UI_PREFS, lmUsername: 'me', lmInstallationId: 'inst-1' });
    await seedTokens();
    const puts: LmProgressOp[] = [];
    const client = {
      putProgress: async (_s: string, _b: string, op: LmProgressOp) => {
        puts.push(op);
        return { bookId: 'sb1', versionId: 'v1', progress: null, percentage: op.percentage, revision: 1, updatedAtMs: 1700000000000 };
      },
    } as unknown as Pick<LmClient, 'putProgress'>;
    const spy = jest.spyOn(require('../lmAccount'), 'lmClientFromAccount').mockImplementation(async () => client as LmClient);
    await pushReadingPosition(services, 'b1', { xpointer: XP, fraction: 0.25 });
    expect(puts[0]).toMatchObject({ progress: null, percentage: 0.25 });
    spy.mockRestore();
  });
});
