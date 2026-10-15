import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react-native';
import { SeriesSelect } from '../SeriesSelect';
import { initI18n } from '../../../i18n';

beforeAll(async () => {
  await initI18n('fr');
});

describe('SeriesSelect — server-fed autocomplete', () => {
  it('opens the dropdown and lists the series returned by loadOptions', async () => {
    const loadOptions = jest.fn(async () => ['La Ballade de Pern', 'Fondation']);
    await render(<SeriesSelect value={null} onChange={jest.fn()} loadOptions={loadOptions} />);
    fireEvent.press(screen.getByLabelText('Filtrer par série'));
    expect(await screen.findByText('La Ballade de Pern')).toBeOnTheScreen();
    expect(screen.getByText('Fondation')).toBeOnTheScreen();
    // the initial prefix is the empty string
    expect(loadOptions).toHaveBeenCalledWith('');
  });

  it('re-queries with the typed prefix (debounced) and picks a series', async () => {
    const onChange = jest.fn();
    const loadOptions = jest.fn(async (prefix: string) =>
      prefix.toLowerCase().startsWith('fon') ? ['Fondation'] : ['La Ballade de Pern', 'Fondation']);
    await render(<SeriesSelect value={null} onChange={onChange} loadOptions={loadOptions} />);
    fireEvent.press(screen.getByLabelText('Filtrer par série'));
    fireEvent.changeText(await screen.findByPlaceholderText('Filtrer les séries…'), 'fon');
    await waitFor(() => expect(loadOptions).toHaveBeenCalledWith('fon'));
    // stale responses for 'fon' show only the matching series list
    fireEvent.press(await screen.findByText('Fondation'));
    expect(onChange).toHaveBeenCalledWith('Fondation');
  });

  it("'Toutes les séries' clears the filter", async () => {
    const onChange = jest.fn();
    await render(<SeriesSelect value="Fondation" onChange={onChange} loadOptions={jest.fn(async () => ['Fondation'])} />);
    fireEvent.press(screen.getByLabelText('Filtrer par série'));
    fireEvent.press(await screen.findByText('Toutes les séries'));
    expect(onChange).toHaveBeenCalledWith(null);
  });
});
