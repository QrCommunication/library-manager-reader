import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import type { TocItem } from '../../core/types';

// Recursive flat rendering inside a ScrollView (a nested VirtualizedList would
// crash inside the drawer); depth drives the left indentation.
export function TocPanel({ toc, onNavigate }: { toc: TocItem[]; onNavigate(target: string): void }) {
  return (
    <ScrollView style={styles.root}>
      {renderItems(toc, 0, onNavigate)}
    </ScrollView>
  );
}

function renderItems(items: TocItem[], depth: number, onNavigate: (target: string) => void): React.ReactNode[] {
  return items.flatMap((item, i) => {
    const key = `${depth}-${i}`;
    const target = item.target;
    const node =
      target === null ? (
        <Text key={key} style={[styles.header, { paddingLeft: 12 + depth * 16 }]} numberOfLines={1}>
          {item.label}
        </Text>
      ) : (
        <Pressable
          key={key}
          style={({ pressed }) => [styles.row, { paddingLeft: 12 + depth * 16 }, pressed && styles.pressed]}
          onPress={() => onNavigate(target)}
        >
          <Text style={styles.label} numberOfLines={1}>
            {item.label}
          </Text>
        </Pressable>
      );
    return [node, ...(item.children ? renderItems(item.children, depth + 1, onNavigate) : [])];
  });
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { paddingVertical: 12, paddingRight: 12 },
  header: { paddingVertical: 10, paddingRight: 12, fontSize: 13, fontWeight: '700', opacity: 0.7 },
  label: { fontSize: 15 },
  pressed: { backgroundColor: '#00000014' },
});
