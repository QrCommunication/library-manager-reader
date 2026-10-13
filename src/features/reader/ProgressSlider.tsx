import React, { useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

const clamp = (f: number) => Math.min(1, Math.max(0, f));

export function ProgressSlider({ fraction, onScrub }: { fraction: number; onScrub(f: number): void }) {
  const width = useRef(0);
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: (e) => onScrub(clamp(e.nativeEvent.locationX / (width.current || 1))),
    onPanResponderMove: (e) => onScrub(clamp(e.nativeEvent.locationX / (width.current || 1))),
  })).current;
  return (
    <View style={s.track} onLayout={(e) => { width.current = e.nativeEvent.layout.width; }} {...pan.panHandlers}>
      <View style={[s.fill, { flex: Math.max(fraction, 0.001) }]} />
      <View style={{ flex: Math.max(1 - fraction, 0.001) }} />
    </View>
  );
}

const s = StyleSheet.create({
  track: { flexDirection: 'row', height: 24, borderRadius: 4, overflow: 'hidden', backgroundColor: '#DDD' },
  fill: { backgroundColor: '#2D6CDF' },
});
