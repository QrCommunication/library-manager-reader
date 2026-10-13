import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { LibraryScreen } from '../LibraryScreen';
import { ServicesProvider } from '../../../core/services';
import { initI18n } from '../../../i18n';

jest.mock('expo-router', () => {
  const React = require('react');
  return {
    useRouter: () => ({ push: jest.fn() }),
    // focus-on-mount semantics: run the callback once per mount (calling it on
    // every render would loop forever because refresh() sets a new array each time)
    useFocusEffect: (cb: () => void) => React.useEffect(() => { cb(); }, [cb]),
  };
});

jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
  (buttons?.find((b) => b.text === 'Confirmer') as { onPress?: () => void } | undefined)?.onPress?.();
});

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));
const mockPicker = require('expo-document-picker').getDocumentAsync as jest.Mock;

jest.mock('../../../core/reader/headlessEngine', () => ({
  getHeadlessEngine: jest.fn(),
}));
const mockGetEngine = require('../../../core/reader/headlessEngine').getHeadlessEngine as jest.Mock;

const makeServices = async () => {
  const { DatabaseSync } = require('node:sqlite');
  const { createNodeSqliteDriver } = require('../../../db/nodeSqliteDriver');
  const { migrate } = require('../../../db/migrate');
  const { createServices } = require('../../../core/services');
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  return createServices({ db, fs: fakeFs(), root: '/doc', newId: (() => { let i = 0; return () => `id-${++i}`; })() });
};

const fakeFs = () => ({
  freeDiskBytes: async () => 1e9, ensureDir: async () => {}, copy: async () => {}, exists: async () => true,
  remove: async () => {}, fileSize: async () => 100, writeBase64: async () => {}, readBase64Chunks: async () => {},
  directorySize: async () => 0,
});

describe('LibraryScreen', () => {
  beforeAll(async () => {
    await initI18n('fr');
  });

  it('shows the empty state', async () => {
    const services = await makeServices();
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
    expect(await screen.findByText('Bibliothèque')).toBeOnTheScreen();
    expect(await screen.findByText('Votre bibliothèque est vide')).toBeOnTheScreen();
  });

  it('renders books after seeding and deletes via long-press menu', async () => {
    const services = await makeServices();
    await services.books.createBook({ title: 'Dune', author: 'F. Herbert', format: 'epub', originalFormat: null, fileName: 'd.epub', fileSize: 1, language: null, publisher: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
    expect(await screen.findByText('Dune')).toBeOnTheScreen();
    fireEvent(await screen.findByText('Dune'), 'longPress');
    fireEvent.press(await screen.findByText('Supprimer'));
    await waitFor(async () => expect(screen.queryByText('Dune')).toBeNull());
  });

  it('surfaces a pre-import crash (headless engine) in the results sheet with its detail', async () => {
    const services = await makeServices();
    mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x/Book.epub' }] });
    mockGetEngine.mockImplementation(() => { throw new Error('headless engine not initialised'); });
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
    fireEvent.press(await screen.findByText('Ajouter des livres'));
    expect(await screen.findByText('Import terminé')).toBeOnTheScreen();
    expect(await screen.findByText(/headless engine not initialised/)).toBeOnTheScreen();
  });

  it('shows the underlying io error detail next to the failed file', async () => {
    const services = await makeServices();
    services.fs.copy = async () => { throw new Error('EIO: copy failed'); };
    mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x/Book.epub' }] });
    mockGetEngine.mockReturnValue({ extract: jest.fn() });
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
    fireEvent.press(await screen.findByText('Ajouter des livres'));
    expect(await screen.findByText('Import terminé')).toBeOnTheScreen();
    expect(await screen.findByText(/EIO: copy failed/)).toBeOnTheScreen();
  });
});
