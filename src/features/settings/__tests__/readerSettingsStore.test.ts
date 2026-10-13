import { DatabaseSync } from 'node:sqlite';
import { createNodeSqliteDriver } from '../../../db/nodeSqliteDriver';
import { migrate } from '../../../db/migrate';
import { createServices } from '../../../core/services';
import { DEFAULT_READER_SETTINGS } from '../../../core/types';
import { createReaderSettingsStore } from '../readerSettingsStore';

const fakeFs = {
  freeDiskBytes: async () => 1e9, ensureDir: async () => {}, copy: async () => {}, exists: async () => false,
  remove: async () => {}, fileSize: async () => 0, writeBase64: async () => {},
  readBase64Chunks: async () => {}, directorySize: async () => 0,
};

describe('readerSettingsStore', () => {
  it('hydrates defaults then persists updates', async () => {
    const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
    await migrate(db);
    const services = createServices({ db, fs: fakeFs, root: '/tmp', newId: () => 'id' });
    let state = { settings: DEFAULT_READER_SETTINGS, hydrated: false };
    // hydrate via store factory directly (zustand store tested through its actions)
    const use = createReaderSettingsStore(() => services);
    await use.getState().hydrate();
    expect(use.getState().settings).toEqual(DEFAULT_READER_SETTINGS);
    await use.getState().update({ theme: 'night' });
    expect(use.getState().settings.theme).toBe('night');
    expect((await services.settings.getReaderSettings()).theme).toBe('night');
  });
});
