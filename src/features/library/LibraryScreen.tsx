import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { createLmAccountDeps } from '../../core/storage/expoSecureStore';
import { lmClientFromAccount, lmInstallationId, lmIsConnected } from '../../core/remote/lmAccount';
import { LmError, type LmBook, type LmClient, type LmSpace } from '../../core/remote/lmClient';
import { applyServerProgress, matchRemoteBook, pushLocalChoice, syncSpaceProgress, type LmConflict } from '../../core/remote/lmSync';
import { readyVersion, uploadBookFile } from '../../core/remote/lmTransfer';
import { sha256HexOfBytes } from '../../core/remote/lmSha256';
import { uuidV7 } from '../../core/uuid';

const SORTS: SortKey[] = ['recent', 'added', 'title', 'series'];

// formats the mobile API accepts AND the reader can import
const UPLOAD_FORMATS = new Set(['epub', 'mobi', 'azw3']);

const lmErrorMessage = (err: unknown, t: (k: string) => string): string => {
  if (err instanceof LmError) {
    if (err.kind === 'auth') return t('library.remote.authFailed');
    if (err.kind === 'network') return t('library.remote.network');
  }
  return t('library.remote.failed');
};

const importReasonMessage = (outcome: ImportOutcome | undefined, t: (k: string) => string): string => {
  if (!outcome || outcome.ok) return t('library.remote.failed');
  switch (outcome.reason) {
    case 'duplicate': return t('import.failed.duplicate');
    case 'no_space': return t('import.failed.no_space');
    case 'unsupported': return t('import.failed.unsupported');
    default: return t('import.failed.parse');
  }
};

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
  const [remoteSheet, setRemoteSheet] = useState(false);
  const [lmSpaces, setLmSpaces] = useState<LmSpace[] | null>(null);
  const [activeSpace, setActiveSpace] = useState<LmSpace | null>(null);
  const [remoteBooks, setRemoteBooks] = useState<LmBook[] | null>(null);
  const [remoteCursor, setRemoteCursor] = useState<string | null>(null);
  const [localBooks, setLocalBooks] = useState<Book[]>([]);
  const [lmBusy, setLmBusy] = useState(false);
  const lmClientRef = useRef<LmClient | null>(null);
  // tokens live in Keychain/Keystore (spec §10); prefs carry the display name only
  const lmAccount = useMemo(() => createLmAccountDeps(services.settings), [services]);
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

  // the sheet reads the account state at open time: connected → spaces list,
  // otherwise the sign-in pointer towards the settings screen
  const openRemoteSheet = () => {
    setRemoteSheet(true);
    void (async () => {
      setLmBusy(true);
      setLmSpaces(null);
      setActiveSpace(null);
      setRemoteBooks(null);
      setRemoteCursor(null);
      try {
        if (!(await lmIsConnected(lmAccount))) return;
        const client = await lmClientFromAccount(lmAccount);
        lmClientRef.current = client;
        setLmSpaces(await client.listSpaces());
      } catch (err) {
        console.warn('[library] remote spaces failed', err);
        setRemoteSheet(false);
        Alert.alert(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        setLmBusy(false);
      }
    })();
  };

  const enterSpace = (space: LmSpace) => {
    const client = lmClientRef.current;
    if (!client) return;
    setActiveSpace(space);
    void (async () => {
      setLmBusy(true);
      try {
        const [page, locals] = await Promise.all([
          client.listBooks(space.id),
          services.books.listBooks({ sort: 'added' }),
        ]);
        setRemoteBooks(page.items);
        setRemoteCursor(page.nextCursor);
        setLocalBooks(locals);
      } catch (err) {
        console.warn('[library] remote books failed', err);
        setActiveSpace(null);
        Alert.alert(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        setLmBusy(false);
      }
    })();
  };

  const loadMoreRemote = () => {
    const client = lmClientRef.current;
    const space = activeSpace;
    if (!client || !space || !remoteCursor || lmBusy) return;
    void (async () => {
      setLmBusy(true);
      try {
        const page = await client.listBooks(space.id, { cursor: remoteCursor });
        setRemoteBooks((cur) => [...(cur ?? []), ...page.items]);
        setRemoteCursor(page.nextCursor);
      } catch (err) {
        console.warn('[library] remote books page failed', err);
        Alert.alert(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        setLmBusy(false);
      }
    })();
  };

  // one-to-one match: the used set tracks local ids already claimed, so two
  // remotes with the same title never steal each other's counterpart
  const remoteRows = () => {
    const used = new Set<string>();
    const rows = (remoteBooks ?? []).map((remote) => {
      const local = matchRemoteBook(remote, localBooks, used);
      if (local) used.add(local.id);
      return { remote, local };
    });
    return { rows, uploadable: localBooks.filter((b) => !used.has(b.id) && UPLOAD_FORMATS.has(b.format)) };
  };

  // remote files land in a staging dir so runImport (extraction, dedup,
  // cover, canonical storage) runs on a plain file path, then gets cleaned up.
  // The download goes through the signed URL only — no Authorization header —
  // and the bytes are hash-checked against the version descriptor before the
  // local copy is confirmed to the server (spec §7).
  const downloadRemote = (rb: LmBook) => {
    const client = lmClientRef.current;
    const space = activeSpace;
    if (!client || !space) return;
    void (async () => {
      setLmBusy(true);
      const dir = `${services.paths.root}/remote-import`;
      let tmpPath: string | null = null;
      try {
        const details = await client.getBook(space.id, rb.id);
        const version = readyVersion(details.versions);
        if (!version) {
          Alert.alert(t('library.remote.title'), t('library.remote.noVersion'));
          return;
        }
        const dl = await client.getDownload(space.id, rb.id, version.id);
        const res = await fetch(dl.download.url, { method: dl.download.method, headers: dl.download.headers });
        if (!res.ok) throw new LmError('server', `download → ${res.status}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        const sha256 = await sha256HexOfBytes(bytes);
        if (bytes.length !== dl.sizeBytes || sha256 !== dl.sha256.toLowerCase()) {
          Alert.alert(t('library.remote.title'), t('library.remote.integrityFailed'));
          return;
        }
        await services.fs.ensureDir(dir);
        tmpPath = `${dir}/${rb.id}.${dl.format}`;
        await services.fs.writeBytes(tmpPath, bytes);
        const [outcome] = await runImport([tmpPath], {
          fs: services.fs, paths: services.paths, books: services.books, extractor: getHeadlessEngine(),
          untitledTitle: t('library.untitled'),
        });
        if (outcome?.ok) {
          const installationId = await lmInstallationId(lmAccount);
          await client.confirmLocalCopy(space.id, rb.id, {
            installationId, versionId: version.id, sha256: dl.sha256, sizeBytes: dl.sizeBytes,
          });
          Alert.alert(t('library.remote.title'), t('library.remote.downloadDone'));
          setLocalBooks(await services.books.listBooks({ sort: 'added' }));
          await refresh();
        } else {
          Alert.alert(t('library.remote.title'), importReasonMessage(outcome, t));
        }
      } catch (err) {
        console.warn('[library] remote download failed', err);
        Alert.alert(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        if (tmpPath) await services.fs.remove(tmpPath).catch(() => {});
        setLmBusy(false);
      }
    })();
  };

  // three-step import (begin → signed PUT → complete + polling); the sha256
  // computed here lets the server deduplicate an identical file as 'duplicate'
  const uploadLocal = (book: Book) => {
    const client = lmClientRef.current;
    const space = activeSpace;
    if (!client || !space) return;
    if (!UPLOAD_FORMATS.has(book.format)) {
      Alert.alert(t('library.remote.title'), t('library.remote.formatUnsupported'));
      return;
    }
    void (async () => {
      setLmBusy(true);
      try {
        const bytes = await services.fs.readBytes(services.paths.bookPath(book.id, book.format));
        const outcome = await uploadBookFile(
          { client, spaceId: space.id, fetchImpl: fetch, newId: uuidV7 },
          {
            filename: book.fileName,
            format: book.format,
            sizeBytes: bytes.length,
            sha256: await sha256HexOfBytes(bytes),
          },
          bytes,
        );
        const message = outcome === 'ready' ? t('library.remote.uploadDone')
          : outcome === 'duplicate' ? t('library.remote.uploadDuplicate')
          : outcome === 'timeout' ? t('library.remote.uploadTimeout')
          : t('library.remote.failed');
        Alert.alert(t('library.remote.title'), message);
        const page = await client.listBooks(space.id);
        setRemoteBooks(page.items);
        setRemoteCursor(page.nextCursor);
      } catch (err) {
        console.warn('[library] remote upload failed', err);
        Alert.alert(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        setLmBusy(false);
      }
    })();
  };

  // conflicts demand an explicit choice (spec §8): no silent newest-wins. A
  // raced 409 on the chosen write re-opens the same question with fresh data.
  const askConflictChoice = (conflict: LmConflict): Promise<'server' | 'local' | null> =>
    new Promise((resolve) => {
      Alert.alert(
        t('library.remote.conflictTitle'),
        t('library.remote.conflictBody', {
          title: conflict.remoteTitle,
          server: Math.round(conflict.server.percent),
          local: Math.round(conflict.local.fraction * 100),
        }),
        [
          { text: t('library.remote.conflictServer'), onPress: () => resolve('server') },
          { text: t('library.remote.conflictLocal'), onPress: () => resolve('local') },
          { text: t('common.cancel'), style: 'cancel', onPress: () => resolve(null) },
        ],
        { cancelable: false },
      );
    });

  const resolveConflict = async (spaceId: string, installationId: string, conflict: LmConflict) => {
    const client = lmClientRef.current;
    if (!client) return;
    for (;;) {
      const choice = await askConflictChoice(conflict);
      if (choice === null) return;
      const syncDeps = {
        client,
        locals: localBooks,
        getProgress: (id: string) => services.progress.getProgress(id),
        saveProgress: (p: Parameters<typeof services.progress.saveProgress>[0]) => services.progress.saveProgress(p),
        installationId,
        newOperationId: uuidV7,
      };
      try {
        if (choice === 'server') {
          await applyServerProgress(syncDeps, conflict.localId, conflict.server);
        } else {
          await pushLocalChoice(syncDeps, spaceId, conflict);
        }
        return;
      } catch (err) {
        console.warn('[library] conflict resolution failed', err);
        // fall through: re-ask until the user picks a side that sticks or cancels
      }
    }
  };

  const syncProgress = () => {
    const client = lmClientRef.current;
    const space = activeSpace;
    if (!client || !space) return;
    void (async () => {
      setLmBusy(true);
      try {
        const installationId = await lmInstallationId(lmAccount);
        const summary = await syncSpaceProgress({
          client,
          locals: localBooks,
          getProgress: (id) => services.progress.getProgress(id),
          saveProgress: (p) => services.progress.saveProgress(p),
          installationId,
          newOperationId: uuidV7,
        }, space.id, remoteBooks ?? []);
        for (const conflict of summary.conflicts) {
          await resolveConflict(space.id, installationId, conflict);
        }
        Alert.alert(t('library.remote.title'), t('library.remote.syncDone', {
          pulled: summary.pulled, pushed: summary.pushed, inSync: summary.inSync,
          none: summary.none, failed: summary.failed, conflicts: summary.conflicts.length,
        }));
        await refresh();
      } catch (err) {
        console.warn('[library] remote progress sync failed', err);
        Alert.alert(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        setLmBusy(false);
      }
    })();
  };

  const remoteView = remoteRows();

  return (
    <View style={[styles.root, { backgroundColor: t0.background, paddingTop: insets.top }]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <View style={styles.titleRow}>
        <Pressable
          style={styles.titlePress}
          onPress={openRemoteSheet}
          accessibilityLabel={t('library.remote.title')}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={[styles.title, { color: t0.foreground }]}>{t('library.title')}</Text>
          <Ionicons name="chevron-forward" size={22} color={t0.muted} />
        </Pressable>
        <View style={styles.titleActions}>
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

      <Modal visible={remoteSheet} transparent animationType="fade" onRequestClose={() => setRemoteSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setRemoteSheet(false)}>
          <View
            style={[styles.sheet, { backgroundColor: t0.chrome, paddingBottom: 16 + insets.bottom, maxHeight: win.height * 0.8 }]}
            testID="remote-sheet"
          >
            <View style={styles.sheetHandle}>
              <View style={[styles.sheetHandleBar, { backgroundColor: t0.border }]} />
            </View>
            {!activeSpace && lmSpaces === null ? (
              lmBusy ? (
                <ActivityIndicator style={{ paddingVertical: 24 }} color={t0.muted} />
              ) : (
                <>
                  <Text style={[styles.sheetTitle, { color: t0.foreground }]}>{t('library.remote.title')}</Text>
                  <Text style={[styles.remoteEmpty, { color: t0.muted }]}>{t('library.remote.needAccount')}</Text>
                  <Pressable style={styles.sheetRow} onPress={() => { setRemoteSheet(false); router.push('/settings'); }}>
                    <Ionicons name="settings-outline" size={20} color={t0.foreground} />
                    <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.remote.goSettings')}</Text>
                  </Pressable>
                </>
              )
            ) : activeSpace ? (
              <>
                <Pressable style={styles.sheetRow} onPress={() => { setActiveSpace(null); setRemoteBooks(null); }} disabled={lmBusy}>
                  <Ionicons name="arrow-back" size={20} color={t0.foreground} />
                  <Text numberOfLines={1} style={[styles.sheetRowText, { color: t0.foreground }]}>{activeSpace.name}</Text>
                </Pressable>
                <Pressable style={styles.sheetRow} onPress={syncProgress} disabled={lmBusy}>
                  <Ionicons name="sync-outline" size={20} color={t0.foreground} />
                  <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.remote.syncProgress')}</Text>
                </Pressable>
                {lmBusy ? <ActivityIndicator style={{ paddingVertical: 8 }} color={t0.muted} /> : null}
                <Text style={[styles.sheetSection, { color: t0.muted }]}>{t('library.remote.onServer', { count: remoteView.rows.length })}</Text>
                <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetScroll}>
                  {remoteView.rows.map(({ remote, local }) => (
                    <View key={remote.id} style={styles.sheetRow}>
                      {local ? (
                        <Ionicons name="checkmark-circle" size={20} color={t0.accent} />
                      ) : (
                        <Pressable onPress={() => downloadRemote(remote)} hitSlop={8} disabled={lmBusy} accessibilityRole="button" accessibilityLabel={`${t('library.remote.download')} ${remote.title}`}>
                          <Ionicons name="cloud-download-outline" size={20} color={t0.accent} />
                        </Pressable>
                      )}
                      <Text numberOfLines={1} style={[styles.sheetRowText, styles.sheetRowMain, { color: t0.foreground }]}>
                        {remote.title}{remote.author ? ` — ${remote.author}` : ''}
                      </Text>
                    </View>
                  ))}
                  {remoteCursor ? (
                    <Pressable style={styles.sheetRow} onPress={loadMoreRemote} disabled={lmBusy}>
                      <Ionicons name="chevron-down" size={20} color={t0.foreground} />
                      <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.remote.loadMore')}</Text>
                    </Pressable>
                  ) : null}
                </ScrollView>
                {remoteView.uploadable.length > 0 ? (
                  <>
                    <Text style={[styles.sheetSection, { color: t0.muted }]}>{t('library.remote.notOnServer', { count: remoteView.uploadable.length })}</Text>
                    <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetScroll}>
                      {remoteView.uploadable.map((b) => (
                        <View key={b.id} style={styles.sheetRow}>
                          <Pressable onPress={() => uploadLocal(b)} hitSlop={8} disabled={lmBusy} accessibilityRole="button" accessibilityLabel={`${t('library.remote.upload')} ${b.title}`}>
                            <Ionicons name="cloud-upload-outline" size={20} color={t0.accent} />
                          </Pressable>
                          <Text numberOfLines={1} style={[styles.sheetRowText, styles.sheetRowMain, { color: t0.foreground }]}>{b.title}</Text>
                        </View>
                      ))}
                    </ScrollView>
                  </>
                ) : null}
              </>
            ) : (
              <>
                <Text style={[styles.sheetTitle, { color: t0.foreground }]}>{t('library.remote.title')}</Text>
                {lmSpaces === null ? (
                  <ActivityIndicator style={{ paddingVertical: 24 }} color={t0.muted} />
                ) : (
                  <ScrollView keyboardShouldPersistTaps="handled" style={styles.sheetScroll}>
                    {lmSpaces.map((s) => (
                      <Pressable key={s.id} style={styles.sheetRow} onPress={() => enterSpace(s)}>
                        <Ionicons name="server-outline" size={20} color={t0.foreground} />
                        <Text numberOfLines={1} style={[styles.sheetRowText, styles.sheetRowMain, { color: t0.foreground }]}>{s.name}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                )}
              </>
            )}
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
  titlePress: { flexDirection: 'row', alignItems: 'center', gap: 6 },
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
  sheetSection: { fontSize: 13, fontWeight: '700', marginTop: 8, marginBottom: 2 },
  remoteEmpty: { fontSize: 14, paddingVertical: 12 },
  seriesEmpty: { fontSize: 14, paddingVertical: 12 },
  seriesCount: { fontSize: 14, fontWeight: '600' },
});
