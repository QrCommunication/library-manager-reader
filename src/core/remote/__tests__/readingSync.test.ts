import { DatabaseSync } from 'node:sqlite';
import { createNodeSqliteDriver } from '../../../db/nodeSqliteDriver';
import { migrate } from '../../../db/migrate';
import { createBooksRepo } from '../../../db/booksRepo';
import { createProgressRepo } from '../../../db/progressRepo';
import { createSettingsRepo } from '../../../db/settingsRepo';
import { createRemoteSyncRepo } from '../../../db/remoteSyncRepo';
import { LM_TOKEN_KEYS } from '../lmTokens';
import type { LmClient, LmProgressOp } from '../lmClient';

import { pushReadingPosition, reconcileReadingPosition, resolveReadingConflict } from '../readingSync';
import { fakeLmServer } from './fakeLmServer';
import { DEFAULT_UI_PREFS, type UiPrefs } from '../../types';

const XP = '/body/DocFragment[2]/body/p[3]/text().42';

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
  const services = { books, progress, settings, remoteSync } as unknown as Parameters<typeof pushReadingPosition>[0];
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

  it('reconcile: unlinked or signed out → none, no network', async () => {
    const { services } = await makeEnv();
    const spy = jest.spyOn(require('../lmAccount'), 'lmClientFromAccount');
    expect(await reconcileReadingPosition(services, 'b1')).toEqual({ kind: 'none' });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('reconcile at open: another device moved, this one did not → fast-forward (XPointer kept)', async () => {
    const { services, progress, remoteSync, settings } = await makeEnv();
    await remoteSync.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', exactCopy: true });
    await settings.putUiPrefs({ ...DEFAULT_UI_PREFS, lmUsername: 'me', lmInstallationId: 'inst-1' });
    await seedTokens();
    const server = fakeLmServer();
    server.otherDeviceWrites('sb1', 0.7, XP);
    const spy = jest.spyOn(require('../lmAccount'), 'lmClientFromAccount').mockImplementation(async () => server.client as unknown as LmClient);
    expect(await reconcileReadingPosition(services, 'b1')).toMatchObject({ kind: 'pulled' });
    expect(await progress.getProgress('b1')).toMatchObject({ fraction: 0.7, cfi: null, xpointer: XP });
    spy.mockRestore();
  });

  it('reconcile: both moved → conflict; resolving with the local side writes a new op on the re-read revision', async () => {
    const { services, progress, remoteSync, settings } = await makeEnv();
    await remoteSync.linkBook({ bookId: 'b1', spaceId: 's1', serverBookId: 'sb1', versionId: 'v1', exactCopy: true });
    await settings.putUiPrefs({ ...DEFAULT_UI_PREFS, lmUsername: 'me', lmInstallationId: 'inst-1' });
    await seedTokens();
    const server = fakeLmServer();
    const spy = jest.spyOn(require('../lmAccount'), 'lmClientFromAccount').mockImplementation(async () => server.client as unknown as LmClient);
    await progress.saveProgress({ bookId: 'b1', cfi: 'c', xpointer: XP, fraction: 0.2, sectionIndex: null, updatedAt: Date.now() });
    server.otherDeviceWrites('sb1', 0.9);
    expect(await reconcileReadingPosition(services, 'b1')).toEqual({ kind: 'conflict' });
    expect(server.state.get('sb1')).toMatchObject({ percentage: 0.9 });
    await resolveReadingConflict(services, 'b1', 'local');
    expect(server.state.get('sb1')).toMatchObject({ percentage: 0.2, progress: XP, revision: 2 });
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
