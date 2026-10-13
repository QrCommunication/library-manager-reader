import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { SpeechService } from '../../core/speech/speechService';

// A ttsNext on an already-dead engine stream (mid-TTS navigation, no-op next)
// is answered by NOTHING — no '' marker is ever sent (Task 14 ruling). After
// chaining ttsNext on sentence completion, this window bounds how long the bar
// waits for the next sentence before declaring the stream ended by itself.
const TTS_NEXT_GUARD_MS = 1000;

// The bridge slice TtsBar consumes (subset of ReaderBridge).
export interface TtsBridge {
  ttsStart(cfi: string | null): void;
  ttsStop(): void;
  ttsNext(): void;
  onTtsSentence(cb: (s: { text: string; cfi: string | null }) => void): () => void;
  goTo(target: string): void;
}

// expo-speech expects BCP-47; a bare 2-letter book language gets a region
// appended, anything longer passes through, absent metadata falls back to en-US.
const toSpeechLanguage = (language: string | null): string =>
  !language ? 'en-US' : language.length === 2 ? `${language}-${language.toUpperCase()}` : language;

type Status = 'idle' | 'playing' | 'paused';

export function TtsBar({ bridge, speech, rate, onRateChange, bookLang, currentCfi, onStart, follow, onFollowChange, navigationKey = 0 }: {
  bridge: TtsBridge;
  speech: SpeechService;
  rate: number;
  onRateChange(rate: number): void;
  bookLang: string | null;
  // Brief ruling: start position is the current view — ReaderScreen owns the
  // start via onStart (ttsStart(null)); this accessor is kept for parity with
  // the brief's interface but is not needed by the bar itself.
  currentCfi?(): string | null;
  onStart(): void;
  follow: boolean;
  onFollowChange(follow: boolean): void;
  // Bumped by ReaderScreen on every USER navigation (zones, scrub, panels);
  // the follow mode's own goTo calls never bump it. A change mid-stream means
  // the engine has already torn the TTS down silently — end the local stream.
  navigationKey?: number;
}) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('idle');
  // Sentence events arrive outside the render loop; refs carry the values the
  // handler needs without re-subscribing (writes happen in effects/handlers).
  const followRef = useRef(follow);
  const rateRef = useRef(rate);
  const statusRef = useRef<Status>('idle');
  const navigationRef = useRef(navigationKey);
  const bridgeRef = useRef(bridge);
  const guardRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => { followRef.current = follow; }, [follow]);
  useEffect(() => { rateRef.current = rate; }, [rate]);

  const disarm = useCallback(() => {
    if (guardRef.current) { clearTimeout(guardRef.current); guardRef.current = null; }
  }, []);

  // Stream teardown shared by '' marker, stop button, navigation and the
  // dead-stream guard: silence speech, tell the engine (idempotent no-op if it
  // already tore down) and reset the bar UI.
  const endStream = useCallback(() => {
    disarm();
    speech.stop();
    bridge.ttsStop();
    statusRef.current = 'idle';
    setStatus('idle');
  }, [bridge, speech, disarm]);

  // Ruling: navigation mid-TTS kills the engine stream without a marker.
  useEffect(() => {
    if (navigationRef.current === navigationKey) return;
    navigationRef.current = navigationKey;
    if (statusRef.current !== 'idle') endStream();
  }, [navigationKey, endStream]);

  // Sentence stream → speech. The dead-stream guard: after onDone chains
  // ttsNext, either a new sentence disarms it or the timeout ends the stream.
  useEffect(() => {
    return bridge.onTtsSentence((s) => {
      disarm(); // any engine sentence answers the pending dead-stream guard
      if (s.text === '') { endStream(); return; } // section-end marker
      if (statusRef.current === 'idle') return; // late echo on a torn-down stream
      if (followRef.current && s.cfi) bridge.goTo(s.cfi);
      speech.speak(s.text, {
        language: toSpeechLanguage(bookLang),
        rate: rateRef.current,
        onDone: () => {
          bridge.ttsNext();
          disarm();
          guardRef.current = setTimeout(() => { guardRef.current = null; endStream(); }, TTS_NEXT_GUARD_MS);
        },
      });
    });
  }, [bridge, speech, bookLang, endStream, disarm]);

  // A session retry replaces the bridge — the old stream is gone (its stop ran
  // in the cleanup below) but the bar would keep a stale playing/paused label.
  // Reset the transient state (guard + status) on bridge identity change.
  useEffect(() => {
    if (bridgeRef.current === bridge) return;
    bridgeRef.current = bridge;
    disarm();
    statusRef.current = 'idle';
    setStatus('idle');
  }, [bridge, disarm]);

  // Leaving the screen (or a session retry replacing the bridge) stops playback;
  // disarm the guard too so its timer can't fire post-teardown.
  useEffect(() => () => { disarm(); speech.stop(); bridge.ttsStop(); }, [bridge, speech, disarm]);

  return (
    <View style={styles.root}>
      <Pressable
        accessibilityLabel={status === 'playing' ? t('tts.pause') : status === 'paused' ? t('tts.resume') : t('tts.start')}
        onPress={() => {
          if (status === 'playing') { speech.pause(); statusRef.current = 'paused'; setStatus('paused'); return; }
          if (status === 'paused') { speech.resume(); statusRef.current = 'playing'; setStatus('playing'); return; }
          statusRef.current = 'playing';
          setStatus('playing');
          onStart();
        }}
      >
        <Text style={styles.glyph}>{status === 'playing' ? '⏸' : '▶'}</Text>
      </Pressable>
      <Pressable accessibilityLabel={t('tts.stop')} onPress={endStream}>
        <Text style={styles.glyph}>{'⏹'}</Text>
      </Pressable>
      <Text style={styles.rateLabel}>{t('tts.rate')}</Text>
      <Pressable accessibilityLabel="rate-" onPress={() => onRateChange(Math.max(0.5, Math.round((rate - 0.1) * 10) / 10))}>
        <Text>{'−'}</Text>
      </Pressable>
      <Text style={styles.rateValue}>{`${rate.toFixed(1)}×`}</Text>
      <Pressable accessibilityLabel="rate+" onPress={() => onRateChange(Math.min(2, Math.round((rate + 0.1) * 10) / 10))}>
        <Text>{'+'}</Text>
      </Pressable>
      <Pressable accessibilityLabel={t('tts.follow')} onPress={() => onFollowChange(!follow)}>
        <Text style={[styles.follow, follow && styles.followOn]}>{'⇥'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute', bottom: 56, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12,
    backgroundColor: '#FFFFFFEE',
  },
  glyph: { fontSize: 20, lineHeight: 24, minWidth: 24, textAlign: 'center' },
  rateLabel: { fontSize: 13, marginLeft: 'auto' },
  rateValue: { minWidth: 38, textAlign: 'center', fontVariant: ['tabular-nums'] },
  follow: { fontSize: 18, lineHeight: 22, opacity: 0.35 },
  followOn: { opacity: 1 },
});
