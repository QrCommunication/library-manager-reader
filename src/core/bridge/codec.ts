import {
  APP_TO_ENGINE_TYPES, ENGINE_TO_APP_TYPES,
  type AppToEngine, type EngineToApp,
} from './protocol';

export function encodeMessage(m: AppToEngine | EngineToApp): string {
  return JSON.stringify(m);
}

export type ParsedEngineMessage = AppToEngine | EngineToApp | { type: 'unknown'; raw: string };

export function parseMessage(raw: string): ParsedEngineMessage {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { type: 'unknown', raw };
  }
  if (typeof value === 'object' && value !== null) {
    const t = (value as { type?: unknown }).type;
    if (typeof t === 'string') {
      if ((ENGINE_TO_APP_TYPES as readonly string[]).includes(t)) return value as EngineToApp;
      if ((APP_TO_ENGINE_TYPES as readonly string[]).includes(t)) return value as AppToEngine;
    }
  }
  return { type: 'unknown', raw };
}
