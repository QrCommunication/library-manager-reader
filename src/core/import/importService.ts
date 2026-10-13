import { hasEnoughSpace } from '../storage/spaceCheck';
import { extFromUri, type StoragePaths } from '../storage/paths';
import type { FsAdapter } from '../storage/fsAdapter';
import { ExtractionError, type MetadataPort } from '../reader/metadataPort';
import { uuidV7 } from '../uuid';
import type { BookFormat, OriginalFormat } from '../types';

type BooksRepo = { createBook(input: Record<string, unknown> & { fileName: string }): Promise<{ id: string }> };

export type ImportReason = 'unsupported' | 'no_space' | 'parse_failed' | 'io_error';
export type ImportOutcome =
  | { uri: string; ok: true; bookId: string }
  // detail carries the underlying error message: without it a device failure
  // (no console) is undiagnosable — the sheet would only say "unreadable file"
  | { uri: string; ok: false; reason: ImportReason; detail?: string };

const errDetail = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export interface ImportDeps {
  fs: FsAdapter;
  paths: StoragePaths;
  books: BooksRepo;
  extractor: MetadataPort;
  newId?: () => string;
  /** localized fallback title for books without any title or usable file name (core layer stays i18n-free) */
  untitledTitle?: string;
  /** per-file import progress (1-based done count); drives the library import banner */
  onProgress?: (p: { done: number; total: number; uri: string }) => void;
}

const STORED_EXT: Record<Exclude<OriginalFormat, null>, BookFormat> = {
  epub: 'epub', mobi: 'mobi', azw3: 'azw3', cbz: 'cbz', cbr: 'cbz',
};

export async function runImport(uris: string[], deps: ImportDeps): Promise<ImportOutcome[]> {
  const outcomes: ImportOutcome[] = [];
  await deps.paths.ensureAll();
  let done = 0;
  for (const uri of uris) {
    try {
      outcomes.push(await importOne(uri, deps));
    } catch (err) {
      console.warn('[import] failed', uri, err);
      outcomes.push({ uri, ok: false, reason: 'io_error', detail: errDetail(err) });
    }
    done += 1;
    deps.onProgress?.({ done, total: uris.length, uri });
  }
  return outcomes;
}

async function importOne(uri: string, deps: ImportDeps): Promise<ImportOutcome> {
  const original = extFromUri(uri);
  if (!original) return { uri, ok: false, reason: 'unsupported' };

  const size = await deps.fs.fileSize(uri);
  // expo-file-system can report -1/undefined-ish sizes for freshly picked cache
  // files; feeding those to the engine's assembler would hang until the 60s
  // extraction timeout — fail fast with the value as evidence instead
  if (!(size > 0)) return { uri, ok: false, reason: 'io_error', detail: `fileSize=${size}` };
  if (!(await hasEnoughSpace(deps.fs, size))) return { uri, ok: false, reason: 'no_space' };

  const id = deps.newId?.() ?? uuidV7();
  const tmpPath = `${deps.paths.booksDir}/${id}.importing`;
  try {
    await deps.fs.copy(uri, tmpPath);
    const extracted = await deps.extractor.extract({ path: tmpPath, format: original, size });
    const format = STORED_EXT[original];
    const finalPath = deps.paths.bookPath(id, format);
    if (extracted.cbzBase64) {
      await deps.fs.writeBase64(finalPath, extracted.cbzBase64);
      await deps.fs.remove(tmpPath);
    } else {
      await deps.fs.copy(tmpPath, finalPath);
      await deps.fs.remove(tmpPath);
    }
    if (extracted.coverJpegBase64) await deps.fs.writeBase64(deps.paths.coverPath(id), extracted.coverJpegBase64);

    // The row's fileSize must describe the STORED canonical file: for a converted
    // cbr the stored cbz differs in byte length from the picked file, and the
    // engine sizes its chunk assembler from book.fileSize — a mismatch would hang
    // or break every open. Recomputed from disk for the plain copy path too
    // (copy, not move — same code path for every format).
    const storedSize = await deps.fs.fileSize(finalPath);

    const book = await deps.books.createBook({
      id,
      title: extracted.metadata.title ?? uri.split('/').pop() ?? deps.untitledTitle ?? 'Untitled',
      author: extracted.metadata.author,
      format,
      originalFormat: original === 'cbr' ? 'cbr' : null,
      fileName: `${id}.${format}`,
      fileSize: storedSize,
      language: extracted.metadata.language,
      publisher: extracted.metadata.publisher,
      drmIdentifier: extracted.metadata.identifier,
      addedAt: Date.now(),
      updatedAt: Date.now(),
    });
    return { uri, ok: true, bookId: book.id };
  } catch (err) {
    await deps.fs.remove(tmpPath).catch(() => {});
    await deps.fs.remove(deps.paths.bookPath(id, STORED_EXT[original])).catch(() => {});
    await deps.fs.remove(deps.paths.coverPath(id)).catch(() => {});
    if (err instanceof ExtractionError) return { uri, ok: false, reason: 'parse_failed', detail: errDetail(err) };
    throw err;
  }
}
