import type { OriginalFormat } from '../types';

export interface StoragePaths {
  root: string;
  booksDir: string; coversDir: string;
  bookPath(id: string, ext: string): string; coverPath(id: string): string;
  ensureAll(): Promise<void>;
}

export const BOOK_EXTENSIONS = ['epub', 'mobi', 'azw3', 'cbz', 'cbr'] as const;
export type StoredExtension = Exclude<OriginalFormat, null>;

export function extFromUri(uri: string): OriginalFormat | null {
  const m = /\.([a-z0-9]+)$/i.exec(uri.replace(/[?#].*$/, ''));
  const ext = (m?.[1] ?? '').toLowerCase() as OriginalFormat;
  return (BOOK_EXTENSIONS as readonly string[]).includes(ext) ? ext : null;
}

export function createStoragePaths(root: string, fs: { ensureDir(path: string): Promise<void> }): StoragePaths {
  const booksDir = `${root}/books`;
  const coversDir = `${root}/covers`;
  return {
    root,
    booksDir, coversDir,
    bookPath: (id, ext) => `${booksDir}/${id}.${ext}`,
    coverPath: (id) => `${coversDir}/${id}.jpg`,
    ensureAll: async () => { await fs.ensureDir(booksDir); await fs.ensureDir(coversDir); },
  };
}
