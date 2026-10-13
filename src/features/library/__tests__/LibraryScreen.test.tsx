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
});
