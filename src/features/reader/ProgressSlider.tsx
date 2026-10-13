import React, { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { useReaderTheme } from '../../theme/context';

const clamp = (f: number) => Math.min(1, Math.max(0, f));

export function ProgressSlider({ fraction, onScrub }: { fraction: number; onScrub(f: number): void }) {
  const th = useReaderTheme();
  const width = useRef(0);
  // created once; `width.current` is only read from gesture callbacks (event
  // time, never render time) — the refs rule cannot see that, so suppress its
  // render-time-call heuristic on this creation.
  // eslint-disable-next-line react-hooks/refs
  const [pan] = useState(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => onScrub(clamp(e.nativeEvent.locationX / (width.current || 1))),
    onPanResponderMove: (e) => onScrub(clamp(e.nativeEvent.locationX / (width.current || 1))),
  }));
  return (
    <View style={[s.track, { backgroundColor: th.border }]} onLayout={(e) => { width.current = e.nativeEvent.layout.width; }} {...pan.panHandlers}>
      <View style={[s.fill, { backgroundColor: th.accent, flex: Math.max(fraction, 0.001) }]} />
      <View style={{ flex: Math.max(1 - fraction, 0.001) }} />
    </View>
  );
}

const s = StyleSheet.create({
  track: { flex: 1, flexDirection: 'row', height: 24, borderRadius: 4, overflow: 'hidden' },
  fill: {},
});
