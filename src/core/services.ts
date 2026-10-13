import { createContext, useContext } from 'react';
import type { DbDriver } from '../db/driver';
import { createBooksRepo } from '../db/booksRepo';
import { createProgressRepo } from '../db/progressRepo';
import { createBookmarksRepo } from '../db/bookmarksRepo';
import { createSettingsRepo } from '../db/settingsRepo';
import type { FsAdapter } from './storage/fsAdapter';
import { createStoragePaths, type StoragePaths } from './storage/paths';

export interface AppServices {
  books: ReturnType<typeof createBooksRepo>;
  progress: ReturnType<typeof createProgressRepo>;
  bookmarks: ReturnType<typeof createBookmarksRepo>;
  settings: ReturnType<typeof createSettingsRepo>;
  fs: FsAdapter;
  paths: StoragePaths;
}

export function createServices(args: { db: DbDriver; fs: FsAdapter; root: string; newId: () => string }): AppServices {
  return {
    books: createBooksRepo(args.db, args.newId),
    progress: createProgressRepo(args.db),
    bookmarks: createBookmarksRepo(args.db, args.newId),
    settings: createSettingsRepo(args.db),
    fs: args.fs,
    paths: createStoragePaths(args.root, args.fs),
  };
}

const ServicesContext = createContext<AppServices | null>(null);
export const ServicesProvider = ServicesContext.Provider;

export function useServices(): AppServices {
  const s = useContext(ServicesContext);
  if (!s) throw new Error('ServicesProvider missing');
  return s;
}
