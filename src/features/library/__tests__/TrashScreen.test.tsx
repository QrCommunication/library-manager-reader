import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { TrashScreen } from '../TrashScreen';
import { ServicesProvider } from '../../../core/services';
import { initI18n } from '../../../i18n';

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));

jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
  (buttons?.find((b) => b.text === 'Confirmer') as { onPress?: () => void } | undefined)?.onPress?.();
});

const DAY = 24 * 60 * 60 * 1000;

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

const deletedBook = async (services: Awaited<ReturnType<typeof makeServices>>, title: string, deletedAt: number) => {
  const b = await services.books.createBook({ title, author: null, format: 'epub', originalFormat: null, fileName: `${title}.epub`, fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
  await services.books.markDeleted(b.id, deletedAt);
  return b;
};

describe('TrashScreen', () => {
  beforeAll(async () => {
    await initI18n('fr');
  });

  it('lists tombstoned books with days left and restores them to the library', async () => {
    const services = await makeServices();
    const b = await deletedBook(services, 'Dune', Date.now());
    await render(<ServicesProvider value={services}><TrashScreen /></ServicesProvider>);
    expect(await screen.findByText('Dune')).toBeOnTheScreen();
    expect(screen.getByText('Encore 30 j')).toBeOnTheScreen();
    fireEvent.press(screen.getByLabelText('Restaurer'));
    await waitFor(() => expect(screen.queryByText('Dune')).toBeNull());
    expect(await services.books.getBook(b.id)).toMatchObject({ deletedAt: null });
  });

  it('purges one book permanently, removing its file and cover', async () => {
    const services = await makeServices();
    const remove = jest.fn(async (_p: string) => {});
    services.fs.remove = remove;
    const b = await deletedBook(services, 'Dune', Date.now());
    await render(<ServicesProvider value={services}><TrashScreen /></ServicesProvider>);
    fireEvent.press(await screen.findByLabelText('Supprimer définitivement'));
    await waitFor(() => expect(screen.queryByText('Dune')).toBeNull());
    expect(await services.books.getBook(b.id)).toBeNull();
    expect(remove).toHaveBeenCalledWith(services.paths.bookPath(b.id, 'epub'));
    expect(remove).toHaveBeenCalledWith(services.paths.coverPath(b.id));
  });

  it('empties the trash, purging every tombstone and its files', async () => {
    const services = await makeServices();
    const remove = jest.fn(async (_p: string) => {});
    services.fs.remove = remove;
    const a = await deletedBook(services, 'Aaa', Date.now());
    const b = await deletedBook(services, 'Bbb', Date.now());
    await render(<ServicesProvider value={services}><TrashScreen /></ServicesProvider>);
    fireEvent.press(await screen.findByText('Vider la corbeille'));
    await waitFor(async () => {
      expect(await services.books.getBook(a.id)).toBeNull();
      expect(await services.books.getBook(b.id)).toBeNull();
    });
    expect(remove).toHaveBeenCalledWith(services.paths.bookPath(a.id, 'epub'));
    expect(remove).toHaveBeenCalledWith(services.paths.bookPath(b.id, 'epub'));
  });

  it('auto-purges tombstones older than 30 days on open', async () => {
    const services = await makeServices();
    const remove = jest.fn(async (_p: string) => {});
    services.fs.remove = remove;
    const b = await deletedBook(services, 'Old', Date.now() - 31 * DAY);
    await render(<ServicesProvider value={services}><TrashScreen /></ServicesProvider>);
    await waitFor(async () => expect(await services.books.getBook(b.id)).toBeNull());
    expect(remove).toHaveBeenCalledWith(services.paths.bookPath(b.id, 'epub'));
  });

  it('shows the empty state when nothing is deleted', async () => {
    const services = await makeServices();
    await render(<ServicesProvider value={services}><TrashScreen /></ServicesProvider>);
    expect(await screen.findByText('La corbeille est vide')).toBeOnTheScreen();
  });
});
