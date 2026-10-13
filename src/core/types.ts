export type BookFormat = 'epub' | 'mobi' | 'azw3' | 'cbz';
export type OriginalFormat = BookFormat | 'cbr';
export type ThemeName = 'day' | 'sepia' | 'night';
export type FontFamilyOption = 'serif' | 'sans' | 'literata';
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
  fontSize: number; // px, 12–32
  lineHeight: number; // 1.2–2.2
  margin: number; // px, 0–64
  theme: ThemeName;
}

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  fontFamily: 'serif',
  fontSize: 18,
  lineHeight: 1.6,
  margin: 20,
  theme: 'day',
};

export interface UiPrefs {
  language: LanguagePref;
  defaultTheme: ThemeName;
}

export const DEFAULT_UI_PREFS: UiPrefs = { language: 'auto', defaultTheme: 'day' };
