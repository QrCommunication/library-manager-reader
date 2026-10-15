import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useColorScheme, useWindowDimensions } from 'react-native';
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
import { RemoteBookGridItem } from './RemoteBookGridItem';
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
import { LmError, type LmBook, type LmBookDetails, type LmClient, type LmSpace, type LmVersion } from '../../core/remote/lmClient';
import { applyServerProgress, matchRemoteBook, pushLocalChoice, syncSpaceProgress, type LmConflict } from '../../core/remote/lmSync';
import { readyVersion, uploadBookFile } from '../../core/remote/lmTransfer';
import { sha256HexOfBytes } from '../../core/remote/lmSha256';
import { ensureCoverFile } from '../../core/remote/coverCache';
import { uuidV7 } from '../../core/uuid';
import { confirm, inform, alert as dialogAlert } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { SeriesSelect } from './SeriesSelect';

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
  const [lmConnected, setLmConnected] = useState(false);
  const [lmSpaces, setLmSpaces] = useState<LmSpace[] | null>(null);
  const [activeSpace, setActiveSpace] = useState<LmSpace | null>(null);
  const [remoteBooks, setRemoteBooks] = useState<LmBook[] | null>(null);
  const [remoteCursor, setRemoteCursor] = useState<string | null>(null);
  const [remoteTotal, setRemoteTotal] = useState<number | null>(0);
  const [remoteQuery, setRemoteQuery] = useState('');
  const [remoteSeries, setRemoteSeries] = useState<string | null>(null);
  const [remoteSelection, setRemoteSelection] = useState<Set<string>>(new Set());
  const [localBooks, setLocalBooks] = useState<Book[]>([]);
  const [lmBusy, setLmBusy] = useState(false);
  const lmClientRef = useRef<LmClient | null>(null);
  // per-sheet book details memo: covers and transfers share the getBook result
  const detailsCache = useRef(new Map<string, LmBookDetails>());
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
        void inform(t('library.menu.exportSidecar'), t('library.sidecar.none'));
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
      showToast(t('library.sidecar.exported'));
    } catch (err) {
      console.warn('[library] sidecar export failed', err);
      void inform(t('library.menu.exportSidecar'), t('library.sidecar.exportFailed'));
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
        void inform(t('library.menu.importSidecar'), t('library.sidecar.invalid'));
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
      showToast(t('library.sidecar.imported'));
    } catch (err) {
      console.warn('[library] sidecar import failed', err);
      void inform(t('library.menu.importSidecar'), t('library.sidecar.invalid'));
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
      if (saved) showToast(t('library.export.done'));
      else void inform(t('library.menu.exportBook'), t('library.export.failed'));
    } catch (err) {
      console.warn('[library] export failed', err);
      void inform(t('library.menu.exportBook'), t('library.export.failed'));
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
        showToast(t('library.export.done'));
      }
    } catch (err) {
      console.warn('[library] export failed', err);
      void inform(t('library.exportSelected'), t('library.export.failed'));
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
    void (async () => {
      if (!(await confirm({
        title: t('library.deleteSelected', { count: ids.length }),
        confirmLabel: t('common.confirm'),
        destructive: true,
      }))) return;
      const now = Date.now();
      for (const id of ids) await services.books.markDeleted(id, now);
      setSelection(new Set());
      await refresh();
    })();
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
        const connected = await lmIsConnected(lmAccount);
        setLmConnected(connected);
        if (!connected) return;
        const client = await lmClientFromAccount(lmAccount);
        lmClientRef.current = client;
        setLmSpaces(await client.listSpaces());
      } catch (err) {
        console.warn('[library] remote spaces failed', err);
        setRemoteSheet(false);
        void inform(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        setLmBusy(false);
      }
    })();
  };

  const enterSpace = (space: LmSpace) => {
    const client = lmClientRef.current;
    if (!client) return;
    setActiveSpace(space);
    setRemoteQuery('');
    setRemoteSeries(null);
    setRemoteSelection(new Set());
    detailsCache.current.clear();
    void (async () => {
      setLmBusy(true);
      try {
        const [page, locals] = await Promise.all([
          client.listBooks(space.id),
          services.books.listBooks({ sort: 'added' }),
        ]);
        setRemoteBooks(page.items);
        setRemoteCursor(page.nextCursor);
        setRemoteTotal(page.total);
        setLocalBooks(locals);
      } catch (err) {
        console.warn('[library] remote books failed', err);
        setActiveSpace(null);
        inform(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        setLmBusy(false);
      }
    })();
  };

  // one page of the server catalogue with the current filters. A keyword
  // goes to the dedicated /books/search route (q required, total null);
  // without one the catalogue route filters (search=, series=) apply.
  const fetchRemotePage = (space: LmSpace, cursor?: string | null) => {
    const client = lmClientRef.current;
    if (!client) return Promise.reject(new LmError('auth', 'no client'));
    const q = remoteQuery.trim();
    return q
      ? client.searchBooks(space.id, { q, cursor: cursor ?? undefined, series: remoteSeries, sort: 'title', direction: 'asc' })
      : client.listBooks(space.id, { cursor: cursor ?? undefined, series: remoteSeries });
  };

  const reloadRemote = () => {
    const space = activeSpace;
    if (!space || lmBusy) return;
    void (async () => {
      setLmBusy(true);
      try {
        const page = await fetchRemotePage(space);
        setRemoteBooks(page.items);
        setRemoteCursor(page.nextCursor);
        setRemoteTotal(page.total);
      } catch (err) {
        console.warn('[library] remote search failed', err);
        void inform(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        setLmBusy(false);
      }
    })();
  };

  const loadMoreRemote = () => {
    const space = activeSpace;
    if (!space || !remoteCursor || lmBusy) return;
    void (async () => {
      setLmBusy(true);
      try {
        const page = await fetchRemotePage(space, remoteCursor);
        setRemoteBooks((cur) => [...(cur ?? []), ...page.items]);
        setRemoteCursor(page.nextCursor);
        setRemoteTotal(page.total);
      } catch (err) {
        console.warn('[library] remote books page failed', err);
        void inform(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        setLmBusy(false);
      }
    })();
  };

  // debounced server search: don't fire a request per keystroke
  useEffect(() => {
    if (!activeSpace) return;
    const timer = setTimeout(reloadRemote, 400);
    return () => clearTimeout(timer);
    // remoteQuery drives the refetch; the other deps are read through state
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [remoteQuery]);

  // one-to-one match: the used set tracks local ids already claimed, so two
  // remotes with the same title never steal each other's counterpart — the
  // resulting id set drives the "already in the library" tile badges
  const matchedRemoteIds = () => {
    const used = new Set<string>();
    const matched = new Set<string>();
    for (const remote of remoteBooks ?? []) {
      const local = matchRemoteBook(remote, localBooks, used);
      if (local) {
        used.add(local.id);
        matched.add(remote.id);
      }
    }
    return matched;
  };

  const openMenu = (book: Book) => {
    setMenuBook(book);
    void lmIsConnected(lmAccount).then(setLmConnected);
  };

  /** full server details, memoizing getBook across covers/transfers/info */
  const getDetails = async (client: LmClient, spaceId: string, bookId: string): Promise<LmBookDetails> => {
    const cached = detailsCache.current.get(bookId);
    const details = cached ?? await client.getBook(spaceId, bookId);
    detailsCache.current.set(bookId, details);
    return details;
  };

  /** ready version of a server book, memoizing getBook across covers/transfers */
  const readyDetails = async (client: LmClient, spaceId: string, bookId: string): Promise<LmVersion | null> =>
    readyVersion((await getDetails(client, spaceId, bookId)).versions);

  // ⓘ on a remote tile: load the server-side details (name, author, series,
  // summary) and present them in a themed dialog
  const showRemoteInfo = (rb: LmBook) => {
    const client = lmClientRef.current;
    const space = activeSpace;
    if (!client || !space) return;
    void (async () => {
      setLmBusy(true);
      try {
        const d = await getDetails(client, space.id, rb.id);
        const ready = d.versions.filter((v) => v.status === 'ready');
        const lines = [
          rb.author ?? d.author ?? null,
          d.series ? `${d.series}${rb.seriesIndex != null ? ` — T${rb.seriesIndex}` : ''}` : null,
          d.publisher ?? null,
          d.language ?? null,
          ready.length > 0 ? t('library.remote.infoVersions', { count: ready.length }) : null,
          d.description ?? null,
        ].filter((line): line is string => Boolean(line));
        void inform(rb.title, lines.join('\n\n'));
      } catch (err) {
        console.warn('[library] remote info failed', err);
        void inform(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        setLmBusy(false);
      }
    })();
  };

  type TransferOutcome = 'imported' | 'duplicate' | 'unsupported' | 'no_space' | 'parse' | 'noVersion' | 'integrity' | 'failed';

  // download+import+confirmLocalCopy with NO user-facing side effects — the
  // single and bulk flows translate the outcome into toast/dialog themselves
  const transferBook = async (rb: LmBook): Promise<TransferOutcome> => {
    const client = lmClientRef.current;
    const space = activeSpace;
    if (!client || !space) return 'failed';
    const dir = `${services.paths.root}/remote-import`;
    let tmpPath: string | null = null;
    try {
      const version = await readyDetails(client, space.id, rb.id);
      if (!version) return 'noVersion';
      const dl = await client.getDownload(space.id, rb.id, version.id);
      // signed URL only — never attach the Authorization header here
      const res = await fetch(dl.download.url, { method: dl.download.method, headers: dl.download.headers });
      if (!res.ok) return 'failed';
      const bytes = new Uint8Array(await res.arrayBuffer());
      const sha256 = await sha256HexOfBytes(bytes);
      if (bytes.length !== dl.sizeBytes || sha256 !== dl.sha256.toLowerCase()) return 'integrity';
      await services.fs.ensureDir(dir);
      tmpPath = `${dir}/${rb.id}.${dl.format}`;
      await services.fs.writeBytes(tmpPath, bytes);
      const [outcome] = await runImport([tmpPath], {
        fs: services.fs, paths: services.paths, books: services.books, extractor: getHeadlessEngine(),
        untitledTitle: t('library.untitled'),
      });
      if (!outcome?.ok) {
        return outcome?.reason === 'duplicate' ? 'duplicate'
          : outcome?.reason === 'no_space' ? 'no_space'
          : outcome?.reason === 'unsupported' ? 'unsupported'
          : 'parse';
      }
      const installationId = await lmInstallationId(lmAccount);
      await client.confirmLocalCopy(space.id, rb.id, {
        installationId, versionId: version.id, sha256: dl.sha256, sizeBytes: dl.sizeBytes,
      });
      const fresh = await services.books.listBooks({ sort: 'added' });
      setLocalBooks(fresh);
      await refresh();
      // remember the cloud identity so page-turns sync live from now on
      const imported = matchRemoteBook(rb, fresh);
      if (imported) {
        await services.remoteSync.linkBook({ bookId: imported.id, spaceId: space.id, serverBookId: rb.id, versionId: version.id });
      }
      return 'imported';
    } catch (err) {
      console.warn('[library] remote transfer failed', err);
      return 'failed';
    } finally {
      if (tmpPath) await services.fs.remove(tmpPath).catch(() => {});
    }
  };

  const transferOutcomeMessage = (outcome: TransferOutcome, title: string): string =>
    outcome === 'imported' ? t('library.remote.downloadDone')
      : outcome === 'duplicate' ? t('import.failed.duplicate')
      : outcome === 'noVersion' ? t('library.remote.noVersion')
      : outcome === 'integrity' ? t('library.remote.integrityFailed')
      : outcome === 'unsupported' ? t('import.failed.unsupported')
      : outcome === 'no_space' ? t('import.failed.no_space')
      : outcome === 'parse' ? t('import.failed.parse')
      : `${t('library.remote.failed')} — ${title}`;

  // tap or long-press on a remote tile: confirm, transfer, then notify
  const askTransfer = (rb: LmBook) => {
    void (async () => {
      if (!(await confirm({
        title: t('library.remote.transfer'),
        message: t('library.remote.transferAsk', { title: rb.title }),
        confirmLabel: t('library.remote.transferGo'),
      }))) return;
      setLmBusy(true);
      const outcome = await transferBook(rb);
      setLmBusy(false);
      if (outcome === 'imported') showToast(t('library.remote.downloadDone'));
      else void inform(t('library.remote.title'), transferOutcomeMessage(outcome, rb.title));
    })();
  };

  // bulk import of the current selection, sequential, one summary at the end
  const bulkTransfer = () => {
    const ids = remoteSelection;
    if (ids.size === 0) return;
    void (async () => {
      const title = t('library.remote.transferBulk', { count: ids.size });
      if (!(await confirm({ title, message: t('library.remote.transferBulkAsk', { count: ids.size }) }))) return;
      setLmBusy(true);
      let imported = 0;
      const failures: string[] = [];
      for (const rb of remoteBooks ?? []) {
        if (!ids.has(rb.id)) continue;
        const outcome = await transferBook(rb);
        if (outcome === 'imported') imported += 1;
        else failures.push(rb.title);
      }
      setLmBusy(false);
      setRemoteSelection(new Set());
      if (failures.length === 0) showToast(t('library.remote.bulkDone', { count: imported }));
      else void inform(t('library.remote.title'), t('library.remote.bulkPartial', { imported, failed: failures.length, titles: failures.join(', ') }));
      if (activeSpace) {
        const page = await fetchRemotePage(activeSpace).catch(() => null);
        if (page) {
          setRemoteBooks(page.items);
          setRemoteCursor(page.nextCursor);
          setRemoteTotal(page.total);
        }
      }
    })();
  };

  const toggleRemoteSelection = (rb: LmBook) => {
    setRemoteSelection((cur) => {
      const next = new Set(cur);
      if (next.has(rb.id)) next.delete(rb.id);
      else next.add(rb.id);
      return next;
    });
  };

  // three-step import (begin → signed PUT → complete + polling); the sha256
  // computed here lets the server deduplicate an identical file as 'duplicate'
  const uploadLocal = (book: Book) => {
    const client = lmClientRef.current;
    const space = activeSpace;
    if (!client || !space) return;
    if (!UPLOAD_FORMATS.has(book.format)) {
      void inform(t('library.remote.title'), t('library.remote.formatUnsupported'));
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
        if (outcome === 'ready') {
          showToast(t('library.remote.uploadDone'));
          const page = await client.listBooks(space.id);
          setRemoteBooks(page.items);
          setRemoteCursor(page.nextCursor);
          // link the local book to its new cloud copy for live page-turn sync
          const server = matchRemoteBook(book, page.items);
          if (server) {
            const version = await readyDetails(client, space.id, server.id);
            if (version) {
              await services.remoteSync.linkBook({ bookId: book.id, spaceId: space.id, serverBookId: server.id, versionId: version.id });
            }
          }
        } else if (outcome === 'duplicate') showToast(t('library.remote.uploadDuplicate'), 'info');
        else void inform(t('library.remote.title'), outcome === 'timeout' ? t('library.remote.uploadTimeout') : t('library.remote.failed'));
      } catch (err) {
        console.warn('[library] remote upload failed', err);
        void inform(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        setLmBusy(false);
      }
    })();
  };

  // conflicts demand an explicit choice (spec §8): no silent newest-wins. A
  // raced 409 on the chosen write re-opens the same question with fresh data.
  const askConflictChoice = (conflict: LmConflict): Promise<'server' | 'local' | null> =>
    new Promise((resolve) => {
      dialogAlert(
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
          onLink: (localId, remoteId, versionId) => {
            void services.remoteSync.linkBook({ bookId: localId, spaceId: space.id, serverBookId: remoteId, versionId });
          },
        }, space.id, remoteBooks ?? []);
        for (const conflict of summary.conflicts) {
          await resolveConflict(space.id, installationId, conflict);
        }
        void inform(t('library.remote.title'), t('library.remote.syncDone', {
          pulled: summary.pulled, pushed: summary.pushed, inSync: summary.inSync,
          none: summary.none, failed: summary.failed, conflicts: summary.conflicts.length,
        }));
        await refresh();
      } catch (err) {
        console.warn('[library] remote progress sync failed', err);
        void inform(t('library.remote.title'), lmErrorMessage(err, t));
      } finally {
        setLmBusy(false);
      }
    })();
  };

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
              onLongPress={() => (selectionMode ? toggleSelect(item.id) : openMenu(item))}
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
            <Pressable style={styles.sheetRow} onPress={() => { void inform(t('library.menu.info'), `${menuBook?.title ?? ''}\n${menuBook?.author ?? ''} · ${menuBook ? formatBytes(menuBook.fileSize, lang) : ''}`); setMenuBook(null); }}>
              <Ionicons name="information-circle-outline" size={20} color={t0.foreground} />
              <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.menu.info')}</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={() => { const b = menuBook!; setMenuBook(null); setEditBook(b); }}>
              <Ionicons name="create-outline" size={20} color={t0.foreground} />
              <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.edit')}</Text>
            </Pressable>
            {lmConnected && menuBook && UPLOAD_FORMATS.has(menuBook.format) ? (
              <Pressable style={styles.sheetRow} onPress={() => { const b = menuBook!; setMenuBook(null); uploadLocal(b); }}>
                <Ionicons name="cloud-upload-outline" size={20} color={t0.foreground} />
                <Text style={[styles.sheetRowText, { color: t0.foreground }]}>{t('library.menu.upload')}</Text>
              </Pressable>
            ) : null}
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
            <Pressable style={styles.sheetRow} onPress={() => { const b = menuBook!; setMenuBook(null); void (async () => { if (!(await confirm({ title: t('common.delete'), message: b.title, confirmLabel: t('common.confirm'), destructive: true }))) return; await deleteBook(b); })(); }}>
              <Ionicons name="trash-outline" size={20} color={t0.danger} />
              <Text style={[styles.sheetRowText, { color: t0.danger }]}>{t('library.menu.delete')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={remoteSheet} transparent animationType="fade" onRequestClose={() => setRemoteSheet(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setRemoteSheet(false)}>
          <View
            style={[styles.sheet, { backgroundColor: t0.chrome, paddingBottom: 16 + insets.bottom, height: '100%' }]}
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
                <Pressable style={styles.sheetRow} onPress={() => { setActiveSpace(null); setRemoteBooks(null); setRemoteQuery(''); setRemoteSeries(null); setRemoteSelection(new Set()); }} disabled={lmBusy}>
                  <Ionicons name="arrow-back" size={20} color={t0.foreground} />
                  <Text numberOfLines={1} style={[styles.sheetRowText, styles.sheetRowMain, { color: t0.foreground }]}>{activeSpace.name}</Text>
                  <Pressable onPress={syncProgress} disabled={lmBusy} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('library.remote.syncProgress')}>
                    <Ionicons name="sync-outline" size={22} color={t0.foreground} />
                  </Pressable>
                </Pressable>
                <View style={[styles.search, { backgroundColor: t0.chrome, borderColor: t0.border }]}>
                  <Ionicons name="search" size={16} color={t0.muted} />
                  <TextInput
                    style={[styles.searchInput, { color: t0.foreground }]}
                    placeholder={t('library.remote.searchPlaceholder')}
                    placeholderTextColor={t0.muted}
                    value={remoteQuery}
                    onChangeText={setRemoteQuery}
                    autoCorrect={false}
                  />
                  {remoteQuery.length > 0 ? (
                    <Pressable onPress={() => setRemoteQuery('')} hitSlop={8} accessibilityRole="button" accessibilityLabel={t('library.remote.searchClear')}>
                      <Ionicons name="close-circle" size={16} color={t0.muted} />
                    </Pressable>
                  ) : null}
                </View>
                <SeriesSelect
                  value={remoteSeries}
                  onChange={(series) => { setRemoteSeries(series); }}
                  loadOptions={(prefix) => {
                    const client = lmClientRef.current;
                    const sp = activeSpace;
                    if (!client || !sp) return Promise.resolve([]);
                    return client
                      .listBooks(sp.id, { search: prefix || undefined, pageSize: 100 })
                      .then((page) => [...new Set(page.items.map((b) => b.series).filter((s): s is string => Boolean(s)))].sort((a, b) => a.localeCompare(b)))
                      .catch(() => []);
                  }}
                />
                {remoteSelection.size > 0 ? (
                  <View style={[styles.selectionBar, { backgroundColor: t0.chrome, borderColor: t0.border }]}>
                    <Pressable onPress={() => setRemoteSelection(new Set())} accessibilityLabel={t('library.exitSelection')} hitSlop={8}>
                      <Ionicons name="close" size={22} color={t0.foreground} />
                    </Pressable>
                    <Text style={[styles.selectionCount, { color: t0.foreground }]}>{t('library.selected', { count: remoteSelection.size })}</Text>
                    <Pressable onPress={bulkTransfer} accessibilityLabel={t('library.remote.transferBulk', { count: remoteSelection.size })} accessibilityRole="button" hitSlop={8} disabled={lmBusy} style={styles.selectionAction}>
                      <Ionicons name="cloud-download-outline" size={22} color={t0.accent} />
                    </Pressable>
                  </View>
                ) : null}
                {lmBusy ? <ActivityIndicator style={{ paddingVertical: 8 }} color={t0.muted} /> : null}
                <Text style={[styles.sheetSection, { color: t0.muted }]}>
                  {remoteQuery.trim() ? t('library.remote.results', { count: (remoteBooks ?? []).length }) : t('library.remote.onServer', { count: remoteTotal ?? (remoteBooks ?? []).length })}
                </Text>
                <FlatList
                  data={remoteBooks ?? []}
                  // key remount on column change, same rule as the library grid
                  key={`remote-grid-${columns}`}
                  numColumns={columns}
                  keyExtractor={(b) => b.id}
                  onEndReached={remoteCursor ? loadMoreRemote : undefined}
                  onEndReachedThreshold={0.5}
                  style={styles.sheetScroll}
                  ListEmptyComponent={!lmBusy ? (
                    <Text style={[styles.remoteEmpty, { color: t0.muted }]}>{t('library.remote.empty')}</Text>
                  ) : null}
                  renderItem={({ item }) => (
                    <RemoteBookGridItem
                      book={item}
                      inLibrary={matchedRemoteIds().has(item.id)}
                      // long-press checks the book (bulk selection); a tap
                      // offers the single transfer outside selection mode
                      onLongPress={() => toggleRemoteSelection(item)}
                      onPress={() => (remoteSelection.size > 0 ? toggleRemoteSelection(item) : askTransfer(item))}
                      onInfo={() => showRemoteInfo(item)}
                      selectionMode={remoteSelection.size > 0}
                      selected={remoteSelection.has(item.id)}
                      loadCover={() => {
                        const client = lmClientRef.current;
                        const sp = activeSpace;
                        if (!client || !sp) return Promise.resolve(null);
                        return (async () => {
                          const version = await readyDetails(client, sp.id, item.id);
                          if (!version) return null;
                          return ensureCoverFile(
                            {
                              client,
                              fs: services.fs,
                              coverPaths: (vid) => ({
                                bytes: `${services.paths.coversDir}/remote/${vid}-cover_v1.webp`,
                                etag: `${services.paths.coversDir}/remote/${vid}-cover_v1.etag`,
                              }),
                            },
                            sp.id,
                            item.id,
                            version.id,
                          );
                        })().catch(() => null);
                      }}
                    />
                  )}
                />
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
