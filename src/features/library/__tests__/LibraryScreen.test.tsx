import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import { LibraryScreen } from '../LibraryScreen';
import { ServicesProvider } from '../../../core/services';
import { DialogHost } from '../../../ui/DialogHost';
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

  // the in-memory secure store is module-global: keep tests independent
  beforeEach(() => {
    (require('expo-secure-store').__store as Map<string, string>).clear();
  });

  it('shows the empty state', async () => {
    const services = await makeServices();
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    expect(await screen.findByText('Bibliothèque')).toBeOnTheScreen();
    expect(await screen.findByText('Votre bibliothèque est vide')).toBeOnTheScreen();
  });

  it('opens the remote spaces sheet from the library title and offers sign-in when not connected', async () => {
    const services = await makeServices();
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    fireEvent.press(await screen.findByLabelText('library-manager.com'));
    expect(await screen.findByText('Connectez-vous à library-manager.com pour retrouver vos espaces')).toBeOnTheScreen();
    expect(screen.getByText('Ouvrir les réglages')).toBeOnTheScreen();
  });

  it('lists a space books as tiles and marks the ones already in the library', async () => {
    const services = await makeServices();
    const mk = (title: string) =>
      services.books.createBook({ title, author: null, format: 'epub', originalFormat: null, fileName: `${title}.epub`, fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    await mk('Serveur');
    await mk('LocalOnly');
    // sign-in state lives in the (mocked) secure store, not in the prefs
    const { LM_TOKEN_KEYS } = require('../../../core/remote/lmTokens');
    const SecureStore = require('expo-secure-store');
    await SecureStore.setItemAsync(LM_TOKEN_KEYS.access, 'tok');
    await SecureStore.setItemAsync(LM_TOKEN_KEYS.refresh, 'rt');
    await SecureStore.setItemAsync(LM_TOKEN_KEYS.expiresAt, String(Date.now() + 3600_000));
    const fetchMock = jest.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/api/v1/mobile/spaces')) {
        return new Response(JSON.stringify([{ id: 's1', name: 'Perso', role: 'owner' }]), { status: 200 });
      }
      if (u.includes('/api/v1/mobile/spaces/s1/books?')) {
        return new Response(JSON.stringify({
          items: [{ id: 'rb1', title: 'Serveur', author: null, series: null, seriesIndex: null, updatedAt: 5 }],
          nextCursor: null,
          total: 1,
        }), { status: 200 });
      }
      return new Response('nope', { status: 404 });
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);
    try {
      await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
      fireEvent.press(await screen.findByLabelText('library-manager.com'));
      fireEvent.press(await screen.findByText('Perso'));
      // the remote book renders as a tile; the matched one carries the badge…
      expect(await screen.findByLabelText('Serveur — Dans la bibliothèque')).toBeOnTheScreen();
      // …and the upload section is gone (uploads moved to the book long-press menu)
      expect(screen.queryByText('Locaux absents du serveur (1)')).toBeNull();
      expect(screen.getByLabelText('Synchroniser l’avancement')).toBeOnTheScreen();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('searches the server through /books/search when typing a keyword', async () => {
    const services = await makeServices();
    const { LM_TOKEN_KEYS } = require('../../../core/remote/lmTokens');
    const SecureStore = require('expo-secure-store');
    await SecureStore.setItemAsync(LM_TOKEN_KEYS.access, 'tok');
    await SecureStore.setItemAsync(LM_TOKEN_KEYS.refresh, 'rt');
    await SecureStore.setItemAsync(LM_TOKEN_KEYS.expiresAt, String(Date.now() + 3600_000));
    const fetchMock = jest.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.endsWith('/api/v1/mobile/spaces')) {
        return new Response(JSON.stringify([{ id: 's1', name: 'Perso', role: 'owner' }]), { status: 200 });
      }
      if (u.includes('/books/search?')) {
        return new Response(JSON.stringify({
          items: [{ id: 'rb9', title: 'Verne', author: 'Jules Verne', series: null, seriesIndex: null, updatedAt: 1 }],
          nextCursor: null,
          total: null,
        }), { status: 200 });
      }
      if (u.includes('/api/v1/mobile/spaces/s1/books?')) {
        return new Response(JSON.stringify({ items: [], nextCursor: null, total: 0 }), { status: 200 });
      }
      return new Response('nope', { status: 404 });
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);
    try {
      await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
      fireEvent.press(await screen.findByLabelText('library-manager.com'));
      fireEvent.press(await screen.findByText('Perso'));
      await screen.findByText('Aucun livre à afficher');
      fireEvent.changeText(await screen.findByPlaceholderText('Rechercher sur le serveur…'), 'verne');
      // debounced: the search route is queried with the encoded keyword
      expect(await screen.findByText('Verne')).toBeOnTheScreen();
      await waitFor(() => {
        expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/books/search?') && String(u).includes('q=verne'))).toBe(true);
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('offers server upload in the long-press menu when signed in and the format is supported', async () => {
    const services = await makeServices();
    await services.books.createBook({ title: 'LocalOnly', author: null, format: 'epub', originalFormat: null, fileName: 'l.epub', fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    const { LM_TOKEN_KEYS } = require('../../../core/remote/lmTokens');
    const SecureStore = require('expo-secure-store');
    await SecureStore.setItemAsync(LM_TOKEN_KEYS.access, 'tok');
    await SecureStore.setItemAsync(LM_TOKEN_KEYS.refresh, 'rt');
    await SecureStore.setItemAsync(LM_TOKEN_KEYS.expiresAt, String(Date.now() + 3600_000));
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    fireEvent(await screen.findByText('LocalOnly'), 'longPress');
    expect(await screen.findByText('Envoyer vers library-manager.com')).toBeOnTheScreen();
  });

  it('hides the server upload action when not signed in', async () => {
    const services = await makeServices();
    await services.books.createBook({ title: 'LocalOnly', author: null, format: 'epub', originalFormat: null, fileName: 'l.epub', fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    fireEvent(await screen.findByText('LocalOnly'), 'longPress');
    expect(await screen.findByText('Ouvrir')).toBeOnTheScreen();
    expect(screen.queryByText('Envoyer vers library-manager.com')).toBeNull();
  });

  it('deletes via long-press menu, keeping files so the trash can restore', async () => {
    const services = await makeServices();
    const remove = jest.fn(async (_p: string) => {});
    services.fs.remove = remove;
    const b = await services.books.createBook({ title: 'Dune', author: 'F. Herbert', format: 'epub', originalFormat: null, fileName: 'd.epub', fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    expect(await screen.findByText('Dune')).toBeOnTheScreen();
    fireEvent(await screen.findByText('Dune'), 'longPress');
    fireEvent.press(await screen.findByText('Supprimer'));
    fireEvent.press(await screen.findByText('Confirmer'));
    await waitFor(async () => {
      expect(screen.queryByText('Dune')).toBeNull();
      expect((await services.books.listDeleted()).map((x: { id: string }) => x.id)).toEqual([b.id]);
    });
    // tombstone only: files survive until a trash purge
    expect(remove).not.toHaveBeenCalled();
  });

  it('sorts by series with tome order and keeps series-less books last', async () => {
    const services = await makeServices();
    const mk = (title: string, series: string | null, index: number | null, addedAt: number) =>
      services.books.createBook({ title, author: null, format: 'epub', originalFormat: null, fileName: `${title}.epub`, fileSize: 1, language: null, publisher: null, series, seriesIndex: index, drmIdentifier: null, addedAt, updatedAt: addedAt, deletedAt: null, lastReadAt: null });
    await mk('Tome 2', 'Fondation', 2, 1);
    await mk('Tome 1', 'Fondation', 1, 2);
    await mk('Standalone', null, null, 3);
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    // default sort is 'recent': newest addedAt first
    expect(gridTitles()).toEqual(['Standalone', 'Tome 1', 'Tome 2']);
    fireEvent.press(await screen.findByText('Série'));
    await waitFor(() => expect(gridTitles()).toEqual(['Tome 1', 'Tome 2', 'Standalone']));
  });

  it('filters the grid from the series sheet and toggles the filter off there', async () => {
    const services = await makeServices();
    const mk = (title: string, series: string | null, index: number | null) =>
      services.books.createBook({ title, author: null, format: 'epub', originalFormat: null, fileName: `${title}.epub`, fileSize: 1, language: null, publisher: null, series, seriesIndex: index, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    await mk('Fondation T1', 'Fondation', 1);
    await mk('Fondation T2', 'Fondation', 2);
    await mk('Dune', 'Dune', 1);
    await mk('Standalone', null, null);
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    expect(await screen.findByText('Dune')).toBeOnTheScreen();
    // the chips row is gone: series selection lives only in the sheet
    expect(screen.queryByText('Dune (1)')).toBeNull();
    expect(screen.queryByText('Fondation (2)')).toBeNull();
    fireEvent.press(await screen.findByLabelText('Séries'));
    const sheet = within(await screen.findByTestId('series-sheet'));
    // every detected series is listed with its tome count
    expect(sheet.getByText('Fondation')).toBeOnTheScreen();
    expect(sheet.getByText('Dune')).toBeOnTheScreen();
    await fireEvent.press(sheet.getByText('Dune'));
    // picking a series closes the sheet and filters the grid
    await waitFor(() => expect(screen.queryByTestId('series-sheet')).toBeNull());
    expect(await screen.findByText('Dune')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Fondation T1')).toBeNull());
    expect(screen.queryByText('Standalone')).toBeNull();
    // tapping the filtered series again clears the filter
    fireEvent.press(await screen.findByLabelText('Séries'));
    await fireEvent.press(await within(await screen.findByTestId('series-sheet')).getByText('Dune'));
    await waitFor(() => expect(screen.queryByTestId('series-sheet')).toBeNull());
    expect(await screen.findByText('Fondation T1')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByText('Standalone')).toBeOnTheScreen());
  });

  it('shows the empty hint in the series sheet when no series exists', async () => {
    const services = await makeServices();
    await services.books.createBook({ title: 'Standalone', author: null, format: 'epub', originalFormat: null, fileName: 's.epub', fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    fireEvent.press(await screen.findByLabelText('Séries'));
    expect(await screen.findByText('Aucune série détectée')).toBeOnTheScreen();
  });

  it('deletes several books through selection mode, tombstones only', async () => {
    const services = await makeServices();
    const remove = jest.fn(async (_p: string) => {});
    services.fs.remove = remove;
    const mk = (title: string) =>
      services.books.createBook({ title, author: null, format: 'epub', originalFormat: null, fileName: `${title}.epub`, fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    const a = await mk('Aaa');
    const b = await mk('Bbb');
    const c = await mk('Ccc');
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    // enter selection from the long-press menu
    fireEvent(await screen.findByText('Aaa'), 'longPress');
    fireEvent.press(await screen.findByText('Sélectionner'));
    // taps toggle membership
    fireEvent.press(await screen.findByText('Bbb'));
    fireEvent.press(await screen.findByText('Ccc'));
    fireEvent.press(await screen.findByText('3 sélectionné(s)'));
    fireEvent.press(await screen.findByLabelText('Supprimer (3)'));
    fireEvent.press(await screen.findByText('Confirmer'));
    await waitFor(async () => {
      const deleted = await services.books.listDeleted();
      expect(deleted.map((x: { id: string }) => x.id).sort()).toEqual([a.id, b.id, c.id].sort());
      expect(screen.queryByText('Aaa')).toBeNull();
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it('exits selection without deleting via the cancel control', async () => {
    const services = await makeServices();
    await services.books.createBook({ title: 'Aaa', author: null, format: 'epub', originalFormat: null, fileName: 'a.epub', fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    fireEvent(await screen.findByText('Aaa'), 'longPress');
    fireEvent.press(await screen.findByText('Sélectionner'));
    fireEvent.press(await screen.findByLabelText('Quitter la sélection'));
    expect(await screen.findByText('Aaa')).toBeOnTheScreen();
    expect(screen.queryByText(/sélectionné/)).toBeNull();
  });

  it('edits metadata from the long-press menu with series autocomplete', async () => {
    const services = await makeServices();
    const mk = (title: string, series: string | null, index: number | null) =>
      services.books.createBook({ title, author: null, format: 'epub', originalFormat: null, fileName: `${title}.epub`, fileSize: 1, language: null, publisher: null, series, seriesIndex: index, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    const dune = await mk('Dune', null, null);
    await mk('Fondation T1', 'Fondation', 1);
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    fireEvent(await screen.findByText('Dune'), 'longPress');
    fireEvent.press(await screen.findByText('Modifier'));
    const sheet = within(await screen.findByTestId('metadata-edit-sheet'));
    expect(sheet.getByDisplayValue('Dune')).toBeOnTheScreen();
    // case-insensitive suggestion from the existing series, tap fills the input
    await fireEvent.changeText(sheet.getByLabelText('Série'), 'fond');
    await fireEvent.press(await sheet.findByText('Fondation'));
    await fireEvent.press(sheet.getByText('Enregistrer'));
    await waitFor(async () => {
      expect(await services.books.getBook(dune.id)).toMatchObject({ series: 'Fondation' });
    });
    expect(screen.queryByTestId('metadata-edit-sheet')).toBeNull();
  });

  it('surfaces a pre-import crash (headless engine) in the results sheet with its detail', async () => {
    const services = await makeServices();
    mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x/Book.epub' }] });
    mockGetEngine.mockImplementation(() => { throw new Error('headless engine not initialised'); });
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    fireEvent.press(await screen.findByText('Ajouter des livres'));
    expect(await screen.findByText('Import terminé')).toBeOnTheScreen();
    expect(await screen.findByText(/headless engine not initialised/)).toBeOnTheScreen();
  });

  it('shows the underlying io error detail next to the failed file', async () => {
    const services = await makeServices();
    services.fs.copy = async () => { throw new Error('EIO: copy failed'); };
    mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x/Book.epub' }] });
    mockGetEngine.mockReturnValue({ extract: jest.fn() });
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    fireEvent.press(await screen.findByText('Ajouter des livres'));
    expect(await screen.findByText('Import terminé')).toBeOnTheScreen();
    expect(await screen.findByText(/EIO: copy failed/)).toBeOnTheScreen();
  });

  it('shows per-file progress while a multi-file import runs', async () => {
    const services = await makeServices();
    const gates = [deferred(), deferred()];
    let call = 0;
    mockGetEngine.mockReturnValue({
      extract: () => (call < gates.length ? gates[call++]!.promise : Promise.reject(new Error('no gate'))),
    });
    mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x/A.epub' }, { uri: 'file:///x/B.epub' }] });
    await render(<ServicesProvider value={services}><><LibraryScreen /><DialogHost /></></ServicesProvider>);
    fireEvent.press(await screen.findByText('Ajouter des livres'));
    // nothing reported yet: neither file finished
    expect(screen.queryByText('Importation 1/2…')).not.toBeOnTheScreen();
    gates[0]!.resolve({ metadata: { title: 'A', author: null, language: 'en', publisher: null, identifier: 'urn:isbn:1' }, coverJpegBase64: null, cbzBase64: null });
    expect(await screen.findByText('Importation 1/2…')).toBeOnTheScreen();
    gates[1]!.resolve({ metadata: { title: 'B', author: null, language: 'en', publisher: null, identifier: 'urn:isbn:2' }, coverJpegBase64: null, cbzBase64: null });
    expect(await screen.findByText('Import terminé')).toBeOnTheScreen();
    expect(screen.queryByText('Importation 1/2…')).not.toBeOnTheScreen();
  });
});

// extraction gates: the test holds the second file's extraction open so the
// 1/2 banner state is observable deterministically
function deferred() {
  let resolve!: (v: unknown) => void;
  const promise = new Promise<unknown>((r) => { resolve = r; });
  return { promise, resolve };
}

// grid order = document order of the unique book-title texts
function gridTitles(): string[] {
  return screen
    .getAllByText(/^(Tome 1|Tome 2|Standalone|Fondation T1|Fondation T2|Dune)$/)
    .map((el) => String(el.props.children));
}
