export type BookFormat = 'epub' | 'mobi' | 'azw3' | 'cbz';
export type OriginalFormat = BookFormat | 'cbr';
export type ThemeName = 'day' | 'sepia' | 'night' | 'auto';

// 'auto' is only meaningful app-side (follows the system dark mode); every
// consumer that renders or sends a theme must resolve it to a concrete one
// before token lookup / engine transmission. null scheme (undetermined)
// resolves to the light theme.
export function resolveTheme(theme: ThemeName, system: 'light' | 'dark' | null): 'day' | 'sepia' | 'night' {
  if (theme !== 'auto') return theme;
  return system === 'dark' ? 'night' : 'day';
}

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'red';

export interface SelectionRect { x: number; y: number; width: number; height: number }
export type FontFamilyOption = 'serif' | 'sans' | 'literata' | 'lexend' | 'atkinson' | 'opendyslexic';
export type LanguagePref = 'auto' | 'fr' | 'en';

export interface Book {
  id: string;
  title: string;
  author: string | null;
  format: BookFormat;
  originalFormat: OriginalFormat | null;
  fileName: string;
  fileSize: number;
  language: string | null;
  publisher: string | null;
  series: string | null;
  seriesIndex: number | null;
  drmIdentifier: string | null;
  addedAt: number;
  updatedAt: number;
  deletedAt: number | null;
  lastReadAt: number | null;
}

export type NewBook = Omit<Book, 'id'> & { id?: string };

export interface ReadingProgress {
  bookId: string;
  cfi: string | null;
  fraction: number;
  sectionIndex: number | null;
  updatedAt: number;
}

export interface Bookmark {
  id: string;
  bookId: string;
  cfi: string;
  fraction: number;
  previewText: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type NewBookmark = Omit<Bookmark, 'id' | 'updatedAt' | 'deletedAt'> & { id?: string };

export interface Annotation {
  id: string;
  bookId: string;
  cfi: string;
  color: HighlightColor;
  note: string | null;
  excerpt: string;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
}

export type NewAnnotation = Omit<Annotation, 'id' | 'updatedAt' | 'deletedAt'> & { id?: string };

export interface TocItem {
  label: string;
  target: string | null; // cfi or href, whatever the engine accepts in goTo
  children?: TocItem[];
}

export interface BookMetadata {
  title: string | null;
  author: string | null;
  language: string | null;
  publisher: string | null;
  identifier: string | null;
  series: string | null;
  seriesIndex: number | null;
}

export interface ReaderSettings {
  fontFamily: FontFamilyOption;
  fontSize: number; // px, 10–40 (accessibility range)
  lineHeight: number; // 1.2–2.2
  margin: number; // px, 0–64
  theme: ThemeName;
  ttsRate: number; // 0.5–2.0
  brightness: number; // 0–70 (% d'assombrissement)
  concentration: boolean; // bionic reading: bold word starts
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.6,
  margin: 20,
  theme: 'day',
  ttsRate: 1,
  brightness: 0,
  concentration: false,
};

export interface UiPrefs {
  language: LanguagePref;
  defaultTheme: ThemeName;
  libreTranslateUrl: string;
  libreTranslateApiKey: string;
  // LibreTranslate target code translations point at (one of the server's
  // supported languages, see SettingsScreen)
  translateTarget: string;
  // KOSync account: community server by default, or any self-hosted one.
  // Only the md5 of the password (userkey) is ever persisted, matching what
  // KOReader itself stores in kosync.lua.
  koreaderServer: string;
  koreaderUsername: string;
  koreaderUserkey: string;
  koreaderDeviceId: string;
  // library-manager.com account: display name only. The OAuth tokens live in
  // Keychain/Keystore (lmTokens.ts, spec §10) and never enter the prefs store.
  lmUsername: string;
  // stable per-installation UUID carried by progress ops and copy confirmations
  lmInstallationId: string;
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  language: 'auto',
  defaultTheme: 'day',
  // shipped translation endpoint: the shared community server, key included —
  // translation works out of the box; users can still override both in Réglages
  libreTranslateUrl: 'https://translate.rlconseil.net',
  libreTranslateApiKey: '73d6bbf4-eaba-4bbf-ad82-d58f9ccba23d',
  translateTarget: 'fr',
  koreaderServer: 'https://sync.koreader.rocks',
  koreaderUsername: '',
  koreaderUserkey: '',
  koreaderDeviceId: '',
  lmUsername: '',
  lmInstallationId: '',
};
