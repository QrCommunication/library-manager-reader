import type { DbDriver } from './driver';
import { DEFAULT_READER_SETTINGS, DEFAULT_UI_PREFS, type ReaderSettings, type UiPrefs } from '../core/types';

const READER_KEY = 'readerSettings';
const UI_KEY = 'uiPrefs';

export function createSettingsRepo(db: DbDriver) {
  const read = async <T>(key: string, fallback: T): Promise<T> => {
    const row = await db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', [key]);
    if (!row) return fallback;
    try {
      return { ...fallback, ...(JSON.parse(row.value) as object) } as T;
    } catch {
      // a corrupted row must never crash startup: fall back to full defaults
      // (no partial merge — an unparseable value tells us nothing reliable)
      return fallback;
    }
  };
  const write = async (key: string, value: unknown): Promise<void> => {
    await db.run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), Date.now()],
    );
  };
  return {
    getReaderSettings: () => read(READER_KEY, DEFAULT_READER_SETTINGS),
    putReaderSettings: (s: ReaderSettings) => write(READER_KEY, s),
    getUiPrefs: async (): Promise<UiPrefs> => {
      const prefs = await read(UI_KEY, DEFAULT_UI_PREFS);
      // the LibreTranslate inputs left Réglages, so the shipped server is an
      // internal constant — rows persisted by older builds (which stored
      // libretranslate.com + empty key on any pref save) must not shadow it
      return { ...prefs, libreTranslateUrl: DEFAULT_UI_PREFS.libreTranslateUrl, libreTranslateApiKey: DEFAULT_UI_PREFS.libreTranslateApiKey };
    },
    putUiPrefs: (p: UiPrefs) => write(UI_KEY, p),
  };
}
