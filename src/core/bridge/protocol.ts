import type { BookFormat, BookMetadata, OriginalFormat, ReaderSettings, TocItem } from '../types';

export const PROTOCOL_VERSION = 1;

export type AppToEngine =
  | { type: 'openBook'; format: BookFormat; size: number }
  | { type: 'data'; seq: number; base64: string }
  | { type: 'dataEnd' }
  | { type: 'goTo'; target: string }
  | { type: 'goToFraction'; fraction: number }
  | { type: 'next' }
  | { type: 'prev' }
  | { type: 'applySettings'; settings: ReaderSettings }
  | { type: 'captureBookmark' }
  | { type: 'extract'; requestId: string; format: OriginalFormat; size: number };

export type EngineCover = { coverJpegBase64: string | null };

export type EngineMetadataPayload = BookMetadata & EngineCover;

export type EngineToApp =
  | { type: 'engineReady'; protocolVersion: number }
  | { type: 'dataAck'; seq: number }
  | { type: 'bookLoaded'; toc: TocItem[]; metadata: EngineMetadataPayload }
  | { type: 'progress'; cfi: string | null; fraction: number; sectionIndex: number | null }
  | { type: 'bookmarkCaptured'; target: string; fraction: number; excerpt: string }
  | { type: 'extractResult'; requestId: string; ok: true; metadata: EngineMetadataPayload; cbzBase64: string | null }
  | { type: 'extractResult'; requestId: string; ok: false; error: string }
  | { type: 'engineError'; code: 'open_failed' | 'parse_failed' | 'unknown'; message: string };

export const ENGINE_TO_APP_TYPES: readonly EngineToApp['type'][] = [
  'engineReady', 'dataAck', 'bookLoaded', 'progress', 'bookmarkCaptured', 'extractResult', 'engineError',
];
