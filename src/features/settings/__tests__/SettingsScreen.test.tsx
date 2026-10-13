import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SettingsScreen } from '../SettingsScreen';
import { ServicesProvider, type AppServices } from '../../../core/services';
import { initI18n } from '../../../i18n';
import { setServices as setUiPrefsServices, useUiPrefsStore } from '../uiPrefsStore';
import { setServices as setReaderSettingsServices, useReaderSettingsStore } from '../readerSettingsStore';

// '../../../i18n' from this folder is src/i18n — the module SettingsScreen imports.
// Only initI18n is mocked (the screen must not switch languages for real in tests);
// everything else (resources…) passes through via requireActual.
jest.mock('../../../i18n', () => ({
  ...jest.requireActual('../../../i18n'),
  initI18n: jest.fn(() => Promise.resolve()),
}));

const realI18n = jest.requireActual('../../../i18n') as typeof import('../../../i18n');

const fakeFs = () => ({
  freeDiskBytes: async () => 1e9, ensureDir: async () => {}, copy: async () => {}, exists: async () => true,
  remove: async () => {}, fileSize: async () => 100, writeBase64: async () => {}, readBase64Chunks: async () => {},
  directorySize: async () => 0,
});

const makeServices = async (): Promise<AppServices> => {
  const { DatabaseSync } = require('node:sqlite');
  const { createNodeSqliteDriver } = require('../../../db/nodeSqliteDriver');
  const { migrate } = require('../../../db/migrate');
  const { createServices } = require('../../../core/services');
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  return createServices({ db, fs: fakeFs(), root: '/doc', newId: (() => { let i = 0; return () => `id-${++i}`; })() });
};

describe('SettingsScreen', () => {
  let services: AppServices;

  beforeAll(async () => {
    // the mocked initI18n must not initialize i18next — use the real one for labels
    await realI18n.initI18n('fr');
    services = await makeServices();
    setUiPrefsServices(services);
    setReaderSettingsServices(services);
  });

  it('updates the language pref and re-initializes i18n when a language option is pressed', async () => {
    await render(<ServicesProvider value={services}><SettingsScreen /></ServicesProvider>);
    fireEvent.press(await screen.findByText('English'));
    expect(initI18n).toHaveBeenCalledWith('en');
    expect(useUiPrefsStore.getState().prefs.language).toBe('en');
  });

  it('renders the storage usage row', async () => {
    await render(<ServicesProvider value={services}><SettingsScreen /></ServicesProvider>);
    expect(screen.getByText('Stockage')).toBeOnTheScreen();
    expect(await screen.findByText('0 Mo')).toBeOnTheScreen();
  });

  it('applies a theme choice to the global reader theme too, not only to defaultTheme', async () => {
    await render(<ServicesProvider value={services}><SettingsScreen /></ServicesProvider>);
    fireEvent.press(await screen.findByText('Nuit'));
    expect(useUiPrefsStore.getState().prefs.defaultTheme).toBe('night');
    expect(useReaderSettingsStore.getState().settings.theme).toBe('night');
  });
});
