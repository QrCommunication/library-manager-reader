import React, { useCallback, useEffect, useState } from 'react';
import { FlatList, Pressable, StatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { confirm } from '../../ui/dialogs';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useServices } from '../../core/services';
import type { Book } from '../../core/types';
import { themeTokens } from '../../theme/tokens';
import { TRASH_RETENTION_DAYS, emptyTrash, purgeBookFiles, purgeExpiredTrash } from '../../core/library/trashService';

const DAY_MS = 24 * 60 * 60 * 1000;

// days-left is computed at load time, not during render (Date.now() is impure)
type TrashEntry = { book: Book; daysLeft: number };
const toEntry = (b: Book): TrashEntry => ({
  book: b,
  daysLeft: Math.max(0, TRASH_RETENTION_DAYS - Math.floor((Date.now() - (b.deletedAt ?? 0)) / DAY_MS)),
});

export function TrashScreen() {
  const { t } = useTranslation();
  const services = useServices();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dark = useColorScheme() === 'dark';
  const t0 = themeTokens(dark ? 'night' : 'day');
  const [items, setItems] = useState<TrashEntry[]>([]);

  const refresh = useCallback(async () => {
    setItems((await services.books.listDeleted()).map(toEntry));
  }, [services]);

  useEffect(() => {
    void (async () => {
      // retention sweep on entry: tombstones older than 30 days lose their files
      await purgeExpiredTrash({ fs: services.fs, paths: services.paths, books: services.books });
      await refresh();
    })();
  }, [services, refresh]);

  const restore = async (b: Book) => {
    await services.books.restoreBook(b.id);
    await refresh();
  };

  const purgeOne = (b: Book) => {
    void (async () => {
      if (!(await confirm({ title: t('trash.purge'), message: b.title, confirmLabel: t('common.confirm'), destructive: true }))) return;
      await purgeBookFiles({ fs: services.fs, paths: services.paths, books: services.books }, b);
      await refresh();
    })();
  };

  const emptyAll = () => {
    void (async () => {
      if (!(await confirm({ title: t('trash.emptyTrash'), message: t('trash.hint', { days: TRASH_RETENTION_DAYS }), confirmLabel: t('common.confirm'), destructive: true }))) return;
      await emptyTrash({ fs: services.fs, paths: services.paths, books: services.books });
      await refresh();
    })();
  };

  return (
    <View style={[styles.root, { backgroundColor: t0.background, paddingTop: insets.top }]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <View style={styles.titleRow}>
        <Pressable onPress={() => router.back()} accessibilityLabel={t('common.cancel')} hitSlop={12} style={[styles.iconButton, { borderColor: t0.border }]}>
          <Ionicons name="arrow-back" size={20} color={t0.foreground} />
        </Pressable>
        <Text style={[styles.title, { color: t0.foreground }]}>{t('trash.title')}</Text>
        <View style={styles.iconButton} />
      </View>
      <Text style={[styles.hint, { color: t0.muted }]}>{t('trash.hint', { days: TRASH_RETENTION_DAYS })}</Text>
      {items.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyGlyphWrap, { backgroundColor: t0.chrome }]}>
            <Ionicons name="trash-outline" size={40} color={t0.muted} />
          </View>
          <Text style={[styles.emptyTitle, { color: t0.foreground }]}>{t('trash.empty')}</Text>
        </View>
      ) : (
        <>
          <FlatList
            data={items}
            keyExtractor={(e) => e.book.id}
            contentContainerStyle={styles.list}
            renderItem={({ item }) => (
              <View style={[styles.row, { backgroundColor: t0.chrome, borderColor: t0.border }]}>
                <View style={styles.rowMain}>
                  <Text numberOfLines={1} style={[styles.rowTitle, { color: t0.foreground }]}>{item.book.title}</Text>
                  <Text style={[styles.rowSub, { color: t0.muted }]}>{t('trash.daysLeft', { days: item.daysLeft })}</Text>
                </View>
                <Pressable onPress={() => void restore(item.book)} accessibilityLabel={t('trash.restore')} hitSlop={8} style={styles.rowAction}>
                  <Ionicons name="arrow-undo-outline" size={20} color={t0.foreground} />
                </Pressable>
                <Pressable onPress={() => purgeOne(item.book)} accessibilityLabel={t('trash.purge')} hitSlop={8} style={styles.rowAction}>
                  <Ionicons name="trash-outline" size={20} color={t0.danger} />
                </Pressable>
              </View>
            )}
          />
          <Pressable
            style={[styles.emptyButton, { backgroundColor: t0.danger, marginBottom: 24 + insets.bottom }]}
            onPress={emptyAll}
            accessibilityRole="button"
          >
            <Text style={styles.emptyButtonText}>{t('trash.emptyTrash')}</Text>
          </Pressable>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 8 },
  title: { fontSize: 24, fontWeight: '800' },
  iconButton: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  hint: { fontSize: 13, marginBottom: 12 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 60 },
  emptyGlyphWrap: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600' },
  list: { paddingBottom: 16, gap: 8 },
  row: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, gap: 8 },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowSub: { fontSize: 12 },
  rowAction: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  emptyButton: { alignSelf: 'center', borderRadius: 24, paddingHorizontal: 24, paddingVertical: 12 },
  emptyButtonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
