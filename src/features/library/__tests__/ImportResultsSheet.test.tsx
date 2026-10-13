import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { ImportResultsSheet } from '../ImportResultsSheet';
import { initI18n } from '../../../i18n';

describe('ImportResultsSheet', () => {
  beforeAll(async () => {
    await initI18n('fr');
  });

  it('renders duplicate imports with the informational wording, not a failure label', async () => {
    await render(
      <ImportResultsSheet
        outcomes={[{ uri: 'file:///x/Book.epub', ok: false, reason: 'duplicate', detail: 'Dune' }]}
        onClose={() => {}}
      />,
    );
    expect(await screen.findByText(/Déjà dans la bibliothèque/)).toBeOnTheScreen();
    expect(await screen.findByText(/Book\.epub/)).toBeOnTheScreen();
    expect(screen.queryByText(/Impossible de lire ce fichier/)).toBeNull();
  });
});
