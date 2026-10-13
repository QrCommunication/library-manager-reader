import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useServices, type AppServices } from '../../core/services';
import { ReaderBridge } from '../../core/reader/bridge';
import { createBase64BookTransport } from '../../core/reader/bookTransport';
import { useReaderSettingsStore } from '../settings/readerSettingsStore';
import type { BookFormat, ReaderSettings, TocItem } from '../../core/types';

export interface BridgeLike {
  openBook(a: { format: BookFormat; path: string; size: number }): Promise<{ toc: TocItem[]; metadata: unknown }>;
  goTo(t: string): void;
  goToFraction(f: number): void;
  next(): void;
  prev(): void;
  applySettings(s: ReaderSettings): void;
  onProgress(cb: (p: { cfi: string | null; fraction: number; sectionIndex: number | null }) => void): () => void;
  onEngineError(cb: (e: { code: string; message: string }) => void): () => void;
  whenReady(): Promise<number>;
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
      const p = await services.progress.getProgress(id);
      return p ? { cfi: p.cfi, fraction: p.fraction } : null;
    },
    fileExists: (fileName) => services.fs.exists(`${services.paths.booksDir}/${fileName}`),
    bookPath: (fileName) => `${services.paths.booksDir}/${fileName}`,
    saveProgress: (p) => services.progress.saveProgress({ bookId, ...p, updatedAt: Date.now() }),
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
  const [fraction, setFraction] = useState(0);
  // render-visible session state (ReaderScreen gates on it), not a ref
  const [bridge, setBridge] = useState<BridgeLike | null>(null);
  // survives unmount/retry so a post-crash reload reopens at the last known spot
  const lastKnownRef = useRef<{ bookId: string; cfi: string | null; fraction: number; sectionIndex: number | null } | null>(null);
  const [nonce, setNonce] = useState(0);
  const retry = useCallback(() => setNonce((n) => n + 1), []);

  // reset to 'loading' whenever the session is re-triggered (retry / book change),
  // mirroring the effect deps below; done during render per the React
  // "adjusting state when a key changes" pattern instead of the effect body
  const [sessionKey, setSessionKey] = useState({ bookId, nonce, defaultDeps, depsOverride });
  if (
    sessionKey.bookId !== bookId ||
    sessionKey.nonce !== nonce ||
    sessionKey.defaultDeps !== defaultDeps ||
    sessionKey.depsOverride !== depsOverride
  ) {
    setSessionKey({ bookId, nonce, defaultDeps, depsOverride });
    setState('loading');
  }

  useEffect(() => {
    let cancelled = false;
    const deps = depsOverride ?? defaultDeps;
    if (!deps) return;
    let offProgress: (() => void) | undefined;
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
      offProgress = bridge.onProgress((p) => {
        const f = Math.min(1, Math.max(0, p.fraction));
        latest = { cfi: p.cfi, fraction: f, sectionIndex: p.sectionIndex };
        lastKnownRef.current = { bookId, cfi: p.cfi, fraction: f, sectionIndex: p.sectionIndex };
        setFraction(f);
        if (Date.now() - lastSave > 1000) { lastSave = Date.now(); void deps.saveProgress({ cfi: p.cfi, fraction: f, sectionIndex: p.sectionIndex }); void deps.touchLastRead(); }
      });
      bridge.onEngineError(() => { if (!cancelled) { setErrorKind('open_failed'); setState('error'); } });
      try {
        const loaded = await bridge.openBook({ format: book.format, path: deps.bookPath(book.fileName), size: book.fileSize });
        bridge.applySettings(useReaderSettingsStore.getState().settings);
        const prog = await deps.getProgress(bookId);
        const lastKnown = lastKnownRef.current?.bookId === bookId ? lastKnownRef.current : null;
        if (lastKnown) {
          if (lastKnown.cfi) bridge.goTo(lastKnown.cfi);
          else bridge.goToFraction(lastKnown.fraction);
        } else if (prog?.cfi) bridge.goTo(prog.cfi);
        else if (prog) bridge.goToFraction(prog.fraction);
        if (!cancelled) { setToc(loaded.toc); setTitle(book.title); setState('ready'); }
      } catch {
        if (!cancelled) { setErrorKind('open_failed'); setState('error'); }
      }
    })();
    return () => {
      cancelled = true;
      offProgress?.();
      if (latest) { void deps.saveProgress({ ...latest }); }
    };
  }, [bookId, nonce, defaultDeps, depsOverride]);

  return { state, errorKind, toc, title, fraction, bridge, retry };
}
