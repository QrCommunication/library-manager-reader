import { PROTOCOL_VERSION, type AppToEngine, type EngineToApp } from '../core/bridge/protocol';
import { View } from 'foliate-js/view.js';
import { createChunkAssembler } from './chunkAssembler';
import type { ReaderSettings, TocItem } from '../core/types';

declare const __LITERATA_B64__: string;

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

async function blobFromBase64(b64: string): Promise<Blob> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes]);
}

async function handle(msg: AppToEngine): Promise<void> {
  switch (msg.type) {
    case 'openBook':
      assembler = createChunkAssembler(msg.size);
      break;
    case 'data': {
      const result = assembler!.push(msg.seq, msg.base64);
      send({ type: 'dataAck', seq: msg.seq });
      if (result.complete && result.bytes) {
        try {
          await view.open(new Blob([result.bytes]));
        } catch (err) {
          send({ type: 'engineError', code: 'open_failed', message: String(err) });
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
