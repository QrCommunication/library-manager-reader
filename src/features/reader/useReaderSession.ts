import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Appearance } from 'react-native';
import { useServices, type AppServices } from '../../core/services';
import { ReaderBridge, type SearchResultPayload, type SelectionPayload, type TtsSentencePayload } from '../../core/reader/bridge';
import { pullReadingPosition, pushReadingPosition } from '../../core/remote/readingSync';
import { createBase64BookTransport } from '../../core/reader/bookTransport';
import { useReaderSettingsStore } from '../settings/readerSettingsStore';
import { resolveTheme } from '../../core/types';
import type { BookFormat, HighlightColor, ReaderSettings, TocItem } from '../../core/types';

export interface BridgeLike {
  openBook(a: { format: BookFormat; path: string; size: number; resume?: { cfi?: string | null; fraction?: number } | null }): Promise<{ toc: TocItem[]; metadata: unknown }>;
  goTo(t: string): void;
  goToFraction(f: number): void;
  next(): void;
  prev(): void;
  applySettings(s: ReaderSettings): void;
  onProgress(cb: (p: { cfi: string | null; fraction: number; sectionIndex: number | null }) => void): () => void;
  onEngineError(cb: (e: { code: string; message: string }) => void): () => void;
  onResumeApplied(cb: () => void): () => void;
  whenReady(): Promise<number>;
  addHighlight(id: string, cfi: string, color: HighlightColor): void;
  removeHighlight(id: string): void;
  copySelection(): void;
  search(query: string): void;
  searchCancel(): void;
  ttsStart(cfi: string | null): void;
  ttsStop(): void;
  ttsNext(): void;
  onSelectionChanged(cb: (s: SelectionPayload) => void): () => void;
  onSearchResult(cb: (r: SearchResultPayload) => void): () => void;
  onSearchDone(cb: (count: number) => void): () => void;
  onTtsSentence(cb: (s: TtsSentencePayload) => void): () => void;
  onChromeToggle(cb: () => void): () => void;
  onOpenSettings(cb: () => void): () => void;
}

export interface ReaderSessionDeps {
  getBook(id: string): Promise<{ title: string; format: BookFormat; fileName: string; fileSize: number } | null>;
  getProgress(bookId: string): Promise<{ cfi: string | null; fraction: number } | null>;
  fileExists(fileName: string): Promise<boolean>;
  bookPath(fileName: string): string;
  saveProgress(p: { cfi: string | null; fraction: number; sectionIndex: number | null }): Promise<void>;
  touchLastRead(): Promise<void>;
  makeBridge(): BridgeLike;
}

export function createDefaultDeps(bookId: string, services: AppServices): ReaderSessionDeps {
  return {
    getBook: async (id) => {
      const b = await services.books.getBook(id);
      return b ? { title: b.title, format: b.format, fileName: b.fileName, fileSize: b.fileSize } : null;
    },
    getProgress: async (id) => {
      // cloud pull rides the session's own progress read: if the server holds a
      // strictly newer position for this linked book, the open lands there
      await pullReadingPosition(services, id);
      const p = await services.progress.getProgress(id);
      return p ? { cfi: p.cfi, fraction: p.fraction } : null;
    },
    fileExists: (fileName) => services.fs.exists(`${services.paths.booksDir}/${fileName}`),
    bookPath: (fileName) => `${services.paths.booksDir}/${fileName}`,
    saveProgress: (p) => {
      // journal + background push to library-manager.com when this book is
      // cloud-linked; offline the op stays in SQLite until connectivity
      void pushReadingPosition(services, bookId, { cfi: p.cfi, fraction: p.fraction });
      return services.progress.saveProgress({ bookId, ...p, updatedAt: Date.now() });
    },
    touchLastRead: () => services.books.touchLastRead(bookId, Date.now()),
    makeBridge: () => new ReaderBridge((raw) => bridgeTarget.current(raw), createBase64BookTransport(services.fs)),
  };
}

// sender target swapped to the real WebView once mounted (see EngineWebView)
export const bridgeTarget: { current: (raw: string) => void } = {
  current: () => { /* dropped pre-mount; engine buffers nothing and we only send after engineReady */ },
};

function useServicesOrNull(): AppServices | null {
  // probing wrapper: injected-deps tests render without a ServicesProvider (where
  // useServices() throws); the real screen always renders inside the provider.
  try {
    return useServices();
  } catch {
    return null;
  }
}

export function useReaderSession(bookId: string, depsOverride?: ReaderSessionDeps) {
  const services = useServicesOrNull();
  const defaultDeps = useMemo(
    () => (services ? createDefaultDeps(bookId, services) : null),
    [bookId, services],
  );
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [errorKind, setErrorKind] = useState<'missing' | 'open_failed'>('open_failed');
  const [toc, setToc] = useState<TocItem[]>([]);
  const [title, setTitle] = useState<string | null>(null);
  // book language from the engine metadata — drives the TTS voice (TtsBar)
  const [language, setLanguage] = useState<string | null>(null);
  const [fraction, setFraction] = useState(0);
  // render-visible session state (ReaderScreen gates on it), not a ref
  const [bridge, setBridge] = useState<BridgeLike | null>(null);
  // survives unmount/retry so a post-crash reload reopens at the last known spot
  const lastKnownRef = useRef<{ bookId: string; cfi: string | null; fraction: number; sectionIndex: number | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => setNonce((n) => n + 1), []);

  // reset to 'loading' whenever the session is re-triggered (retry / book change),
  // mirroring the effect deps below; done during render per the React
  // "adjusting state when a key changes" pattern instead of the effect body.
  // Nulling the bridge unmounts EngineWebView so a retry boots a FRESH engine
  // page — a page that already sent engineReady can never ready the new bridge.
  const [sessionKey, setSessionKey] = useState({ bookId, nonce, defaultDeps, depsOverride });
  if (
    sessionKey.bookId !== bookId ||
    sessionKey.nonce !== nonce ||
    sessionKey.defaultDeps !== defaultDeps ||
    sessionKey.depsOverride !== depsOverride
  ) {
    setSessionKey({ bookId, nonce, defaultDeps, depsOverride });
    setState('loading');
    setBridge(null);
  }

  useEffect(() => {
    let cancelled = false;
    const deps = depsOverride ?? defaultDeps;
    if (!deps) return;
    let offProgress: (() => void) | undefined;
    let offResume: (() => void) | undefined;
    let lastSave = 0;
    let latest: { cfi: string | null; fraction: number; sectionIndex: number | null } | null = null;
    void (async () => {
      const book = await deps.getBook(bookId);
      if (!book || !(await deps.fileExists(book.fileName))) {
        if (!cancelled) { setErrorKind('missing'); setState('error'); }
        return;
      }
      const bridge = deps.makeBridge();
      setBridge(bridge);
      // persistence gate: closed until the engine confirms the resume applied.
      // foliate emits a relocate (fraction≈0) right after load; without the gate
      // that first event would save fraction≈0 over the stored row AND seed
      // lastKnownRef with book-start, forcing the resume back to the beginning.
      let resumed = false;
      offProgress = bridge.onProgress((p) => {
        if (!resumed) return;
        const f = Math.min(1, Math.max(0, p.fraction));
        latest = { cfi: p.cfi, fraction: f, sectionIndex: p.sectionIndex };
        lastKnownRef.current = { bookId, cfi: p.cfi, fraction: f, sectionIndex: p.sectionIndex };
        setFraction(f);
        if (Date.now() - lastSave > 1000) { lastSave = Date.now(); void deps.saveProgress({ cfi: p.cfi, fraction: f, sectionIndex: p.sectionIndex }); void deps.touchLastRead(); }
      });
      bridge.onEngineError(() => { if (!cancelled) { setErrorKind('open_failed'); setState('error'); } });
      const offResume = bridge.onResumeApplied(() => { resumed = true; });
      try {
        // resume travels INSIDE openBook: the engine applies it via
        // view.init({lastLocation}) after the first render — one navigation in
        // the same task as init, immune to the old post-open goTo race
        const prog = await deps.getProgress(bookId);
        const lastKnown = lastKnownRef.current?.bookId === bookId ? lastKnownRef.current : null;
        const resume = lastKnown
          ? { cfi: lastKnown.cfi, fraction: lastKnown.fraction }
          : prog ? { cfi: prog.cfi, fraction: prog.fraction } : null;
        const loaded = await bridge.openBook({ format: book.format, path: deps.bookPath(book.fileName), size: book.fileSize, resume });
        // theme resolved BEFORE transmission: the engine only knows concrete
        // themes (its cssFor still defaults 'auto'→'day' defensively). The
        // scheme is read imperatively (not the hook) so the value is current at
        // apply time without re-running the open flow on later scheme flips —
        // ReaderScreen owns the reactive re-apply. 'unspecified' normalizes to
        // null (resolveTheme's undetermined case).
        const openSettings = useReaderSettingsStore.getState().settings;
        const scheme = Appearance.getColorScheme();
        const systemScheme: 'light' | 'dark' | null = scheme === 'light' || scheme === 'dark' ? scheme : null;
        bridge.applySettings({ ...openSettings, theme: resolveTheme(openSettings.theme, systemScheme) });
        if (!cancelled) {
          setToc(loaded.toc);
          setTitle(book.title);
          // engine normalizes metadata to BookMetadata (language: string | null)
          setLanguage((loaded.metadata as { language?: string | null } | null)?.language ?? null);
          setState('ready');
        }
      } catch {
        if (!cancelled) { setErrorKind('open_failed'); setState('error'); }
      }
    })();
    return () => {
      cancelled = true;
      offProgress?.();
      offResume?.();
      if (latest) { void deps.saveProgress({ ...latest }); }
    };
  }, [bookId, nonce, defaultDeps, depsOverride]);

  return { state, errorKind, toc, title, language, fraction, bridge, retry };
}
