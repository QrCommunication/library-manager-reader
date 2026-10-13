import { createContext, useContext } from 'react';
import type { DbDriver } from '../db/driver';
import { createBooksRepo } from '../db/booksRepo';
import { createProgressRepo } from '../db/progressRepo';
import { createBookmarksRepo } from '../db/bookmarksRepo';
import { createSettingsRepo } from '../db/settingsRepo';
import { createLookupService } from './lookup/lookupService';
import type { FsAdapter } from './storage/fsAdapter';
import { createStoragePaths, type StoragePaths } from './storage/paths';

export interface AppServices {
  books: ReturnType<typeof createBooksRepo>;
  progress: ReturnType<typeof createProgressRepo>;
  bookmarks: ReturnType<typeof createBookmarksRepo>;
  settings: ReturnType<typeof createSettingsRepo>;
  lookup: ReturnType<typeof createLookupService>;
  fs: FsAdapter;
  paths: StoragePaths;
}

export function createServices(args: { db: DbDriver; fs: FsAdapter; root: string; newId: () => string }): AppServices {
  const settingsRepo = createSettingsRepo(args.db);
  return {
    books: createBooksRepo(args.db, args.newId),
    progress: createProgressRepo(args.db),
    bookmarks: createBookmarksRepo(args.db, args.newId),
    settings: settingsRepo,
    lookup: createLookupService({
      // read the persisted prefs on every call, so URL/key edits apply immediately
      translateConfig: async () => {
        const prefs = await settingsRepo.getUiPrefs();
        return { url: prefs.libreTranslateUrl, apiKey: prefs.libreTranslateApiKey || null };
      },
    }),
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
