import { DatabaseSync } from 'node:sqlite';
import { createNodeSqliteDriver } from '../../../db/nodeSqliteDriver';
import { migrate } from '../../../db/migrate';
import { createBooksRepo } from '../../../db/booksRepo';
import { createProgressRepo } from '../../../db/progressRepo';
import { createSettingsRepo } from '../../../db/settingsRepo';
import { createRemoteSyncRepo, type RemoteSyncRepo } from '../../../db/remoteSyncRepo';
import { LM_TOKEN_KEYS } from '../lmTokens';
import type { LmClient } from '../lmClient';
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
    await pushReadingPosition(services, 'b1', { cfi: 'c1', fraction: 0.5 });
    expect(put).not.toHaveBeenCalled();
    expect(await remoteSync.pendingOps()).toHaveLength(0);
  });

  it('push: linked + connected → journal op sent with the local percent, receipt revision stored', async () => {
    const { services, remoteSync, settings } = await makeEnv();
    await remoteSync.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1' });
    const prefs: UiPrefs = { ...DEFAULT_UI_PREFS };
    await settings.putUiPrefs({ ...prefs, lmUsername: 'me', lmInstallationId: 'inst-1' });
    await seedTokens();
    const puts: { expectedRevision: number; percent: number; installationId: string }[] = [];
    const client = {
      putProgress: async (_s: string, _b: string, op: { expectedRevision: number; percent: number; installationId: string }) => {
        puts.push(op);
        return { bookId: 'sb1', versionId: 'v1', cfi: null, chapterId: null, percent: op.percent, revision: 1, updatedAt: 1700000000 };
      },
    } as unknown as Pick<LmClient, 'putProgress'>;
    const spy = jest.spyOn(require('../lmAccount'), 'lmClientFromAccount').mockImplementation(async () => client as LmClient);

    await pushReadingPosition(services, 'b1', { cfi: 'epubcfi(x)', fraction: 0.5 });

    expect(puts).toHaveLength(1);
    expect(puts[0]).toMatchObject({ expectedRevision: 0, percent: 50, installationId: 'inst-1' });
    expect(await remoteSync.pendingOps()).toHaveLength(0);
    expect(await remoteSync.getLastRevision('b1')).toBe(1);
    spy.mockRestore();
  });

  it('pull: server strictly newer → local progress replaced; local newer → untouched', async () => {
    const { services, progress, remoteSync } = await makeEnv();
    await remoteSync.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1' });
    await seedTokens();
    const spy = jest.spyOn(require('../lmAccount'), 'lmClientFromAccount');

    // server newer than the (absent) local progress → applied
    let client = {
      getProgress: async () => ({ bookId: 'sb1', versionId: 'v1', cfi: 'srv', chapterId: null, percent: 70, revision: 2, updatedAt: 1700000000 }),
    } as unknown as Pick<LmClient, 'getProgress'>;
    spy.mockImplementation(async () => client as LmClient);
    await pullReadingPosition(services, 'b1');
    expect(await progress.getProgress('b1')).toMatchObject({ fraction: 0.7, cfi: 'srv' });

    // local newer → untouched
    client = {
      getProgress: async () => ({ bookId: 'sb1', versionId: 'v1', cfi: 'old', chapterId: null, percent: 10, revision: 3, updatedAt: 1600000000 }),
    } as unknown as Pick<LmClient, 'getProgress'>;
    spy.mockImplementation(async () => client as LmClient);
    await pullReadingPosition(services, 'b1');
    expect(await progress.getProgress('b1')).toMatchObject({ fraction: 0.7 });
    spy.mockRestore();
  });
});
