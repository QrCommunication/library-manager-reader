// Dev-only seed: imports the committed sample fixtures so a dev build starts
// with content. Triggered by long-press on the empty state (LibraryScreen,
// __DEV__ builds only) and by nothing else.
import { runImport } from '../core/import/importService';
import { getHeadlessEngine } from '../core/reader/headlessEngine';
import { SAMPLE_EPUB_B64, SAMPLE_CBZ_B64 } from './fixtures.generated';
import type { AppServices } from '../core/services';

export async function seedIfEmpty(services: AppServices): Promise<void> {
  const existing = await services.books.listBooks({ sort: 'added' });
  if (existing.length > 0) return;
  const epubSrc = `${services.paths.booksDir}/seed-src-sample.epub`;
  const cbzSrc = `${services.paths.booksDir}/seed-src-sample.cbz`;
  await services.fs.writeBase64(epubSrc, SAMPLE_EPUB_B64);
  await services.fs.writeBase64(cbzSrc, SAMPLE_CBZ_B64);
  try {
    await runImport([epubSrc, cbzSrc], { fs: services.fs, paths: services.paths, books: services.books, extractor: getHeadlessEngine() });
  } finally {
    await services.fs.remove(epubSrc).catch(() => {});
    await services.fs.remove(cbzSrc).catch(() => {});
  }
}
