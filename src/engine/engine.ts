import { PROTOCOL_VERSION, type AppToEngine, type EngineToApp } from '../core/bridge/protocol';
import { View } from 'foliate-js/view.js';
import { Overlayer } from 'foliate-js/overlayer.js';
import { createChunkAssembler } from './chunkAssembler';
import { convertCbrToCbz } from './extractMode';
import { fractionForSection } from './searchFraction';
import { createExtractorFromData } from 'node-unrar-js';
import { zipSync, strToU8 } from 'fflate';
import type { HighlightColor, OriginalFormat, ReaderSettings, TocItem } from '../core/types';

declare const __LITERATA_B64__: string;
declare const __UNRAR_WASM_B64__: string;

// node-unrar-js wasm, inlined at build time (build-engine.mjs define). The engine html is
// inlined into the WebView with no base URL, so unrar's emscripten glue could never fetch
// "unrar.wasm"; handing the real bytes to createExtractorFromData({ wasmBinary }) makes the
// glue skip every fetch/XHR path. Decoded lazily (memoized): only the CBR path pays for it.
let unrarWasmBinary: ArrayBuffer | null = null;
function getUnrarWasmBinary(): ArrayBuffer {
  if (!unrarWasmBinary) {
    const bin = atob(__UNRAR_WASM_B64__);
    const ab = new ArrayBuffer(bin.length);
    const bytes = new Uint8Array(ab);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    unrarWasmBinary = ab;
  }
  return unrarWasmBinary;
}

function send(msg: EngineToApp): void {
  // @ts-expect-error RN webview injection
  const w = window.ReactNativeWebView;
  const payload = JSON.stringify(msg);
  if (w) w.postMessage(payload);
  else console.log('[engine→app]', payload);
}

type Handler = (msg: AppToEngine) => void;
const handlers = new Set<Handler>();

export function onAppMessage(h: Handler): () => void {
  handlers.add(h);
  return () => handlers.delete(h);
}

function receive(raw: unknown): void {
  const data = typeof raw === 'string' ? raw : (raw as { data?: unknown })?.data;
  if (typeof data !== 'string') return;
  try {
    const msg = JSON.parse(data) as AppToEngine;
    for (const h of handlers) h(msg);
  } catch {
    console.log('[engine] unparseable message');
  }
}

// react-native-webview delivers RN→Web posts on `document` (Android) and `window` (iOS)
document.addEventListener('message', receive as EventListener);
window.addEventListener('message', receive as EventListener);

send({ type: 'engineReady', protocolVersion: PROTOCOL_VERSION });

const container = document.getElementById('book')!;
// installed foliate View is a custom element (<foliate-view>): no constructor args, must be in the DOM
const view = new View();
container.append(view);

let lastFraction = 0;
// flips true when a book/extract document finished loading; pre-open
// navigation/settings are sanctioned quiet no-ops (foliate throws on an
// unloaded book and the app legitimately probes before the chunk stream ends)
let documentLoaded = false;

const toToc = (items: unknown): TocItem[] =>
  ((items ?? []) as { label?: string; href?: string; subitems?: unknown }[]).map((it) => ({
    label: it.label ?? '',
    target: it.href ?? null,
    children: it.subitems ? toToc(it.subitems) : undefined,
  }));

const cssFor = (s: ReaderSettings): string => {
  const themes = {
    day: { bg: '#FFFFFF', fg: '#1A1A1A', link: '#2D6CDF' },
    sepia: { bg: '#F4ECD8', fg: '#3B2F1E', link: '#8B5E34' },
    night: { bg: '#101314', fg: '#D7DBDC', link: '#7FB4C9' },
  } as const;
  const t = themes[s.theme];
  const family = s.fontFamily === 'sans' ? 'system-ui, sans-serif'
    : s.fontFamily === 'literata' ? 'Literata, serif' : 'Georgia, serif';
  return `@namespace epub "http://www.idpf.org/2007/ops";
    body{background:${t.bg};color:${t.fg};font-family:${family};font-size:${s.fontSize}px;line-height:${s.lineHeight};}
    a{color:${t.link};}
    p{margin:0 0 ${Math.round(s.fontSize * 0.6)}px 0;}`;
};

const applySettings = (s: ReaderSettings): void => {
  view.renderer.setStyles?.(cssFor(s));
  Object.assign(container.style, {
    padding: `${s.margin}px`,
    background: { day: '#FFFFFF', sepia: '#F4ECD8', night: '#101314' }[s.theme],
  });
};

let bookLanguage: string | null = null;
let selectionTimer: ReturnType<typeof setTimeout> | null = null;

const sendSelection = (doc: Document, index: number): void => {
  const sel = doc.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed || sel.toString().trim() === '') {
    send({ type: 'selectionChanged', text: null, rect: null, cfi: null, lang: null });
    return;
  }
  const range = sel.getRangeAt(0);
  let cfi: string | null = null;
  try { cfi = view.getCFI(index, range); } catch { cfi = null; }
  const r = range.getBoundingClientRect();
  send({
    type: 'selectionChanged',
    text: sel.toString(),
    rect: { x: r.x, y: r.y, width: r.width, height: r.height },
    cfi,
    lang: bookLanguage,
  });
};

const queueSelection = (doc: Document, index: number): void => {
  if (selectionTimer) clearTimeout(selectionTimer);
  // trailing debounce: the selection settles while the user drags the handles
  selectionTimer = setTimeout(() => { selectionTimer = null; sendSelection(doc, index); }, 200);
};

view.addEventListener('load', (e: Event) => {
  documentLoaded = true;
  // 'load' fires per section display (and per book open): a selection debounce
  // pending from the previous section doc must not emit after navigation, and a
  // queued highlight replay belongs to the previous layout as well
  if (selectionTimer) { clearTimeout(selectionTimer); selectionTimer = null; }
  if (highlightReplayTimer) { clearTimeout(highlightReplayTimer); highlightReplayTimer = null; }
  // installed foliate View emits 'load' with { doc, index }; toc/metadata live on view.book
  const detail = (e as CustomEvent).detail as { doc?: Document; index?: number } | undefined;
  bookLanguage = view.book?.metadata?.language ?? null;
  if (detail?.doc) {
    const doc = detail.doc;
    const index = detail.index ?? 0;
    // the paginator emits no selection events: watch the section doc ourselves
    doc.addEventListener('selectionchange', () => queueSelection(doc, index));
  }
  const book = view.book;
  send({
    type: 'bookLoaded',
    toc: toToc(book?.toc),
    metadata: {
      title: book?.metadata?.title ?? null, author: book?.metadata?.author ?? null,
      language: book?.metadata?.language ?? null, publisher: book?.metadata?.publisher ?? null,
      identifier: book?.metadata?.identifier ?? null, coverJpegBase64: null,
    },
  });
});

// Full-book search over foliate's async search generator, which streams
// {progress} / {label, subitems} / {cfi, excerpt} then 'done'. Results are
// capped and token-guarded: every new search (and searchCancel) bumps
// searchToken, so a superseded iteration stops emitting and drops its
// searchDone — the app receives exactly one searchDone per accepted search.
const SEARCH_RESULT_CAP = 200;
let searchToken = 0;
// approximate per-section fraction for the result list, fed by relocate below
let sectionCount = 0;

// foliate exposes no per-CFI fraction: resolve the hit's section index and
// report its midpoint position (pure math in searchFraction.ts), 0 on failure
const fractionForCfi = async (cfi: string): Promise<number> => {
  try {
    const { index } = await view.resolveNavigation(cfi);
    return fractionForSection(index, sectionCount);
  } catch { return 0; }
};

view.addEventListener('relocate', (e: Event) => {
  const d = (e as CustomEvent).detail;
  lastFraction = d?.fraction ?? lastFraction;
  // installed foliate relocate detail has section: { current, total }
  sectionCount = d?.section?.total ?? sectionCount;
  send({ type: 'progress', cfi: d?.cfi ?? null, fraction: d?.fraction ?? 0, sectionIndex: d?.section?.current ?? null });
});

// Highlights are drawn inside the engine via foliate's Overlayer. The record map
// is keyed by annotation id so 'draw-annotation' can resolve the color, and so a
// repeated addHighlight with the same id recolors in place (addAnnotation removes
// then re-draws the overlay for the same CFI).
const HIGHLIGHT_COLORS: Record<HighlightColor, string> = {
  yellow: '#F7D354', green: '#7DCEA0', blue: '#85C1E9', red: '#EC7063',
};

type HighlightRecord = { annotation: { id: string; value: string }; color: HighlightColor };
const highlightRecords = new Map<string, HighlightRecord>();
let highlightReplayTimer: ReturnType<typeof setTimeout> | null = null;

view.addEventListener('draw-annotation', (e: Event) => {
  const { draw, annotation } = (e as CustomEvent).detail as {
    draw: (func: typeof Overlayer.highlight, opts: { color: string }) => void;
    annotation: { id?: string };
  };
  const rec = annotation.id ? highlightRecords.get(annotation.id) : undefined;
  draw(Overlayer.highlight, { color: HIGHLIGHT_COLORS[rec?.color ?? 'yellow'] });
});

// foliate overlays do not survive a section change (the overlayer lives on the
// section doc): the demo re-calls addAnnotation for every annotation after each
// relocate, so replay all records (debounced to one pass per relocate burst)
view.addEventListener('relocate', () => {
  if (highlightReplayTimer || highlightRecords.size === 0) return;
  highlightReplayTimer = setTimeout(() => {
    highlightReplayTimer = null;
    for (const rec of highlightRecords.values()) {
      // rejects when the CFI's section is not in the viewport: expected, skip
      view.addAnnotation(rec.annotation).catch(() => { /* section absent du viewport */ });
    }
  }, 0);
});

let settings: ReaderSettings = {
  fontFamily: 'serif', fontSize: 18, lineHeight: 1.6, margin: 20, theme: 'day',
};

let assembler: ReturnType<typeof createChunkAssembler> | null = null;
let pendingExtract: { requestId: string; format: OriginalFormat } | null = null;

async function blobFromBase64(b64: string): Promise<Blob> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes]);
}

async function imagesFromRar(data: Uint8Array): Promise<{ name: string; data: Uint8Array }[]> {
  // node-unrar-js accepts an ArrayBuffer: reuse the backing buffer when the view covers it
  // exactly, else copy (avoids doubling memory for large CBRs before its own internal copy)
  const ab = data.byteOffset === 0 && data.byteLength === data.buffer.byteLength
    ? data.buffer
    : data.slice().buffer;
  const extractor = await createExtractorFromData({
    wasmBinary: getUnrarWasmBinary(),
    data: ab as ArrayBuffer,
  });
  const list = extractor.getFileList();
  const headers = [...list.fileHeaders].filter((h) => /\.(jpe?g|png|gif|webp|bmp)$/i.test(h.name));
  const extracted = extractor.extract({ files: headers.map((h) => h.name) });
  const out: { name: string; data: Uint8Array }[] = [];
  // real node-unrar-js ArcFile shape: { fileHeader: { name }, extraction?: Uint8Array }
  for (const f of extracted.files) {
    if (f.extraction) out.push({ name: f.fileHeader.name, data: new Uint8Array(f.extraction) });
  }
  return out;
}

async function coverToJpegBase64(): Promise<string | null> {
  try {
    // real foliate cover API: book.getCover() returns a Blob (reader.js wraps it via URL.createObjectURL)
    const book = view.book as unknown as { getCover?: () => Promise<Blob | null> } | undefined;
    const blob = await book?.getCover?.();
    if (!blob) return null;
    const coverUrl = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = coverUrl; });
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 512 / Math.max(img.width, img.height));
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      return dataUrl.slice(dataUrl.indexOf(',') + 1);
    } finally {
      URL.revokeObjectURL(coverUrl);
    }
  } catch {
    return null;
  }
}

async function btoaBytes(bytes: Uint8Array): Promise<string> {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}

async function finishExtract(requestId: string, format: OriginalFormat, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
  try {
    // Uint8Array<ArrayBuffer>: both sources (assembler output, zipSync output) are ArrayBuffer-backed;
    // required for BlobPart under TS 6 lib.dom strictness
    let openBytes: Uint8Array<ArrayBuffer> = bytes;
    // convertCbrToCbz takes a sync extractImages; node-unrar-js is async, so resolve the
    // image list first and hand over a sync closure (called exactly once with the rar bytes)
    if (format === 'cbr') {
      const images = await imagesFromRar(bytes);
      openBytes = convertCbrToCbz(bytes, {
        extractImages: () => images,
        zip: (files) => zipSync(Object.fromEntries(files.map((f) => [f.name, f.data])) as Record<string, Uint8Array>, { level: 6 }),
      }) as Uint8Array<ArrayBuffer>;
    }
    // attach the load listener BEFORE opening so the load event cannot be missed
    await new Promise<void>((resolve, reject) => {
      const once = () => { view.removeEventListener('load', once); resolve(); };
      view.addEventListener('load', once);
      void view.open(new Blob([openBytes])).catch(reject);
    });
    // installed foliate emits 'load' with { doc, index } only; metadata lives on view.book (as read by bookLoaded)
    const book = view.book;
    const cover = await coverToJpegBase64();
    send({
      type: 'extractResult', requestId, ok: true,
      cbzBase64: format === 'cbr' ? await btoaBytes(openBytes) : null,
      metadata: {
        title: book?.metadata?.title ?? null,
        author: book?.metadata?.author ?? null,
        language: book?.metadata?.language ?? null,
        publisher: book?.metadata?.publisher ?? null,
        identifier: book?.metadata?.identifier ?? null,
        coverJpegBase64: cover,
      },
    });
  } catch (err) {
    send({ type: 'extractResult', requestId, ok: false, error: String(err) });
  }
}

async function handle(msg: AppToEngine): Promise<void> {
  switch (msg.type) {
    case 'openBook':
      assembler = createChunkAssembler(msg.size);
      break;
    case 'extract': {
      assembler = createChunkAssembler(msg.size);
      pendingExtract = { requestId: msg.requestId, format: msg.format };
      break;
    }
    case 'data': {
      const result = assembler!.push(msg.seq, msg.base64);
      send({ type: 'dataAck', seq: msg.seq });
      if (result.complete && result.bytes) {
        if (pendingExtract) {
          const { requestId, format } = pendingExtract;
          pendingExtract = null;
          void finishExtract(requestId, format, result.bytes);
        } else {
          try { await view.open(new Blob([result.bytes])); }
          catch (err) { send({ type: 'engineError', code: 'open_failed', message: String(err) }); }
        }
      }
      break;
    }
    case 'dataEnd': break;
    case 'goTo': await view.goTo(msg.target); break;
    case 'goToFraction': await view.goToFraction(msg.fraction); break;
    case 'next': view.renderer.next(); break;
    case 'prev': view.renderer.prev(); break;
    case 'applySettings': settings = msg.settings; applySettings(msg.settings); break;
    case 'captureBookmark': {
      let excerpt = '';
      try {
        const docs = view.renderer.getContents() as { doc?: Document }[];
        excerpt = (docs[0]?.doc?.body?.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
      } catch { /* excerpt is best-effort */ }
      // installed foliate View exposes lastLocation.cfi, not currentCfi
      const cfi = (view as unknown as { lastLocation?: { cfi?: string } }).lastLocation?.cfi ?? null;
      send({ type: 'bookmarkCaptured', target: cfi ?? `fraction:${lastFraction}`, fraction: lastFraction, excerpt });
      break;
    }
    case 'copySelection': {
      // the system clipboard is fed by the webview doc holding the selection
      // (no expo-clipboard: not in the allowed dependency list)
      for (const { doc } of view.renderer.getContents()) {
        const sel = doc?.getSelection?.();
        if (sel && sel.rangeCount > 0 && !sel.isCollapsed) {
          try { doc?.execCommand('copy'); } catch { /* best effort */ }
          break;
        }
      }
      break;
    }
    case 'addHighlight': {
      // same id arriving again = recolor: keep the annotation object (foliate
      // keys overlays by CFI value) and let addAnnotation redraw it
      const existing = highlightRecords.get(msg.id);
      const annotation = existing?.annotation ?? { id: msg.id, value: msg.cfi };
      highlightRecords.set(msg.id, { annotation, color: msg.color });
      view.addAnnotation(annotation).catch((e) => console.log('[engine] addHighlight failed', e));
      break;
    }
    case 'removeHighlight': {
      const rec = highlightRecords.get(msg.id);
      if (!rec) break;
      highlightRecords.delete(msg.id);
      view.deleteAnnotation(rec.annotation).catch(() => { /* pas affiché */ });
      break;
    }
    case 'search': {
      const token = ++searchToken;
      void (async () => {
        let count = 0;
        try {
          for await (const result of view.search({ query: msg.query })) {
            if (token !== searchToken) return;
            if (result === 'done') break;
            if ('subitems' in result && result.subitems) {
              for (const item of result.subitems) {
                if (count >= SEARCH_RESULT_CAP) break;
                send({ type: 'searchResult', cfi: item.cfi, excerpt: item.excerpt, fraction: await fractionForCfi(item.cfi) });
                count++;
              }
            } else if ('cfi' in result && result.cfi) {
              if (count >= SEARCH_RESULT_CAP) break;
              send({ type: 'searchResult', cfi: result.cfi, excerpt: result.excerpt, fraction: await fractionForCfi(result.cfi) });
              count++;
            }
            if (count >= SEARCH_RESULT_CAP) break;
          }
        } catch (e) { console.log('[engine] search error', e); }
        if (token === searchToken) send({ type: 'searchDone', count });
      })();
      break;
    }
    case 'searchCancel':
      searchToken++;
      try { view.clearSearch(); } catch { /* pas encore chargé */ }
      break;
    default: break;
  }
}

// Navigation/settings arriving before the document finished loading are
// sanctioned quiet no-ops (T15/T21): foliate throws on an unloaded book and the
// app legitimately probes while chunks stream. 'copySelection' likewise needs a
// loaded doc (it walks renderer.getContents()), and search/searchCancel touch
// view.search/view.clearSearch which require an open book. Anything ELSE that
// throws is a genuine failure (size/protocol mismatch, null assembler…) and
// must reach the app as an engineError instead of being swallowed into an
// invisible hang.
const QUIET_UNTIL_LOADED = new Set<AppToEngine['type']>(['goTo', 'goToFraction', 'next', 'prev', 'applySettings', 'copySelection', 'addHighlight', 'removeHighlight', 'search', 'searchCancel']);

onAppMessage((msg) => {
  void (async () => {
    if (!documentLoaded && QUIET_UNTIL_LOADED.has(msg.type)) return;
    try {
      await handle(msg);
    } catch (err) {
      console.log('[engine] handler error', err);
      send({ type: 'engineError', code: 'unknown', message: String(err) });
    }
  })();
});
