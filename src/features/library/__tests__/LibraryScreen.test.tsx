import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
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

  it('deletes via long-press menu, keeping files so the trash can restore', async () => {
    const services = await makeServices();
    const remove = jest.fn(async (_p: string) => {});
    services.fs.remove = remove;
    const b = await services.books.createBook({ title: 'Dune', author: 'F. Herbert', format: 'epub', originalFormat: null, fileName: 'd.epub', fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
    expect(await screen.findByText('Dune')).toBeOnTheScreen();
    fireEvent(await screen.findByText('Dune'), 'longPress');
    fireEvent.press(await screen.findByText('Supprimer'));
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
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
    // default sort is 'recent': newest addedAt first
    expect(gridTitles()).toEqual(['Standalone', 'Tome 1', 'Tome 2']);
    fireEvent.press(await screen.findByText('Série'));
    await waitFor(() => expect(gridTitles()).toEqual(['Tome 1', 'Tome 2', 'Standalone']));
  });

  it('filters the grid through the series chips and toggles back', async () => {
    const services = await makeServices();
    const mk = (title: string, series: string | null, index: number | null) =>
      services.books.createBook({ title, author: null, format: 'epub', originalFormat: null, fileName: `${title}.epub`, fileSize: 1, language: null, publisher: null, series, seriesIndex: index, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    await mk('Fondation T1', 'Fondation', 1);
    await mk('Fondation T2', 'Fondation', 2);
    await mk('Dune', 'Dune', 1);
    await mk('Standalone', null, null);
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
    expect(await screen.findByText('Dune')).toBeOnTheScreen();
    // chip labels carry a count ("Fondation (2)"), distinct from book titles
    fireEvent.press(screen.getByText('Fondation (2)'));
    expect(await screen.findByText('Fondation T1')).toBeOnTheScreen();
    expect(screen.getByText('Fondation T2')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Dune')).toBeNull());
    expect(screen.queryByText('Standalone')).toBeNull();
    fireEvent.press(screen.getByText('Fondation (2)'));
    expect(await screen.findByText('Dune')).toBeOnTheScreen();
    await waitFor(() => expect(screen.getByText('Standalone')).toBeOnTheScreen());
  });

  it('lists detected series in a sheet and filters the grid from it', async () => {
    const services = await makeServices();
    const mk = (title: string, series: string | null, index: number | null) =>
      services.books.createBook({ title, author: null, format: 'epub', originalFormat: null, fileName: `${title}.epub`, fileSize: 1, language: null, publisher: null, series, seriesIndex: index, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    await mk('Fondation T1', 'Fondation', 1);
    await mk('Fondation T2', 'Fondation', 2);
    await mk('Dune', 'Dune', 1);
    await mk('Standalone', null, null);
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
    fireEvent.press(await screen.findByLabelText('Séries'));
    const sheet = within(await screen.findByTestId('series-sheet'));
    // every detected series is listed with its tome count
    expect(sheet.getByText('Fondation')).toBeOnTheScreen();
    expect(sheet.getByText('Dune')).toBeOnTheScreen();
    fireEvent.press(sheet.getByText('Dune'));
    // picking a series closes the sheet and filters the grid
    await waitFor(() => expect(screen.queryByTestId('series-sheet')).toBeNull());
    expect(await screen.findByText('Dune')).toBeOnTheScreen();
    await waitFor(() => expect(screen.queryByText('Fondation T1')).toBeNull());
    fireEvent.press(screen.getByText('Dune (1)')); // chip clears the filter
    expect(await screen.findByText('Fondation T1')).toBeOnTheScreen();
  });

  it('shows the empty hint in the series sheet when no series exists', async () => {
    const services = await makeServices();
    await services.books.createBook({ title: 'Standalone', author: null, format: 'epub', originalFormat: null, fileName: 's.epub', fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
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
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
    // enter selection from the long-press menu
    fireEvent(await screen.findByText('Aaa'), 'longPress');
    fireEvent.press(await screen.findByText('Sélectionner'));
    // taps toggle membership
    fireEvent.press(await screen.findByText('Bbb'));
    fireEvent.press(await screen.findByText('Ccc'));
    fireEvent.press(await screen.findByText('3 sélectionné(s)'));
    fireEvent.press(await screen.findByText('Supprimer (3)')); // Alert confirm auto-fires
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
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
    fireEvent(await screen.findByText('Aaa'), 'longPress');
    fireEvent.press(await screen.findByText('Sélectionner'));
    fireEvent.press(await screen.findByLabelText('Quitter la sélection'));
    expect(await screen.findByText('Aaa')).toBeOnTheScreen();
    expect(screen.queryByText(/sélectionné/)).toBeNull();
  });

  it('refreshes every book metadata from its stored file via the header action', async () => {
    const services = await makeServices();
    const created = await services.books.createBook({ title: 'Wrong', author: null, format: 'epub', originalFormat: null, fileName: 'w.epub', fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
    // every book ends up with a series, so the Open Library pass has nothing to fetch
    mockGetEngine.mockReturnValue({
      extract: async () => ({ metadata: { title: 'Right', author: 'Auth', language: 'fr', publisher: null, identifier: 'urn:isbn:9', series: 'Fondation', seriesIndex: 7 }, coverJpegBase64: null, cbzBase64: null }),
    });
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
    fireEvent.press(await screen.findByLabelText('Mettre à jour les métadonnées'));
    await waitFor(async () => {
      expect(await services.books.getBook(created.id)).toMatchObject({ title: 'Right', series: 'Fondation', seriesIndex: 7 });
    });
    expect(Alert.alert).toHaveBeenCalledWith('Métadonnées mises à jour', expect.stringMatching(/1 livre/));
    expect(mockGetEngine).toHaveBeenCalled();
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

  it('shows per-file progress while a multi-file import runs', async () => {
    const services = await makeServices();
    const gates = [deferred(), deferred()];
    let call = 0;
    mockGetEngine.mockReturnValue({
      extract: () => (call < gates.length ? gates[call++]!.promise : Promise.reject(new Error('no gate'))),
    });
    mockPicker.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///x/A.epub' }, { uri: 'file:///x/B.epub' }] });
    await render(<ServicesProvider value={services}><LibraryScreen /></ServicesProvider>);
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
