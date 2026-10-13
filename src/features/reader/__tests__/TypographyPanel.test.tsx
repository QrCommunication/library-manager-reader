import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { TypographyPanel } from '../TypographyPanel';
import { initI18n } from '../../../i18n';

describe('TypographyPanel', () => {
  beforeAll(async () => {
    await initI18n('fr');
  });

  it('emits updated settings on theme change', async () => {
    const onSettingsChange = jest.fn();
    await render(
      <TypographyPanel
        settings={{ fontFamily: 'serif', fontSize: 18, lineHeight: 1.6, margin: 20, theme: 'day', ttsRate: 1, brightness: 0 }}
        onSettingsChange={onSettingsChange}
      />,
    );
    fireEvent.press(screen.getByText('Nuit'));
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ theme: 'night' }));
  });
});
