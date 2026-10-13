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
    // on failure the memo is reset so the next launch attempt retries instead of
    // replaying a transient rejection until the process is restarted
    servicesPromise = (async () => {
      const db = createExpoDriver();
      await migrate(db);
      const services = createServices({ db, fs: createExpoFsAdapter(), root: documentRoot(), newId: uuidV7 });
      await services.paths.ensureAll();
      await services.books.purgeDeletedBefore(computePurgeCutoff(Date.now()));
      await services.annotations.purgeDeletedBefore(computePurgeCutoff(Date.now()));
      return services;
    })().catch((err: unknown) => {
      servicesPromise = null;
      throw err;
    });
  }
  return servicesPromise;
}
