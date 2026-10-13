import { createExpoDriver } from '../db/expoDriver';
import { migrate } from '../db/migrate';
import { createServices, type AppServices } from './services';
import { createExpoFsAdapter, documentRoot } from './storage/expoFsAdapter';
import { uuidV7 } from './uuid';

export const RETENTION_MS = 30 * 24 * 3600 * 1000;
export function computePurgeCutoff(now: number): number { return now - RETENTION_MS; }

let servicesPromise: Promise<AppServices> | null = null;

export function createAppServices(): Promise<AppServices> {
  if (!servicesPromise) {
    servicesPromise = (async () => {
      const db = createExpoDriver();
      await migrate(db);
      const services = createServices({ db, fs: createExpoFsAdapter(), root: documentRoot(), newId: uuidV7 });
      await services.paths.ensureAll();
      await services.books.purgeDeletedBefore(computePurgeCutoff(Date.now()));
      return services;
    })();
  }
  return servicesPromise;
}
