import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react-native';
import { TtsBar, type TtsBridge } from '../TtsBar';
import { initI18n } from '../../../i18n';

const makeBridge = () => {
  let cb: ((s: { text: string; cfi: string | null }) => void) | null = null;
  return {
    ttsStart: jest.fn(),
    ttsStop: jest.fn(),
    ttsNext: jest.fn(),
    goTo: jest.fn(),
    onTtsSentence: jest.fn((f: typeof cb) => { cb = f; return () => { cb = null; }; }),
    emit: (s: { text: string; cfi: string | null }) => cb?.(s),
  };
};
const speech = () => ({ speak: jest.fn(), stop: jest.fn(), pause: jest.fn(), resume: jest.fn(), speaking: async () => false });

type Props = React.ComponentProps<typeof TtsBar>;

describe('TtsBar', () => {
  beforeAll(async () => { await initI18n('fr'); });

  const setup = async (over?: Partial<Props>) => {
    const bridge = makeBridge();
    const sp = speech();
    const props: Props = {
      bridge: bridge as unknown as TtsBridge,
      speech: sp as never,
      rate: 1,
      onRateChange: () => {},
      bookLang: 'fr',
      currentCfi: () => 'c0',
      onStart: () => bridge.ttsStart('c0'),
      follow: false,
      onFollowChange: () => {},
    };
    const ui = (o?: Partial<Props>) => <TtsBar {...props} {...o} />;
    const view = await render(ui(over));
    return { bridge, sp, props, ui, view };
  };
  const onDoneOf = (sp: ReturnType<typeof speech>, index = 0) =>
    (sp.speak.mock.calls[index] as unknown as [string, { onDone: () => void }])[1].onDone;

  it('starts playback, speaks the sentence, chains ttsNext on done', async () => {
    const { bridge, sp } = await setup();
    await fireEvent.press(screen.getByLabelText('Lire à voix haute'));
    expect(bridge.ttsStart).toHaveBeenCalledWith('c0');
    await act(async () => { bridge.emit({ text: 'Phrase une.', cfi: 'c1' }); });
    expect(sp.speak).toHaveBeenCalledWith('Phrase une.', expect.objectContaining({ language: 'fr-FR', rate: 1 }));
    await act(async () => { onDoneOf(sp)(); });
    expect(bridge.ttsNext).toHaveBeenCalled();
  });

  it('treats an empty sentence as end of stream and stops', async () => {
    const { bridge, sp } = await setup();
    await act(async () => { bridge.emit({ text: '', cfi: null }); });
    expect(sp.stop).toHaveBeenCalled();
    expect(bridge.ttsStop).toHaveBeenCalled();
  });

  // Ruling: mid-TTS navigation tears the engine stream down SILENTLY (no ''
  // marker). ReaderScreen bumps navigationKey on user navigation; the bar must
  // treat that as stream end instead of waiting for a marker that never comes.
  it('treats a navigation as stream end (silent engine teardown)', async () => {
    const { bridge, sp, ui, view } = await setup();
    await fireEvent.press(screen.getByLabelText('Lire à voix haute'));
    await act(async () => { bridge.emit({ text: 'Phrase une.', cfi: 'c1' }); });
    await view.rerender(ui({ navigationKey: 1 }));
    expect(sp.stop).toHaveBeenCalled();
    expect(bridge.ttsStop).toHaveBeenCalled();
    // UI reset: the main button offers start again, not pause/resume
    expect(screen.getByLabelText('Lire à voix haute')).toBeOnTheScreen();
  });

  // Ruling: a ttsNext on an already-dead stream is a no-op engine-side — no ''
  // marker either. The onDone → ttsNext chain must therefore stop by itself
  // when no new sentence arrives within the guard window, instead of looping.
  it('stops instead of looping when a chained ttsNext stays unanswered', async () => {
    const { bridge, sp } = await setup();
    await fireEvent.press(screen.getByLabelText('Lire à voix haute'));
    await act(async () => { bridge.emit({ text: 'Phrase une.', cfi: 'c1' }); });
    jest.useFakeTimers();
    try {
      await act(async () => { onDoneOf(sp)(); }); // chains ttsNext; the engine stream is dead
      expect(bridge.ttsNext).toHaveBeenCalled();
      await act(async () => { jest.advanceTimersByTime(1000); });
      expect(sp.stop).toHaveBeenCalled();
      expect(bridge.ttsStop).toHaveBeenCalled();
      expect(screen.getByLabelText('Lire à voix haute')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps chaining when the next sentence arrives within the guard window', async () => {
    const { bridge, sp } = await setup();
    await fireEvent.press(screen.getByLabelText('Lire à voix haute'));
    await act(async () => { bridge.emit({ text: 'Une.', cfi: 'c1' }); });
    jest.useFakeTimers();
    try {
      await act(async () => { onDoneOf(sp)(); });
      await act(async () => { jest.advanceTimersByTime(999); });
      await act(async () => { bridge.emit({ text: 'Deux.', cfi: 'c2' }); }); // disarms the guard
      await act(async () => { jest.advanceTimersByTime(1000); });
      expect(sp.stop).not.toHaveBeenCalled();
      expect(sp.speak).toHaveBeenLastCalledWith('Deux.', expect.objectContaining({ rate: 1 }));
    } finally {
      jest.useRealTimers();
    }
  });

  it('ignores a sentence arriving after the stream ended', async () => {
    const { bridge, sp } = await setup();
    await fireEvent.press(screen.getByLabelText('Lire à voix haute'));
    await act(async () => { bridge.emit({ text: 'Une.', cfi: 'c1' }); });
    await act(async () => { bridge.emit({ text: '', cfi: null }); }); // section end
    await act(async () => { bridge.emit({ text: 'trop tard.', cfi: 'c3' }); }); // late engine echo
    expect(sp.speak).toHaveBeenCalledTimes(1);
  });

  it('clamps the rate stepper at the 0.5 floor and the 2.0 cap', async () => {
    const onRateChange = jest.fn();
    const floor = await setup({ rate: 0.5, onRateChange });
    await fireEvent.press(screen.getByLabelText('rate-'));
    expect(onRateChange).toHaveBeenLastCalledWith(0.5);
    await floor.view.unmount();
    onRateChange.mockClear();
    const cap = await setup({ rate: 2, onRateChange });
    await fireEvent.press(screen.getByLabelText('rate+'));
    expect(onRateChange).toHaveBeenLastCalledWith(2);
    await cap.view.unmount();
    onRateChange.mockClear();
    const mid = await setup({ rate: 1, onRateChange });
    await fireEvent.press(screen.getByLabelText('rate+'));
    expect(onRateChange).toHaveBeenLastCalledWith(1.1);
    await mid.view.unmount();
  });

  it('speaks subsequent sentences with the updated rate', async () => {
    const { bridge, sp, ui, view } = await setup({ rate: 1 });
    await fireEvent.press(screen.getByLabelText('Lire à voix haute'));
    await act(async () => { bridge.emit({ text: 'Une.', cfi: 'c1' }); });
    await view.rerender(ui({ rate: 1.5 }));
    await act(async () => { onDoneOf(sp)(); });
    await act(async () => { bridge.emit({ text: 'Deux.', cfi: 'c2' }); });
    expect(sp.speak).toHaveBeenLastCalledWith('Deux.', expect.objectContaining({ rate: 1.5 }));
  });

  it('toggles follow through onFollowChange', async () => {
    const onFollowChange = jest.fn();
    await setup({ onFollowChange });
    await fireEvent.press(screen.getByLabelText('Suivre la lecture'));
    expect(onFollowChange).toHaveBeenCalledWith(true);
  });

  it('navigates to the sentence CFI only when follow is enabled', async () => {
    const { bridge, ui, view } = await setup({ follow: false });
    await fireEvent.press(screen.getByLabelText('Lire à voix haute'));
    await act(async () => { bridge.emit({ text: 'Une.', cfi: 'c1' }); });
    expect(bridge.goTo).not.toHaveBeenCalled();
    await view.rerender(ui({ follow: true }));
    await act(async () => { bridge.emit({ text: 'Deux.', cfi: 'c2' }); });
    expect(bridge.goTo).toHaveBeenCalledWith('c2');
  });

  it('pauses and resumes through the speech service, not the engine', async () => {
    const { bridge, sp } = await setup();
    await fireEvent.press(screen.getByLabelText('Lire à voix haute'));
    await act(async () => { bridge.emit({ text: 'Une.', cfi: 'c1' }); });
    await fireEvent.press(screen.getByLabelText('Pause'));
    expect(sp.pause).toHaveBeenCalled();
    expect(bridge.ttsStop).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByLabelText('Reprendre'));
    expect(sp.resume).toHaveBeenCalled();
  });

  it('sends ttsStop and stops speech on unmount', async () => {
    const { bridge, sp, view } = await setup();
    await view.unmount();
    expect(sp.stop).toHaveBeenCalled();
    expect(bridge.ttsStop).toHaveBeenCalled();
  });

  // Review: unmount must DISARM the pending dead-stream guard, not just stop —
  // otherwise the timer fires post-unmount and re-calls stop/ttsStop on a
  // torn-down screen (idempotent today, still wrong).
  it('disarms the dead-stream guard on unmount (no stop calls after unmount)', async () => {
    const { bridge, sp, view } = await setup();
    await fireEvent.press(screen.getByLabelText('Lire à voix haute'));
    await act(async () => { bridge.emit({ text: 'Une.', cfi: 'c1' }); });
    jest.useFakeTimers();
    try {
      await act(async () => { onDoneOf(sp)(); }); // arms the guard
      await view.unmount();
      sp.stop.mockClear();
      bridge.ttsStop.mockClear();
      await act(async () => { jest.advanceTimersByTime(1000); }); // guard window expires, component gone
      expect(sp.stop).not.toHaveBeenCalled();
      expect(bridge.ttsStop).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  // Review: a session retry swaps the bridge while the bar may still show
  // playing — the transient state must reset to idle on bridge identity change.
  it('resets to idle when the bridge instance is replaced (session retry)', async () => {
    const { ui, view } = await setup();
    await fireEvent.press(screen.getByLabelText('Lire à voix haute'));
    expect(screen.getByLabelText('Pause')).toBeOnTheScreen();
    await view.rerender(ui({ bridge: makeBridge() as unknown as TtsBridge }));
    expect(screen.getByLabelText('Lire à voix haute')).toBeOnTheScreen();
  });
});
