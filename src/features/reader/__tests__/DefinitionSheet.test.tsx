import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { ServicesProvider } from '../../../core/services';
import { DefinitionSheet } from '../DefinitionSheet';
import { LookupError } from '../../../core/lookup/lookupService';
import { initI18n } from '../../../i18n';

const baseServices = (lookup: unknown) => ({
  settings: { getReaderSettings: async () => ({ fontFamily: 'serif', fontSize: 18, lineHeight: 1.6, margin: 20, theme: 'day', ttsRate: 1, brightness: 0 }), putReaderSettings: async () => {}, getUiPrefs: async () => ({ language: 'fr', defaultTheme: 'day', libreTranslateUrl: 'https://x', libreTranslateApiKey: '' }), putUiPrefs: async () => {} },
  lookup,
}) as never;

describe('DefinitionSheet', () => {
  beforeAll(async () => { await initI18n('fr'); });

  it('lists definitions and switches to translation from the footer', async () => {
    const lookup = {
      define: jest.fn(async () => [{ pos: 'nom', glosses: ['Un objet imprimé'] }]),
      translate: jest.fn(async () => 'libro'),
    };
    await render(
      <ServicesProvider value={baseServices(lookup)}>
        <DefinitionSheet word="book" lang="en" initialMode="define" onClose={() => {}} />
      </ServicesProvider>,
    );
    expect(await screen.findByText('Un objet imprimé')).toBeOnTheScreen();
    // v14: fireEvent is async + act-wrapped; await it, then flush the translate
    // promise inside its own act scope so the state update stays act-wrapped.
    await fireEvent.press(screen.getByText('Traduire'));
    await act(async () => {});
    expect(await screen.findByText('libro')).toBeOnTheScreen();
    expect(lookup.translate).toHaveBeenCalledWith('book', 'en', 'fr');
  });

  it('renders the offline error state', async () => {
    const lookup = { define: jest.fn(async () => { throw new LookupError('offline'); }), translate: jest.fn() };
    await render(
      <ServicesProvider value={baseServices(lookup)}>
        <DefinitionSheet word="book" lang="en" initialMode="define" onClose={() => {}} />
      </ServicesProvider>,
    );
    expect(await screen.findByText('Recherche en ligne indisponible (hors connexion)')).toBeOnTheScreen();
  });
});
