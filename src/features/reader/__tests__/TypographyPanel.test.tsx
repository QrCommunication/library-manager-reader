import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { TypographyPanel } from '../TypographyPanel';
import { initI18n } from '../../../i18n';
import type { ReaderSettings } from '../../../core/types';

const BASE_SETTINGS: ReaderSettings = {
  fontFamily: 'serif', fontSize: 18, lineHeight: 1.6, margin: 20, theme: 'day', ttsRate: 1, brightness: 0,
};

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

  it('emits brightness updates within the 0-70 range', async () => {
    const onSettingsChange = jest.fn();
    // controlled component: the harness mirrors emitted settings back into props
    // so repeated presses climb from 0 to the 70 bound like on a real screen
    function Harness() {
      const [settings, setSettings] = useState<ReaderSettings>(BASE_SETTINGS);
      return (
        <TypographyPanel
          settings={settings}
          onSettingsChange={(next) => { onSettingsChange(next); setSettings(next); }}
        />
      );
    }
    await render(<Harness />);
    const plus = screen.getByLabelText('brightness+');
    for (let press = 0; press < 14; press += 1) {
      await fireEvent.press(plus); // step 5: 0 → 70
    }
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ brightness: 70 }));
    // bounded at 70: the + button is disabled and further presses are ignored
    expect(plus).toBeDisabled();
    await fireEvent.press(plus);
    expect(onSettingsChange).toHaveBeenCalledTimes(14);
    expect(onSettingsChange).toHaveBeenLastCalledWith(expect.objectContaining({ brightness: 70 }));
  });

  it('offers the auto theme segment', async () => {
    const onSettingsChange = jest.fn();
    await render(
      <TypographyPanel settings={BASE_SETTINGS} onSettingsChange={onSettingsChange} />,
    );
    await fireEvent.press(screen.getByText('Auto'));
    expect(onSettingsChange).toHaveBeenCalledWith(expect.objectContaining({ theme: 'auto' }));
  });
});
