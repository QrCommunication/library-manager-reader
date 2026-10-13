import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react-native';
import { MetadataEditSheet } from '../MetadataEditSheet';
import { ServicesProvider } from '../../../core/services';
import { initI18n } from '../../../i18n';

const makeServices = async () => {
  const { DatabaseSync } = require('node:sqlite');
  const { createNodeSqliteDriver } = require('../../../db/nodeSqliteDriver');
  const { migrate } = require('../../../db/migrate');
  const { createServices } = require('../../../core/services');
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  return createServices({ db, fs: {}, root: '/doc', newId: (() => { let i = 0; return () => `id-${++i}`; })() });
};

const book = {
  id: 'b1', title: 'Dune', author: null, format: 'epub' as const, originalFormat: null,
  fileName: 'd.epub', fileSize: 1, language: null, publisher: null, series: null,
  seriesIndex: null, drmIdentifier: null, addedAt: 1, updatedAt: 1, deletedAt: null, lastReadAt: null,
};

describe('MetadataEditSheet', () => {
  beforeAll(async () => {
    await initI18n('fr');
  });

  it('fills the series input from an autocomplete chip press', async () => {
    const services = await makeServices();
    await services.books.createBook({ ...book, title: 'Fondation T1', series: 'Fondation', seriesIndex: 1 });
    await render(
      <ServicesProvider value={services}>
        <MetadataEditSheet book={book} onClose={() => {}} onSaved={() => {}} />
      </ServicesProvider>,
    );
    const sheet = within(await screen.findByTestId('metadata-edit-sheet'));
    await fireEvent.changeText(sheet.getByLabelText('Série'), 'fond');
    await fireEvent.press(await sheet.findByText('Fondation'));
    expect(sheet.getByLabelText('Série').props.value).toBe('Fondation');
  });

  it('saves trimmed fields, nulling empty ones and parsing the tome', async () => {
    const services = await makeServices();
    const updateMetadata = jest.fn(async () => {});
    services.books.updateMetadata = updateMetadata;
    const onSaved = jest.fn();
    await render(
      <ServicesProvider value={services}>
        <MetadataEditSheet book={{ ...book, author: '  A. Auteur ', series: 'X', seriesIndex: 2 }} onClose={() => {}} onSaved={onSaved} />
      </ServicesProvider>,
    );
    const sheet = within(await screen.findByTestId('metadata-edit-sheet'));
    await fireEvent.changeText(sheet.getByLabelText('Titre'), '  Nouveau titre  ');
    await fireEvent.changeText(sheet.getByLabelText('Auteur'), '   ');
    await fireEvent.changeText(sheet.getByLabelText('Série'), '');
    await fireEvent.changeText(sheet.getByLabelText('Tome'), '3,5');
    await fireEvent.press(sheet.getByText('Enregistrer'));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(updateMetadata).toHaveBeenCalledWith('b1', {
      title: 'Nouveau titre', author: null, series: null, seriesIndex: 3.5,
    });
  });

  it('lists several series suggestions case-insensitively and disables save on an empty title', async () => {
    const services = await makeServices();
    await services.books.createBook({ ...book, id: 'b2', title: 'T1', series: 'Fondation', seriesIndex: 1 });
    await services.books.createBook({ ...book, id: 'b3', title: 'T2', series: 'fondation et empire', seriesIndex: 2 });
    await render(
      <ServicesProvider value={services}>
        <MetadataEditSheet book={book} onClose={() => {}} onSaved={() => {}} />
      </ServicesProvider>,
    );
    const sheet = within(await screen.findByTestId('metadata-edit-sheet'));
    await fireEvent.changeText(sheet.getByLabelText('Titre'), '   ');
    const save = sheet.getByLabelText('Enregistrer');
    expect(save.props.accessibilityState?.disabled).toBe(true);
    await fireEvent.changeText(sheet.getByLabelText('Titre'), 'Dune');
    await fireEvent.changeText(sheet.getByLabelText('Série'), 'FOND');
    expect(await sheet.findByText('Fondation')).toBeOnTheScreen();
    expect(sheet.getByText('fondation et empire')).toBeOnTheScreen();
  });
});
