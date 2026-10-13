import { createHeadlessExtractor } from './metadataPort';
import type { FsAdapter } from '../storage/fsAdapter';

type HeadlessPort = ReturnType<typeof createHeadlessExtractor>;
let sender: ((raw: string) => void) | null = null;
let port: HeadlessPort | null = null;

export function registerHeadlessSender(fn: ((raw: string) => void) | null): void { sender = fn; }
export function sendToHeadless(raw: string): void { sender?.(raw); }
export function initHeadlessEngine(fs: FsAdapter, chunkSize?: number): HeadlessPort {
  if (!port) port = createHeadlessExtractor(sendToHeadless, fs, chunkSize);
  return port;
}
export function getHeadlessEngine(): HeadlessPort {
  if (!port) throw new Error('headless engine not initialised');
  return port;
}
export function handleHeadlessRaw(raw: string): void { port?.handleRaw(raw); }
