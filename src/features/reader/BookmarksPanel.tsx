import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useServices } from '../../core/services';
import type { Bookmark } from '../../core/types';

// Structural slice of the reader bridge needed here (ReaderBridge satisfies it).
export interface BookmarkCaptureBridge {
  captureBookmark(): Promise<{ target: string; fraction: number; excerpt: string }>;
}

export function BookmarksPanel({ bookId, bridge, onNavigate }: {
  bookId: string;
  bridge: BookmarkCaptureBridge;
  onNavigate(target: string): void;
}) {
  const { t } = useTranslation();
  const { bookmarks } = useServices();
  const [items, setItems] = useState<Bookmark[]>([]);
  const [adding, setAdding] = useState(false);

  const reload = useCallback(async () => {
    setItems(await bookmarks.listByBook(bookId));
  }, [bookmarks, bookId]);

  useEffect(() => { void reload(); }, [reload]);

  const add = async () => {
    setAdding(true);
    try {
      const captured = await bridge.captureBookmark();
      await bookmarks.addBookmark({
        bookId,
        cfi: captured.target,
        fraction: captured.fraction,
        previewText: captured.excerpt,
        createdAt: Date.now(),
      });
      await reload();
    } catch {
      /* capture timeout / engine hiccup: swallowed for V1 (error paths in T21) */
    } finally {
      setAdding(false);
    }
  };

  const remove = async (id: string) => {
    await bookmarks.markDeleted(id, Date.now());
    await reload();
  };

  return (
    <View style={styles.root}>
      <Pressable
        style={[styles.addButton, adding && styles.buttonDisabled]}
        disabled={adding}
        onPress={() => void add()}
      >
        <Text style={styles.addText}>{t('reader.bookmark.add')}</Text>
      </Pressable>
      <ScrollView>
        {items.map((bm) => (
          <View key={bm.id} style={styles.row}>
            <Pressable style={styles.rowMain} onPress={() => onNavigate(bm.cfi)}>
              <Text style={styles.preview} numberOfLines={2}>
                {bm.previewText ?? bm.cfi}
              </Text>
            </Pressable>
            <Pressable hitSlop={8} onPress={() => void remove(bm.id)} accessibilityLabel={t('reader.bookmark.remove')}>
              <Text style={styles.remove}>✕</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  addButton: {
    margin: 12, paddingVertical: 10, borderRadius: 8,
    backgroundColor: '#2D6CDF', alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  addText: { color: '#FFFFFF', fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#00000022' },
  rowMain: { flex: 1, paddingVertical: 12, paddingRight: 8 },
  preview: { fontSize: 14 },
  remove: { fontSize: 16, color: '#C0392B', paddingHorizontal: 6 },
});
