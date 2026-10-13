import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { BookmarksPanel } from '../BookmarksPanel';
import { ServicesProvider } from '../../../core/services';
import { initI18n } from '../../../i18n';

const bridge = { captureBookmark: async () => ({ target: 'cfi-new', fraction: 0.5, excerpt: 'Extrait de page' }) };

const makeServices = async () => {
  const { DatabaseSync } = require('node:sqlite');
  const { createNodeSqliteDriver } = require('../../../db/nodeSqliteDriver');
  const { migrate } = require('../../../db/migrate');
  const { createServices } = require('../../../core/services');
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  const services = createServices({ db, fs: fakeFs(), root: '/doc', newId: (() => { let i = 0; return () => `id-${++i}`; })() });
  // seed the book row: bookmarks.book_id has a foreign key on books.id
  await services.books.createBook({ id: 'b1', title: 'T', author: null, format: 'epub', originalFormat: null, fileName: 't.epub', fileSize: 1, language: null, publisher: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
  return services;
};

const fakeFs = () => ({
  freeDiskBytes: async () => 1e9, ensureDir: async () => {}, copy: async () => {}, exists: async () => true,
  remove: async () => {}, fileSize: async () => 100, writeBase64: async () => {}, readBase64Chunks: async () => {},
  directorySize: async () => 0,
});

describe('BookmarksPanel', () => {
  beforeAll(async () => {
    await initI18n('fr');
  });

  it('adds a bookmark through the bridge and lists it', async () => {
    const services = await makeServices();
    await render(
      <ServicesProvider value={services}>
        <BookmarksPanel bookId="b1" bridge={bridge as never} onNavigate={() => {}} />
      </ServicesProvider>,
    );
    fireEvent.press(await screen.findByText('Ajouter un signet'));
    expect(await screen.findByText(/Extrait de page/)).toBeOnTheScreen();
  });
});
