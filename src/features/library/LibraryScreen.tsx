import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useColorScheme, useWindowDimensions } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
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
import { MetadataEditSheet } from './MetadataEditSheet';
import { getHeadlessEngine } from '../../core/reader/headlessEngine';
import { purgeExpiredTrash } from '../../core/library/trashService';
import { buildExportEntries, zipEntries } from '../../core/library/exportService';
import { storedFormat } from '../../core/library/fileMeta';
import { saveBytesToUserDir, EXPORT_MIME } from '../../core/storage/saf';
import { seedIfEmpty } from '../../dev/seed';
import { parseSidecar, serializeSidecar } from '../../core/progress/koreaderSidecar';

const SORTS: SortKey[] = ['recent', 'added', 'title', 'series'];

export function LibraryScreen() {
  const { t, i18n } = useTranslation();
  const services = useServices();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
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
  const [editBook, setEditBook] = useState<Book | null>(null);
  const [seriesSheet, setSeriesSheet] = useState(false);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const selectionMode = selection.size > 0;
  const { books, seriesList, progressMap, refresh } = useBooks(sort, query, seriesFilter);
  const { columns } = useWindowLayout();

  // trash retention sweep: expired tombstones (and their files) go for good
  useEffect(() => {
    void purgeExpiredTrash({ fs: services.fs, paths: services.paths, books: services.books }).catch(() => {});
    // services is the app-wide singleton
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // tombstone only: files stay on disk for the 30-day trash window
  const deleteBook = async (book: Book) => {
    await services.books.markDeleted(book.id, Date.now());
    setMenuBook(null);
    await refresh();
  };

  const exportSidecar = async (book: Book) => {
    try {
      const local = await services.progress.getProgress(book.id);
      if (!local) {
        Alert.alert(t('library.menu.exportSidecar'), t('library.sidecar.none'));
        return;
      }
      const slug = book.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 60) || 'book';
      const dir = `${services.paths.root}/export/${slug}.sdr`;
      await services.fs.ensureDir(dir);
      const path = `${dir}/metadata.${book.format}.lua`;
      await services.fs.writeText(path, serializeSidecar({
        percentFinished: local.fraction,
        lastRead: Math.floor(local.updatedAt / 1000),
        title: book.title,
        authors: book.author,
        language: book.language,
      }));
      await Sharing.shareAsync(path, { mimeType: 'application/octet-stream' });
      Alert.alert(t('library.menu.exportSidecar'), t('library.sidecar.exported'));
    } catch (err) {
      console.warn('[library] sidecar export failed', err);
      Alert.alert(t('library.menu.exportSidecar'), t('library.sidecar.exportFailed'));
    }
  };

  const importSidecar = async (book: Book) => {
    try {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false, type: '*/*', copyToCacheDirectory: true });
      const uri = result.canceled ? null : result.assets[0]?.uri;
      if (!uri) return;
      const text = await services.fs.readText(uri);
      const parsed = parseSidecar(text);
      if (!parsed) {
        Alert.alert(t('library.menu.importSidecar'), t('library.sidecar.invalid'));
        return;
      }
      await services.progress.saveProgress({
        bookId: book.id,
        cfi: null,
        fraction: parsed.percentFinished,
        sectionIndex: null,
        updatedAt: parsed.lastRead !== null ? parsed.lastRead * 1000 : Date.now(),
      });
      await refresh();
      Alert.alert(t('library.menu.importSidecar'), t('library.sidecar.imported'));
    } catch (err) {
      console.warn('[library] sidecar import failed', err);
      Alert.alert(t('library.menu.importSidecar'), t('library.sidecar.invalid'));
    }
  };

  const exportDeps = () => ({
    fs: services.fs,
    paths: services.paths,
    getProgress: (id: string) => services.progress.getProgress(id),
  });

  // single book: the renamed file goes straight to the chosen folder
  const exportBook = async (book: Book) => {
    try {
      const entries = await buildExportEntries(exportDeps(), [book]);
      const saved = await saveBytesToUserDir(entries[0]!.path, EXPORT_MIME[storedFormat(book)] ?? 'application/octet-stream', entries[0]!.data);
      if (saved) Alert.alert(t('library.menu.exportBook'), t('library.export.done'));
    } catch (err) {
      console.warn('[library] export failed', err);
      Alert.alert(t('library.menu.exportBook'), t('library.export.failed'));
    }
  };

  // selection: one zip of renamed books + KOReader sidecars
  const exportSelected = async () => {
    const ids = new Set(selection);
    const picked = books.filter((b) => ids.has(b.id));
    if (picked.length === 0) return;
    try {
      const zip = zipEntries(await buildExportEntries(exportDeps(), picked));
      const stamp = new Date().toISOString().slice(0, 10);
      const saved = await saveBytesToUserDir(`library-reader-export-${stamp}.zip`, EXPORT_MIME.zip!, zip);
      if (saved) {
        setSelection(new Set());
        Alert.alert(t('library.exportSelected'), t('library.export.done'));
      }
    } catch (err) {
      console.warn('[library] export failed', err);
      Alert.alert(t('library.exportSelected'), t('library.export.failed'));
    }
  };

  // whole library: every non-deleted book regardless of the active filters
  const exportLibrary = async () => {
    try {
      const all = await services.books.listBooks({ sort: 'added' });
      if (all.length === 0) return;
      const zip = zipEntries(await buildExportEntries(exportDeps(), all));
      const stamp = new Date().toISOString().slice(0, 10);
      const saved = await saveBytesToUserDir(`library-reader-export-${stamp}.zip`, EXPORT_MIME.zip!, zip);
      if (saved) Alert.alert(t('library.exportAll'), t('library.export.done'));
    } catch (err) {
      console.warn('[library] export failed', err);
      Alert.alert(t('library.exportAll'), t('library.export.failed'));
    }
  };

  const toggleSelect = (id: string) =>
    setSelection((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const bulkDelete = () => {
    const ids = [...selection];
    Alert.alert(t('library.deleteSelected', { count: ids.length }), undefined, [
      { text: t('common.cancel') },
      {
        text: t('common.confirm'),
        style: 'destructive',
        onPress: () => void (async () => {
          const now = Date.now();
          for (const id of ids) await services.books.markDeleted(id, now);
          setSelection(new Set());
          await refresh();
        })(),
      },
    ]);
  };

  return (
    <View style={[styles.root, { backgroundColor: t0.background, paddingTop: insets.top }]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <View style={styles.titleRow}>
        <Text style={[styles.title, { color: t0.foreground }]}>{t('library.title')}</Text>
        <View style={styles.titleActions}>
          <Pressable
            onPress={() => void exportLibrary()}
            accessibilityLabel={t('library.exportAll')}
            accessibilityRole="button"
            hitSlop={12}
            disabled={importing}
            style={[styles.iconButton, { borderColor: t0.border, opacity: importing ? 0.4 : 1 }]}
          >
            <Ionicons name="archive-outline" size={20} color={t0.foreground} />
          </Pressable>
          <Pressable
            onPress={() => setSeriesSheet(true)}
            accessibilityLabel={t('library.series')}
            accessibilityRole="button"
            hitSlop={12}
            style={[styles.iconButton, { borderColor: t0.border }]}
          >
            <Ionicons name="albums-outline" size={20} color={t0.foreground} />
          </Pressable>
          <Pressable
            onPress={() => router.push('/trash')}
            accessibilityLabel={t('trash.title')}
            accessibilityRole="button"
            hitSlop={12}
            style={[styles.iconButton, { borderColor: t0.border }]}
          >
            <Ionicons name="trash-outline" size={20} color={t0.foreground} />
          </Pressable>
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
      {selectionMode ? (
        <View style={[styles.selectionBar, { backgroundColor: t0.chrome, borderColor: t0.border }]}>
          <Pressable onPress={() => setSelection(new Set())} accessibilityLabel={t('library.exitSelection')} hitSlop={8}>
            <Ionicons name="close" size={22} color={t0.foreground} />
          </Pressable>
          <Text style={[styles.selectionCount, { color: t0.foreground }]}>{t('library.selected', { count: selection.size })}</Text>
          <Pressable onPress={() => void exportSelected()} accessibilityLabel={t('library.exportSelected')} accessibilityRole="button" hitSlop={8} style={styles.selectionAction}>
            <Ionicons name="download-outline" size={22} color={t0.foreground} />
          </Pressable>
          <Pressable onPress={bulkDelete} accessibilityLabel={t('library.deleteSelected', { count: selection.size })} accessibilityRole="button" hitSlop={8} style={styles.selectionAction}>
            <Ionicons name="trash-outline" size={22} color={t0.danger} />
          </Pressable>
        </View>
      ) : null}
      {importing && progress ? (
        <View style={[styles.importBanner, { backgroundColor: t0.chrome, borderColor: t0.border }]}>
          <Text style={[styles.importText, { color: t0.foreground }]}>
            {t('library.importing', { done: progress.done, total: progress.total })}
          </Text>
          <View style={styles.importTrack}>
            <View style={{ flex: progress.total > 0 ? progress.done / progress.total : 0, backgroundColor: t0.accent, borderRadius: 2 }} />
            <View style={{ flex: progress.total > 0 ? 1 - progress.done / progress.total : 1 }} />
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
              selectionMode={selectionMode}
              selected={selection.has(item.id)}
              progress={progressMap.get(item.id)}
              onPress={() => (selectionMode ? toggleSelect(item.id) : router.push(`/book/${item.id}`))}
              onLongPress={() => (selectionMode ? toggleSelect(item.id) : setMenuBook(item))}
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

      <Modal visible={seriesSheet} transparent animationType="fade" onRequestClose={() => setSeriesSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setSeriesSheet(false)}>
          <View
            style={[styles.sheet, { backgroundColor: t0.chrome, paddingBottom: 16 + insets.bottom, maxHeight: win.height * 0.7 }]}
            testID="series-sheet"
          >
            <View style={styles.sheetHandle}>
              <View style={[styles.sheetHandleBar, { backgroundColor: t0.border }]} />
            </View>
            <Text style={[styles.sheetTitle, { color: t0.foreground }]}>{t('library.series')}</Text>
            <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetScroll}>
              {seriesList.length === 0 ? (
                <Text style={[styles.seriesEmpty, { color: t0.muted }]}>{t('library.seriesEmpty')}</Text>
              ) : (
                seriesList.map((s) => {
                  const active = seriesFilter === s.name;
                  return (
                    <Pressable
                      key={s.name}
                      style={styles.sheetRow}
                      onPress={() => { setSeriesFilter(active ? null : s.name); setSeriesSheet(false); }}
                    >
                      <Ionicons
                        name={active ? 'checkmark-circle' : 'albums-outline'}
                        size={20}
                        color={active ? t0.accent : t0.foreground}
                      />
                      <Text numberOfLines={1} style={[styles.sheetRowText, styles.sheetRowMain, { color: t0.foreground }]}>{s.name}</Text>
                      <Text style={[styles.seriesCount, { color: t0.muted }]}>{s.count}</Text>
                    </Pressable>
                  );
                })
              )}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

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
            <Pressable style={styles.sheetRow} onPress={() => { const b = menuBook!; setMenuBook(null); setEditBook(b); }}>
              <Ionicons name="create-outline" size={20} color={t0.foreground} />
              <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.edit')}</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={() => { const b = menuBook!; setMenuBook(null); void exportBook(b); }}>
              <Ionicons name="save-outline" size={20} color={t0.foreground} />
              <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.menu.exportBook')}</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={() => { const b = menuBook!; setMenuBook(null); void exportSidecar(b); }}>
              <Ionicons name="share-outline" size={20} color={t0.foreground} />
              <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.menu.exportSidecar')}</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={() => { const b = menuBook!; setMenuBook(null); void importSidecar(b); }}>
              <Ionicons name="download-outline" size={20} color={t0.foreground} />
              <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.menu.importSidecar')}</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={() => { const b = menuBook!; setMenuBook(null); setSelection(new Set([b.id])); }}>
              <Ionicons name="checkbox-outline" size={20} color={t0.foreground} />
              <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.select')}</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={() => { const b = menuBook!; setMenuBook(null); Alert.alert(t('common.delete'), b.title, [{ text: t('common.cancel') }, { text: t('common.confirm'), style: 'destructive', onPress: () => void deleteBook(b) }]); }}>
              <Ionicons name="trash-outline" size={20} color={t0.danger} />
              <Text style={[styles.sheetRowText, { color: t0.danger }]}>{t('library.menu.delete')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      {outcomes && <ImportResultsSheet outcomes={outcomes} onClose={() => setOutcomes(null)} />}

      {editBook ? (
        <MetadataEditSheet
          key={editBook.id}
          book={editBook}
          onClose={() => setEditBook(null)}
          onSaved={() => { setEditBook(null); void refresh(); }}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, paddingHorizontal: 16 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16, marginBottom: 12 },
  titleActions: { flexDirection: 'row', gap: 8 },
  title: { fontSize: 30, fontWeight: '800', letterSpacing: -0.5 },
  iconButton: { width: 38, height: 38, borderRadius: 19, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, height: 42, marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  sortRow: { flexDirection: 'row', gap: 8, marginBottom: 4 },
  importBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, height: 42, marginBottom: 10,
  },
  importText: { fontSize: 14, fontWeight: '600', minWidth: 120 },
  importTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: '#88888833', flexDirection: 'row' },
  sortChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 18, borderWidth: 1 },
  sortChipText: { fontSize: 13, fontWeight: '600' },
  selectionBar: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 12, height: 44, marginBottom: 10,
  },
  selectionCount: { flex: 1, fontSize: 14, fontWeight: '700' },
  selectionAction: { paddingHorizontal: 4 },
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
  sheetScroll: { flexGrow: 0 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14 },
  sheetRowText: { fontSize: 15 },
  sheetRowMain: { flex: 1 },
  seriesEmpty: { fontSize: 14, paddingVertical: 12 },
  seriesCount: { fontSize: 14, fontWeight: '600' },
});
