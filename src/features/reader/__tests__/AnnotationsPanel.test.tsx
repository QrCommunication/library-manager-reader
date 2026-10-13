import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { DatabaseSync } from 'node:sqlite';
import { AnnotationsPanel } from '../AnnotationsPanel';
import { createServices, ServicesProvider } from '../../../core/services';
import { createNodeSqliteDriver } from '../../../db/nodeSqliteDriver';
import { migrate } from '../../../db/migrate';
import { initI18n } from '../../../i18n';

const makeServices = async () => {
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  const services = createServices({ db, fs: fakeFs(), root: '/doc', newId: (() => { let i = 0; return () => `id-${++i}`; })() });
  // seed the book row: annotations.book_id has a foreign key on books.id
  await services.books.createBook({ id: 'b1', title: 'T', author: null, format: 'epub', originalFormat: null, fileName: 't.epub', fileSize: 1, language: null, publisher: null, series: null, seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null });
  await services.annotations.add({ id: 'a-1', bookId: 'b1', cfi: 'cfi-1', color: 'yellow', note: null, excerpt: 'Extrait de test', createdAt: 1 });
  return services;
};

const fakeFs = () => ({
  freeDiskBytes: async () => 1e9, ensureDir: async () => {}, copy: async () => {}, exists: async () => true,
  remove: async () => {}, fileSize: async () => 100, writeBase64: async () => {}, readBase64Chunks: async () => {},
  directorySize: async () => 0,
});

describe('AnnotationsPanel', () => {
  beforeAll(async () => {
    await initI18n('fr');
  });

  it('lists seeded annotations and deletes via the remove action', async () => {
    const services = await makeServices();
    const addHighlight = jest.fn();
    const removeHighlight = jest.fn();
    await render(
      <ServicesProvider value={services}>
        <AnnotationsPanel bookId="b1" bridge={{ addHighlight, removeHighlight } as never} onNavigate={() => {}} />
      </ServicesProvider>,
    );
    expect(await screen.findByText(/Extrait de test/)).toBeOnTheScreen();
    await fireEvent.press(await screen.findByLabelText('Supprimer le surlignage'));
    expect(await screen.findByText('Aucun surlignage')).toBeOnTheScreen();
    expect(removeHighlight).toHaveBeenCalledWith('a-1');
  });

  it('saves a note via setNote', async () => {
    const services = await makeServices();
    await render(
      <ServicesProvider value={services}>
        <AnnotationsPanel bookId="b1" bridge={{ addHighlight: jest.fn(), removeHighlight: jest.fn() } as never} onNavigate={() => {}} />
      </ServicesProvider>,
    );
    // the note glyph (label `annotations.note`) opens the inline editor; the
    // excerpt itself stays a navigate target
    await fireEvent.press(await screen.findByLabelText('Note'));
    await fireEvent.changeText(screen.getByPlaceholderText('Ajouter une note…'), 'Ma note');
    await fireEvent.press(screen.getByText('Enregistrer'));
    expect(await screen.findByText('Ma note')).toBeOnTheScreen();
  });
});
