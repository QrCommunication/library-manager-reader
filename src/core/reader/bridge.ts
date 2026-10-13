import { parseMessage } from '../bridge/codec';
import { PROTOCOL_VERSION, type AppToEngine, type EngineMetadataPayload, type EngineToApp } from '../bridge/protocol';
import type { BookFormat, HighlightColor, ReaderSettings, SelectionRect, TocItem } from '../types';
import type { BookTransport } from './bookTransport';

type Send = (raw: string) => void;

export interface SelectionPayload { text: string | null; rect: SelectionRect | null; cfi: string | null; lang: string | null }
export interface SearchResultPayload { cfi: string; excerpt: string; fraction: number }
export interface TtsSentencePayload { text: string; cfi: string | null }

export class ReaderBridge {
  private readyPromise: Promise<number>;
  private resolveReady!: (v: number) => void;
  private progressCbs = new Set<(p: { cfi: string | null; fraction: number; sectionIndex: number | null }) => void>();
  private errorCbs = new Set<(e: { code: string; message: string }) => void>();
  private selectionCbs = new Set<(s: SelectionPayload) => void>();
  private searchResultCbs = new Set<(r: SearchResultPayload) => void>();
  private searchDoneCbs = new Set<(count: number) => void>();
  private ttsSentenceCbs = new Set<(s: TtsSentencePayload) => void>();
  private chromeToggleCbs = new Set<() => void>();
  private bookLoadedWaiter: { resolve: (v: { toc: TocItem[]; metadata: EngineMetadataPayload }) => void; reject: (e: Error) => void } | null = null;
  private ackWaiters: ((seq: number) => void)[] = [];
  private lastAck = -1;
  private bookmarkWaiter: { resolve: (v: { target: string; fraction: number; excerpt: string }) => void; timer: ReturnType<typeof setTimeout> } | null = null;

  constructor(private send: Send, private transport: BookTransport) {
    this.readyPromise = new Promise((resolve) => { this.resolveReady = resolve; });
  }

  whenReady(): Promise<number> { return this.readyPromise; }

  handleRaw(raw: string): void {
    const msg = parseMessage(raw);
    if (msg.type === 'unknown') { console.warn('[bridge] unknown engine message', raw); return; }
    this.handle(msg);
  }

  private handle(msg: AppToEngine | EngineToApp): void {
    switch (msg.type) {
      case 'engineReady':
        this.resolveReady(msg.protocolVersion);
        break;
      case 'dataAck': {
        this.lastAck = msg.seq;
        const w = this.ackWaiters.shift();
        w?.(msg.seq);
        break;
      }
      case 'bookLoaded':
        this.bookLoadedWaiter?.resolve({ toc: msg.toc, metadata: msg.metadata });
        this.bookLoadedWaiter = null;
        break;
      case 'progress':
        for (const cb of this.progressCbs) cb({ cfi: msg.cfi, fraction: msg.fraction, sectionIndex: msg.sectionIndex });
        break;
      case 'bookmarkCaptured':
        if (this.bookmarkWaiter) {
          clearTimeout(this.bookmarkWaiter.timer);
          this.bookmarkWaiter.resolve({ target: msg.target, fraction: msg.fraction, excerpt: msg.excerpt });
          this.bookmarkWaiter = null;
        }
        break;
      case 'engineError':
        for (const cb of this.errorCbs) cb({ code: msg.code, message: msg.message });
        this.bookLoadedWaiter?.reject(new Error(`${msg.code}: ${msg.message}`));
        this.bookLoadedWaiter = null;
        break;
      case 'selectionChanged':
        for (const cb of this.selectionCbs) cb({ text: msg.text, rect: msg.rect, cfi: msg.cfi, lang: msg.lang });
        break;
      case 'searchResult':
        for (const cb of this.searchResultCbs) cb({ cfi: msg.cfi, excerpt: msg.excerpt, fraction: msg.fraction });
        break;
      case 'searchDone':
        for (const cb of this.searchDoneCbs) cb(msg.count);
        break;
      case 'ttsSentence':
        for (const cb of this.ttsSentenceCbs) cb({ text: msg.text, cfi: msg.cfi });
        break;
      case 'chromeToggle':
        for (const cb of this.chromeToggleCbs) cb();
        break;
      default:
        break;
    }
  }

  private emit(msg: AppToEngine): void { this.send(JSON.stringify(msg)); }

  private waitForAck(seq: number): Promise<void> {
    if (this.lastAck >= seq) return Promise.resolve();
    return new Promise((resolve) => this.ackWaiters.push(() => resolve()));
  }

  async openBook(args: { format: BookFormat; path: string; size: number }): Promise<{ toc: TocItem[]; metadata: EngineMetadataPayload }> {
    const v = await this.whenReady();
    if (v !== PROTOCOL_VERSION) throw new Error('engine protocol mismatch');
    this.lastAck = -1;
    this.emit({ type: 'openBook', format: args.format, size: args.size });
    const done = new Promise<{ toc: TocItem[]; metadata: EngineMetadataPayload }>((resolve, reject) => {
      this.bookLoadedWaiter = { resolve, reject };
    });
    await this.transport.read(
      { path: args.path, size: args.size },
      async (base64, seq) => {
        this.emit({ type: 'data', seq, base64 });
        await this.waitForAck(seq);
      },
    );
    this.emit({ type: 'dataEnd' });
    return done;
  }

  // Bookmark fallback targets are `fraction:<n>` (engine sends them when no cfi
  // exists), but the engine only understands goToFraction for those — a raw
  // goTo('fraction:0.42') would throw silently deep in foliate.
  goTo(target: string): void {
    const m = /^fraction:(0?\d(?:\.\d+)?|1(?:\.0+)?)$/.exec(target);
    if (m) { this.goToFraction(parseFloat(m[1]!)); return; }
    this.emit({ type: 'goTo', target });
  }
  goToFraction(fraction: number): void { this.emit({ type: 'goToFraction', fraction }); }
  next(): void { this.emit({ type: 'next' }); }
  prev(): void { this.emit({ type: 'prev' }); }
  applySettings(settings: ReaderSettings): void { this.emit({ type: 'applySettings', settings }); }

  captureBookmark(): Promise<{ target: string; fraction: number; excerpt: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('captureBookmark timeout')), 5000);
      this.bookmarkWaiter = { resolve, timer };
      this.emit({ type: 'captureBookmark' });
    });
  }

  onProgress(cb: (p: { cfi: string | null; fraction: number; sectionIndex: number | null }) => void): () => void {
    this.progressCbs.add(cb);
    return () => this.progressCbs.delete(cb);
  }
  onEngineError(cb: (e: { code: string; message: string }) => void): () => void {
    this.errorCbs.add(cb);
    return () => this.errorCbs.delete(cb);
  }

  addHighlight(id: string, cfi: string, color: HighlightColor): void { this.emit({ type: 'addHighlight', id, cfi, color }); }
  removeHighlight(id: string): void { this.emit({ type: 'removeHighlight', id }); }
  copySelection(): void { this.emit({ type: 'copySelection' }); }
  search(query: string): void { this.emit({ type: 'search', query }); }
  searchCancel(): void { this.emit({ type: 'searchCancel' }); }
  ttsStart(cfi: string | null): void { this.emit({ type: 'ttsStart', cfi }); }
  ttsStop(): void { this.emit({ type: 'ttsStop' }); }
  ttsNext(): void { this.emit({ type: 'ttsNext' }); }

  onSelectionChanged(cb: (s: SelectionPayload) => void): () => void { this.selectionCbs.add(cb); return () => this.selectionCbs.delete(cb); }
  onSearchResult(cb: (r: SearchResultPayload) => void): () => void { this.searchResultCbs.add(cb); return () => this.searchResultCbs.delete(cb); }
  onSearchDone(cb: (count: number) => void): () => void { this.searchDoneCbs.add(cb); return () => this.searchDoneCbs.delete(cb); }
  onTtsSentence(cb: (s: TtsSentencePayload) => void): () => void { this.ttsSentenceCbs.add(cb); return () => this.ttsSentenceCbs.delete(cb); }
  onChromeToggle(cb: () => void): () => void { this.chromeToggleCbs.add(cb); return () => this.chromeToggleCbs.delete(cb); }
}
