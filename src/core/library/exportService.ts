import { zipSync, type Zippable } from 'fflate';
import { serializeSidecar } from '../progress/koreaderSidecar';
import { storedFormat } from './fileMeta';
import type { FsAdapter } from '../storage/fsAdapter';
import type { Book } from '../types';

// the calibre naming convention, understood by most library managers
export function displayName(book: Pick<Book, 'title' | 'author' | 'format' | 'originalFormat'>): string {
  const sanitize = (s: string) => s.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/[. ]+$/, '');
  const base = book.author ? `${sanitize(book.author)} - ${sanitize(book.title)}` : sanitize(book.title);
  return `${base}.${storedFormat(book)}`;
}

export function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name;
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 2; ; n++) {
    const candidate = `${base} (${n})${ext}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export interface ExportEntry { path: string; data: Uint8Array }

export interface ExportDeps {
  fs: Pick<FsAdapter, 'readBytes'>;
  paths: { bookPath(id: string, ext: string): string };
  getProgress(id: string): Promise<{ fraction: number; updatedAt: number } | null>;
}

// sidecars ride along so KOReader can pick the position back up after a
// round-trip through the archive
export async function buildExportEntries(deps: ExportDeps, books: Book[]): Promise<ExportEntry[]> {
  const taken = new Set<string>();
  const entries: ExportEntry[] = [];
  for (const book of books) {
    const format = storedFormat(book);
    const name = uniqueName(displayName(book), taken);
    taken.add(name);
    entries.push({ path: name, data: await deps.fs.readBytes(deps.paths.bookPath(book.id, format)) });
    const progress = await deps.getProgress(book.id);
    if (progress) {
      const slug = book.title.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Za-z0-9]+/g, '_');
      entries.push({
        path: `${slug}.sdr/metadata.${format}.lua`,
        data: new TextEncoder().encode(serializeSidecar({
          percentFinished: progress.fraction,
          lastRead: Math.floor(progress.updatedAt / 1000),
          title: book.title,
          authors: book.author,
          language: book.language,
        })),
      });
    }
  }
  return entries;
}

export function zipEntries(entries: ExportEntry[]): Uint8Array {
  const zippable: Zippable = {};
  for (const e of entries) zippable[e.path] = [e.data, { level: 0 }];
  return zipSync(zippable);
}
