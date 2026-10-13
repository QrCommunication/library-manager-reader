import React from 'react';
import { act, render, screen, fireEvent } from '@testing-library/react-native';
import { SearchPanel, type SearchBridge } from '../SearchPanel';
import { initI18n } from '../../../i18n';

const makeBridge = () => {
  let cb: ((r: { cfi: string; excerpt: string; fraction: number }) => void) | null = null;
  return {
    search: jest.fn(),
    searchCancel: jest.fn(),
    goTo: jest.fn(),
    onSearchResult: jest.fn((f: typeof cb) => { cb = f; return () => { cb = null; }; }),
    onSearchDone: jest.fn(() => () => {}),
    emit: (r: { cfi: string; excerpt: string; fraction: number }) => cb?.(r),
  };
};

describe('SearchPanel', () => {
  beforeAll(async () => { await initI18n('fr'); });

  it('submits the query, lists results and navigates on tap', async () => {
    const bridge = makeBridge();
    const onNavigate = jest.fn();
    await render(<SearchPanel bridge={bridge as unknown as SearchBridge} onNavigate={onNavigate} />);
    await fireEvent.changeText(screen.getByPlaceholderText('Rechercher dans le livre…'), 'mot');
    await fireEvent(screen.getByPlaceholderText('Rechercher dans le livre…'), 'submitEditing');
    expect(bridge.search).toHaveBeenCalledWith('mot');
    await act(async () => { bridge.emit({ cfi: 'c1', excerpt: '…mot…', fraction: 0.4 }); });
    expect(screen.getByText(/…mot…/)).toBeOnTheScreen();
    // fraction as a rounded percent, footer count of the streamed results
    expect(screen.getByText('40 %')).toBeOnTheScreen();
    expect(screen.getByText('1 résultat(s)')).toBeOnTheScreen();
    await fireEvent.press(screen.getByText(/…mot…/));
    expect(onNavigate).toHaveBeenCalledWith('c1');
  });

  it('cancels the search on unmount', async () => {
    const bridge = makeBridge();
    const { unmount } = await render(<SearchPanel bridge={bridge as unknown as SearchBridge} onNavigate={() => {}} />);
    await unmount();
    expect(bridge.searchCancel).toHaveBeenCalled();
  });

  // Mandatory protocol ruling: the search stream carries no id, so stale
  // searchResult events from an abandoned search can arrive after a newer one
  // began (its searchDone is token-dropped engine-side). Reset-on-submit is the
  // defense: the previous list must be gone the moment a new query starts.
  it('clears the previous results when a new search is submitted', async () => {
    const bridge = makeBridge();
    await render(<SearchPanel bridge={bridge as unknown as SearchBridge} onNavigate={() => {}} />);
    const input = screen.getByPlaceholderText('Rechercher dans le livre…');
    await fireEvent.changeText(input, 'premier');
    await fireEvent(input, 'submitEditing');
    await act(async () => { bridge.emit({ cfi: 'old', excerpt: '…vieux…', fraction: 0.1 }); });
    expect(screen.getByText(/…vieux…/)).toBeOnTheScreen();
    await fireEvent.changeText(input, 'second');
    await fireEvent(input, 'submitEditing');
    expect(bridge.searchCancel).toHaveBeenCalled();
    expect(bridge.search).toHaveBeenLastCalledWith('second');
    expect(screen.queryByText(/…vieux…/)).toBeNull();
    expect(screen.queryByText('10 %')).toBeNull();
  });
});
