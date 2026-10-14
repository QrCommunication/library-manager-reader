import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SettingsScreen } from '../SettingsScreen';
import { ServicesProvider, type AppServices } from '../../../core/services';
import { initI18n } from '../../../i18n';
import { setServices as setUiPrefsServices, useUiPrefsStore } from '../uiPrefsStore';
import { setServices as setReaderSettingsServices, useReaderSettingsStore } from '../readerSettingsStore';

const mockSave = jest.fn(async () => true);
jest.mock('../../../core/storage/saf', () => ({
  ...jest.requireActual('../../../core/storage/saf'),
  saveBytesToUserDir: (...args: unknown[]) => (mockSave as (...a: unknown[]) => Promise<boolean>)(...args),
}));

jest.mock('react-native-webview', () => ({
  __esModule: true,
  default: () => null,
}));

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
  readBytes: async () => new Uint8Array([1, 2, 3]),
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

  beforeEach(() => {
    mockSave.mockClear();
  });

  beforeAll(async () => {
    // the mocked initI18n must not initialize i18next — use the real one for labels
    await realI18n.initI18n('fr');
    services = await makeServices();
    setUiPrefsServices(services);
    setReaderSettingsServices(services);
  });

  it('updates the language pref and re-initializes i18n when a language option is pressed', async () => {
    await render(<ServicesProvider value={services}><SettingsScreen /></ServicesProvider>);
    // 'English' also exists as a translation-target chip (native name); the
    // app-language radios render above that row, so the first match is the one
    fireEvent.press(screen.getAllByText('English')[0]!);
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

  it('no longer shows the LibreTranslate inputs (endpoint ships as a built-in default)', async () => {
    await render(<ServicesProvider value={services}><SettingsScreen /></ServicesProvider>);
    expect(screen.queryByText('URL LibreTranslate')).toBeNull();
    expect(screen.queryByText('Clé API LibreTranslate')).toBeNull();
  });

  it('persists the chosen translation target language', async () => {
    await render(<ServicesProvider value={services}><SettingsScreen /></ServicesProvider>);
    fireEvent.press(await screen.findByText('Deutsch'));
    expect(useUiPrefsStore.getState().prefs.translateTarget).toBe('de');
  });

  it('exports the whole library in one tap from settings', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await services.books.createBook({ title: 'Dune', author: 'F. Herbert', format: 'epub', originalFormat: null, fileName: 'd.epub', fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    await render(<ServicesProvider value={services}><SettingsScreen /></ServicesProvider>);
    fireEvent.press(await screen.findByText('Exporter'));
    await waitFor(() => {
      expect(mockSave).toHaveBeenCalledWith(
        expect.stringMatching(/^library-reader-export-\d{4}-\d{2}-\d{2}\.zip$/),
        'application/zip',
        expect.any(Uint8Array),
      );
    });
    expect(alertSpy).toHaveBeenCalledWith('Exporter toute la bibliothèque', 'Fichier enregistré');
    alertSpy.mockRestore();
  });

  it('warns when there is nothing to export', async () => {
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    // the suite shares one database: tombstone whatever previous tests added
    for (const b of await services.books.listBooks({ sort: 'added' })) {
      await services.books.markDeleted(b.id, Date.now());
    }
    await render(<ServicesProvider value={services}><SettingsScreen /></ServicesProvider>);
    fireEvent.press(await screen.findByText('Exporter'));
    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith('Exporter toute la bibliothèque', 'Aucun livre à exporter');
    });
    expect(mockSave).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});
