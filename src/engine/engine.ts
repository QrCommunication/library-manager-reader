import { PROTOCOL_VERSION, type AppToEngine, type EngineToApp } from '../core/bridge/protocol';
import { View } from 'foliate-js/view.js';
import { createChunkAssembler } from './chunkAssembler';
import { convertCbrToCbz } from './extractMode';
import { createExtractorFromData } from 'node-unrar-js';
import { zipSync, strToU8 } from 'fflate';
import type { OriginalFormat, ReaderSettings, TocItem } from '../core/types';

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

view.addEventListener('load', () => {
  // installed foliate View emits 'load' with { doc, index }; toc/metadata live on view.book
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

view.addEventListener('relocate', (e: Event) => {
  const d = (e as CustomEvent).detail;
  lastFraction = d?.fraction ?? lastFraction;
  // installed foliate relocate detail has section: { current, total }
  send({ type: 'progress', cfi: d?.cfi ?? null, fraction: d?.fraction ?? 0, sectionIndex: d?.section?.current ?? null });
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
    default: break;
  }
}

onAppMessage((msg) => { void handle(msg); });
