import type {
  BookFormat, BookMetadata, HighlightColor, OriginalFormat,
  ReaderSettings, SelectionRect, TocItem,
} from '../types';

export const PROTOCOL_VERSION = 1;

// resume carries the last reading position so the engine applies it INSIDE
// view.init (foliate's lastLocation) — one navigation after the first render,
// never racing app-issued commands
export type ResumeTarget = { cfi?: string | null; fraction?: number } | null;

export type AppToEngine =
  | { type: 'openBook'; format: BookFormat; size: number; resume?: ResumeTarget }
  | { type: 'data'; seq: number; base64: string }
  | { type: 'dataEnd' }
  | { type: 'goTo'; target: string }
  | { type: 'goToFraction'; fraction: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'applySettings'; settings: ReaderSettings }
  | { type: 'captureBookmark' }
  | { type: 'extract'; requestId: string; format: OriginalFormat; size: number }
  | { type: 'addHighlight'; id: string; cfi: string; color: HighlightColor }
  | { type: 'removeHighlight'; id: string }
  | { type: 'copySelection' }
  | { type: 'search'; query: string }
  | { type: 'searchCancel' }
  | { type: 'ttsStart'; cfi: string | null }
  | { type: 'ttsStop' }
  | { type: 'ttsNext' };

export type EngineCover = { coverJpegBase64: string | null };

export type EngineMetadataPayload = BookMetadata & EngineCover;

export type EngineToApp =
  | { type: 'engineReady'; protocolVersion: number }
  | { type: 'dataAck'; seq: number }
  | { type: 'bookLoaded'; toc: TocItem[]; metadata: EngineMetadataPayload }
  // once per open, after init and the resume navigation completed: the app
  // gates progress persistence on it (earlier relocates must not clobber)
  | { type: 'resumeApplied' }
  | { type: 'progress'; cfi: string | null; fraction: number; sectionIndex: number | null }
  | { type: 'bookmarkCaptured'; target: string; fraction: number; excerpt: string }
  | { type: 'extractResult'; requestId: string; ok: true; metadata: EngineMetadataPayload; cbzBase64: string | null }
  | { type: 'extractResult'; requestId: string; ok: false; error: string }
  | { type: 'engineError'; code: 'open_failed' | 'parse_failed' | 'unknown'; message: string }
  | { type: 'selectionChanged'; text: string | null; rect: SelectionRect | null; cfi: string | null; lang: string | null }
  | { type: 'searchResult'; cfi: string; excerpt: string; fraction: number }
  | { type: 'searchDone'; count: number }
  | { type: 'ttsSentence'; text: string; cfi: string | null }
  // v1.x additive: page taps moved INTO the engine document (RN tap zones
  // blocked native text selection); a middle-zone tap asks the app to toggle
  // the reader chrome
  | { type: 'chromeToggle' }
  // v1.x additive: top-center strip tap — opens the reading settings directly
  // (immersive mode has no visible chrome to reach them)
  | { type: 'openSettings' };

export const ENGINE_TO_APP_TYPES: readonly EngineToApp['type'][] = [
  'engineReady', 'dataAck', 'bookLoaded', 'resumeApplied', 'progress', 'bookmarkCaptured', 'extractResult', 'engineError',
  'selectionChanged', 'searchResult', 'searchDone', 'ttsSentence', 'chromeToggle', 'openSettings',
];

export const APP_TO_ENGINE_TYPES: readonly AppToEngine['type'][] = [
  'openBook', 'data', 'dataEnd', 'goTo', 'goToFraction', 'next', 'prev', 'applySettings', 'captureBookmark', 'extract',
  'addHighlight', 'removeHighlight', 'copySelection', 'search', 'searchCancel', 'ttsStart', 'ttsStop', 'ttsNext',
];
