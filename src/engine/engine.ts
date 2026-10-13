import { PROTOCOL_VERSION, type AppToEngine, type EngineToApp } from '../core/bridge/protocol';

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
