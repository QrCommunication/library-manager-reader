import React, { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useServices } from '../../core/services';
import { useBooks, type SortKey } from './useBooks';
import { runImport } from '../../core/import/importService';
import { SUPPORTED_MIME } from '../../core/import/mime';
import { formatBytes } from '../../core/format';
import type { Book } from '../../core/types';
import { themeTokens } from '../../theme/tokens';
import { useWindowLayout } from '../../ui/windowClasses';
import { BookGridItem } from './BookGridItem';
import { ImportResultsSheet, type ImportOutcome } from './ImportResultsSheet';
import { getHeadlessEngine } from '../../core/reader/headlessEngine';
import { seedIfEmpty } from '../../dev/seed';

const SORTS: SortKey[] = ['recent', 'added', 'title', 'series'];

export function LibraryScreen() {
  const { t, i18n } = useTranslation();
  const services = useServices();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // app chrome follows the system light/dark; the reader surface has its own theme
  const dark = useColorScheme() === 'dark';
  const t0 = themeTokens(dark ? 'night' : 'day');
  // same active-language resolution as SettingsScreen (handles 'auto')
  const lang = i18n.language === 'fr' ? 'fr' : 'en';
  const [sort, setSort] = useState<SortKey>('recent');
  const [query, setQuery] = useState('');
  const [seriesFilter, setSeriesFilter] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [outcomes, setOutcomes] = useState<ImportOutcome[] | null>(null);
  const [menuBook, setMenuBook] = useState<Book | null>(null);
  const { books, seriesList, refresh } = useBooks(sort, query, seriesFilter);
  const { columns } = useWindowLayout();

  const addBooks = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, type: [...SUPPORTED_MIME], copyToCacheDirectory: true });
    if (result.canceled) return;
    setImporting(true);
    setProgress({ done: 0, total: result.assets.length });
    try {
      const results = await runImport(result.assets.map((a) => a.uri), {
        fs: services.fs, paths: services.paths, books: services.books, extractor: getHeadlessEngine(),
        untitledTitle: t('library.untitled'),
        onProgress: (p) => setProgress({ done: p.done, total: p.total }),
      });
      setOutcomes(results);
    } catch (err) {
      // failures thrown before/outside runImport (uninitialised headless engine,
      // picker oddities) would otherwise be invisible on a device build
      console.warn('[library] import failed', err);
      setOutcomes([{
        uri: result.assets[0]?.uri ?? 'import',
        ok: false,
        reason: 'io_error',
        detail: err instanceof Error ? err.message : String(err),
      }]);
    } finally {
      setImporting(false);
      setProgress(null);
      await refresh();
    }
  };

  const deleteBook = async (book: Book) => {
    await services.books.markDeleted(book.id, Date.now());
    await services.fs.remove(services.paths.bookPath(book.id, book.format)).catch(() => {});
    await services.fs.remove(services.paths.coverPath(book.id)).catch(() => {});
    setMenuBook(null);
    await refresh();
  };

  return (
    <View style={[styles.root, { backgroundColor: t0.background, paddingTop: insets.top }]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: t0.foreground }]}>{t('library.title')}</Text>
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityLabel={t('settings.title')}
          accessibilityRole="button"
          hitSlop={12}
          style={[styles.iconButton, { borderColor: t0.border }]}
        >
          <Ionicons name="settings-outline" size={20} color={t0.foreground} />
        </Pressable>
      </View>
      <View style={[styles.search, { backgroundColor: t0.chrome, borderColor: t0.border }]}>
        <Ionicons name="search" size={16} color={t0.muted} />
        <TextInput
          style={[styles.searchInput, { color: t0.foreground }]}
          placeholder={t('library.search')}
          placeholderTextColor={t0.muted}
          value={query}
          onChangeText={setQuery}
          autoCorrect={false}
        />
      </View>
      <View style={styles.sortRow}>
        {SORTS.map((srt) => (
          <Pressable
            key={srt}
            onPress={() => setSort(srt)}
            style={[styles.sortChip, { borderColor: t0.border }, sort === srt && { backgroundColor: t0.accent, borderColor: t0.accent }]}
          >
            <Text style={[styles.sortChipText, { color: sort === srt ? t0.onAccent : t0.foreground }]}>
              {t(`library.sort.${srt}`)}
            </Text>
          </Pressable>
        ))}
      </View>
      {seriesList.length > 0 ? (
        // horizontal chips: tap filters the grid to that series, tap again clears
        <View style={styles.seriesRow}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seriesRowContent}>
            {seriesList.map((s) => (
              <Pressable
                key={s.name}
                onPress={() => setSeriesFilter((cur) => (cur === s.name ? null : s.name))}
                style={[
                  styles.sortChip,
                  { borderColor: t0.border },
                  seriesFilter === s.name && { backgroundColor: t0.accent, borderColor: t0.accent },
                ]}
              >
                <Text style={[styles.sortChipText, { color: seriesFilter === s.name ? t0.onAccent : t0.foreground }]}>
                  {`${s.name} (${s.count})`}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}
      {importing && progress ? (
        <View style={[styles.importBanner, { backgroundColor: t0.chrome, borderColor: t0.border }]}>
          <Text style={[styles.importText, { color: t0.foreground }]}>
            {t('library.importing', { done: progress.done, total: progress.total })}
          </Text>
          <View style={styles.importTrack}>
            <View style={{ flex: progress.done / progress.total, backgroundColor: t0.accent, borderRadius: 2 }} />
            <View style={{ flex: 1 - progress.done / progress.total }} />
          </View>
        </View>
      ) : null}
      {books.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.emptyGlyphWrap, { backgroundColor: t0.chrome }]}>
            <Ionicons name="library-outline" size={40} color={t0.muted} />
          </View>
          <Text style={[styles.emptyTitle, { color: t0.foreground }]} onLongPress={__DEV__ ? () => { void seedIfEmpty(services).catch((e) => console.warn('[seed] failed', e)); } : undefined}>
            {t('library.empty')}
          </Text>
          <Text style={[styles.emptyHint, { color: t0.muted }]}>{t('library.emptyHint')}</Text>
          <Pressable style={[styles.emptyButton, { backgroundColor: t0.accent }]} onPress={addBooks} disabled={importing}>
            <Text style={[styles.emptyButtonText, { color: t0.onAccent }]}>{t('library.add')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={books}
          contentContainerStyle={styles.grid}
          // key remounts the list when the column count changes (fold/rotate):
          // FlatList forbids numColumns mutations for a mounted instance
          key={`grid-${columns}`}
          numColumns={columns}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => (
            <BookGridItem
              book={item}
              coverUri={`${services.paths.coverPath(item.id)}`}
              onPress={() => router.push(`/book/${item.id}`)}
              onLongPress={() => setMenuBook(item)}
            />
          )}
        />
      )}
      <Pressable
        style={[styles.fab, { backgroundColor: t0.accent, bottom: 24 + insets.bottom }]}
        onPress={addBooks}
        disabled={importing}
        accessibilityLabel={t('library.add')}
        accessibilityRole="button"
      >
        {importing ? <ActivityIndicator color={t0.onAccent} /> : <Ionicons name="add" size={28} color={t0.onAccent} />}
      </Pressable>

      <Modal visible={menuBook !== null} transparent animationType="fade" onRequestClose={() => setMenuBook(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenuBook(null)}>
          <View style={[styles.sheet, { backgroundColor: t0.chrome, paddingBottom: 16 + insets.bottom }]}>
            <View style={styles.sheetHandle}>
              <View style={[styles.sheetHandleBar, { backgroundColor: t0.border }]} />
            </View>
            <Text numberOfLines={1} style={[styles.sheetTitle, { color: t0.foreground }]}>{menuBook?.title}</Text>
            <Pressable style={styles.sheetRow} onPress={() => { const b = menuBook!; setMenuBook(null); router.push(`/book/${b.id}`); }}>
              <Ionicons name="book-outline" size={20} color={t0.foreground} />
              <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.menu.open')}</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={() => { Alert.alert(t('library.menu.info'), `${menuBook?.title ?? ''}\n${menuBook?.author ?? ''} · ${menuBook ? formatBytes(menuBook.fileSize, lang) : ''}`); setMenuBook(null); }}>
              <Ionicons name="information-circle-outline" size={20} color={t0.foreground} />
              <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.menu.info')}</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={() => { const b = menuBook!; setMenuBook(null); Alert.alert(t('common.delete'), b.title, [{ text: t('common.cancel') }, { text: t('common.confirm'), style: 'destructive', onPress: () => void deleteBook(b) }]); }}>
              <Ionicons name="trash-outline" size={20} color={t0.danger} />
              <Text style={[styles.sheetRowText, { color: t0.danger }]}>{t('library.menu.delete')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {outcomes && <ImportResultsSheet outcomes={outcomes} onClose={() => setOutcomes(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 12 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  iconButton: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, height: 42, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  sortRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  seriesRow: { marginBottom: 4 },
  seriesRowContent: { flexDirection: 'row', gap: 8, paddingRight: 16 },
  importBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 42, marginBottom: 10,
  },
  importText: { fontSize: 14, fontWeight: '600', minWidth: 120 },
  importTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: '#88888833', flexDirection: 'row' },
  sortChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, borderWidth: 1 },
  sortChipText: { fontSize: 13, fontWeight: '600' },
  grid: { paddingBottom: 96, gap: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingBottom: 60 },
  emptyGlyphWrap: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  emptyTitle: { fontSize: 18, fontWeight: '700' },
  emptyHint: { fontSize: 14, textAlign: 'center', paddingHorizontal: 40 },
  emptyButton: { marginTop: 12, borderRadius: 24, paddingHorizontal: 24, paddingVertical: 12 },
  emptyButtonText: { fontSize: 15, fontWeight: '700' },
  fab: { position: 'absolute', right: 24, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  sheetBackdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 8, gap: 4 },
  sheetHandle: { alignItems: 'center', paddingVertical: 8 },
  sheetHandleBar: { width: 36, height: 4, borderRadius: 2 },
  sheetTitle: { fontSize: 16, fontWeight: '700', marginBottom: 8 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  sheetRowText: { fontSize: 15 },
});
