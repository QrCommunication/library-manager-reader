import React, { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
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

const SORTS: SortKey[] = ['recent', 'added', 'title'];

export function LibraryScreen() {
  const { t, i18n } = useTranslation();
  const services = useServices();
  const router = useRouter();
  // same active-language resolution as SettingsScreen (handles 'auto')
  const lang = i18n.language === 'fr' ? 'fr' : 'en';
  const [sort, setSort] = useState<SortKey>('recent');
  const [query, setQuery] = useState('');
  const [importing, setImporting] = useState(false);
  const [outcomes, setOutcomes] = useState<ImportOutcome[] | null>(null);
  const [menuBook, setMenuBook] = useState<Book | null>(null);
  const { books, refresh } = useBooks(sort, query);
  const { columns } = useWindowLayout();

  const addBooks = async () => {
    const result = await DocumentPicker.getDocumentAsync({ multiple: true, type: [...SUPPORTED_MIME], copyToCacheDirectory: true });
    if (result.canceled) return;
    setImporting(true);
    try {
      const results = await runImport(result.assets.map((a) => a.uri), {
        fs: services.fs, paths: services.paths, books: services.books, extractor: getHeadlessEngine(),
        untitledTitle: t('library.untitled'),
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
    <View style={[styles.root, { backgroundColor: themeTokens('day').background }]}>
      <View style={styles.titleRow}>
        <Text style={styles.title}>{t('library.title')}</Text>
        <Pressable
          onPress={() => router.push('/settings')}
          accessibilityLabel={t('settings.title')}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.settingsGlyph}>{'⚙'}</Text>
        </Pressable>
      </View>
      <TextInput
        style={styles.search}
        placeholder={t('library.search')}
        value={query}
        onChangeText={setQuery}
        autoCorrect={false}
      />
      <View style={styles.sortRow}>
        {SORTS.map((s) => (
          <Pressable key={s} onPress={() => setSort(s)} style={[styles.sortChip, sort === s && styles.sortChipOn]}>
            <Text>{t(`library.sort.${s}`)}</Text>
          </Pressable>
        ))}
      </View>
      {books.length === 0 ? (
        <View style={styles.empty}>
          <Text onLongPress={__DEV__ ? () => { void seedIfEmpty(services).catch((e) => console.warn('[seed] failed', e)); } : undefined}>
            {t('library.empty')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={books}
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
      <Pressable style={styles.fab} onPress={addBooks} disabled={importing}>
        {importing ? <ActivityIndicator /> : <Text style={styles.fabText}>{t('library.add')}</Text>}
      </Pressable>

      <Modal visible={menuBook !== null} transparent animationType="fade" onRequestClose={() => setMenuBook(null)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenuBook(null)}>
          <View style={styles.sheet}>
            <Pressable onPress={() => { const b = menuBook!; setMenuBook(null); router.push(`/book/${b.id}`); }}>
              <Text>{t('library.menu.open')}</Text>
            </Pressable>
            <Pressable onPress={() => { Alert.alert(t('library.menu.info'), `${menuBook?.title ?? ''}\n${menuBook?.author ?? ''} · ${menuBook ? formatBytes(menuBook.fileSize, lang) : ''}`); setMenuBook(null); }}>
              <Text>{t('library.menu.info')}</Text>
            </Pressable>
            <Pressable onPress={() => { const b = menuBook!; setMenuBook(null); Alert.alert(t('common.delete'), b.title, [{ text: t('common.cancel') }, { text: t('common.confirm'), style: 'destructive', onPress: () => void deleteBook(b) }]); }}>
              <Text style={{ color: '#C0392B' }}>{t('library.menu.delete')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {outcomes && <ImportResultsSheet outcomes={outcomes} onClose={() => setOutcomes(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingTop: 48, paddingHorizontal: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  title: { fontSize: 28, fontWeight: '700' },
  settingsGlyph: { fontSize: 22, lineHeight: 28 },
  search: { borderWidth: 1, borderColor: '#CCC', borderRadius: 8, paddingHorizontal: 10, height: 40, marginBottom: 8 },
  sortRow: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  sortChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#CCC' },
  sortChipOn: { backgroundColor: '#DCE7FB', borderColor: '#2D6CDF' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  fab: { position: 'absolute', bottom: 24, right: 24, backgroundColor: '#2D6CDF', borderRadius: 24, paddingHorizontal: 16, paddingVertical: 12 },
  fabText: { color: '#FFF', fontWeight: '600' },
  sheetBackdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFF', padding: 20, gap: 16, borderTopLeftRadius: 16, borderTopRightRadius: 16 },
});
