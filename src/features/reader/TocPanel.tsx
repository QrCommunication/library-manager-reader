import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import type { TocItem } from '../../core/types';
import { useReaderTheme } from '../../theme/context';

// Recursive flat rendering inside a ScrollView (a nested VirtualizedList would
// crash inside the drawer); depth drives the left indentation.
export function TocPanel({ toc, onNavigate }: { toc: TocItem[]; onNavigate(target: string): void }) {
  const th = useReaderTheme();
  return (
    <ScrollView style={styles.root}>
      {renderItems(toc, 0, onNavigate, th)}
    </ScrollView>
  );
}

function renderItems(items: TocItem[], depth: number, onNavigate: (target: string) => void, th: ReturnType<typeof useReaderTheme>): React.ReactNode[] {
  return items.flatMap((item, i) => {
    const key = `${depth}-${i}`;
    const target = item.target;
    const node =
      target === null ? (
        <Text key={key} style={[styles.header, { paddingLeft: 12 + depth * 16, color: th.muted }]} numberOfLines={1}>
          {item.label}
        </Text>
      ) : (
        <Pressable
          key={key}
          style={({ pressed }) => [styles.row, { paddingLeft: 12 + depth * 16 }, pressed && { backgroundColor: th.border }]}
          onPress={() => onNavigate(target)}
        >
          <Text style={[styles.label, { color: th.foreground }]} numberOfLines={1}>
            {item.label}
          </Text>
        </Pressable>
      );
    return [node, ...(item.children ? renderItems(item.children, depth + 1, onNavigate, th) : [])];
  });
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  row: { paddingVertical: 12, paddingRight: 12 },
  header: { paddingVertical: 10, paddingRight: 12, fontSize: 13, fontWeight: '700' },
  label: { fontSize: 15 },
});
