import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { SelectionPopover, type SelectionState } from '../SelectionPopover';
import { initI18n } from '../../../i18n';

const selection: SelectionState = { text: 'mot', rect: { x: 50, y: 300, width: 60, height: 24 }, cfi: 'cfi-1', lang: 'fr' };

describe('SelectionPopover', () => {
  beforeAll(async () => { await initI18n('fr'); });

  it('shows the selected text and fires the action callbacks', async () => {
    const onDefine = jest.fn(); const onTranslate = jest.fn(); const onCopy = jest.fn();
    await render(
      <SelectionPopover selection={selection} onDefine={onDefine} onTranslate={onTranslate} onCopy={onCopy} onDismiss={() => {}} />,
    );
    // v14: fireEvent is async + act-wrapped — await each press to keep act scopes clean
    await fireEvent.press(screen.getByText('Définir'));
    await fireEvent.press(screen.getByText('Traduire'));
    await fireEvent.press(screen.getByText('Copier'));
    expect(onDefine).toHaveBeenCalledTimes(1);
    expect(onTranslate).toHaveBeenCalledTimes(1);
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(screen.getByText('mot')).toBeOnTheScreen();
  });

  it('offers the Surligner action that requests highlight mode', async () => {
    const onHighlightPress = jest.fn();
    await render(
      <SelectionPopover
        selection={selection}
        onHighlightPress={onHighlightPress}
        onDefine={() => {}}
        onTranslate={() => {}}
        onCopy={() => {}}
        onDismiss={() => {}}
      />,
    );
    await fireEvent.press(screen.getByText('Surligner'));
    expect(onHighlightPress).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('highlight-yellow')).toBeNull();
  });

  it('exposes highlight colors when requested and emits the chosen color', async () => {
    const onHighlight = jest.fn();
    await render(
      <SelectionPopover
        selection={selection}
        onDefine={() => {}}
        onTranslate={() => {}}
        onCopy={() => {}}
        highlightMode
        onHighlight={onHighlight}
        onDismiss={() => {}}
      />,
    );
    // in color mode the three text actions give way to the four pastilles
    expect(screen.queryByText('Définir')).toBeNull();
    await fireEvent.press(screen.getByTestId('highlight-yellow'));
    expect(onHighlight).toHaveBeenCalledWith('yellow');
  });
});
