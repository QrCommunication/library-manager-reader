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
}

export const DEFAULT_UI_PREFS: UiPrefs = {
  language: 'auto',
  defaultTheme: 'day',
  libreTranslateUrl: 'https://libretranslate.com',
  libreTranslateApiKey: '',
};
