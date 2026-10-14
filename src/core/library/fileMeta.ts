import { unzipSync, zipSync, strFromU8, strToU8, type Zippable } from 'fflate';
import type { FsAdapter } from '../storage/fsAdapter';
import type { StoragePaths } from '../storage/paths';
import type { Book, BookFormat } from '../types';

export interface FileMeta {
  title: string;
  author: string | null;
  series: string | null;
  seriesIndex: number | null;
}

/** formats whose container this module can rewrite; cbr is stored as cbz */
export type WritableMetaFormat = 'epub' | 'cbz';

/** cbr originals live on disk as converted cbz files */
export const storedFormat = (b: Pick<Book, 'format' | 'originalFormat'>): BookFormat =>
  b.originalFormat === 'cbr' ? 'cbz' : b.format;

const escapeXml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');

// EPUB requires an uncompressed mimetype entry as the very first zip member
const rezip = (files: Record<string, Uint8Array>): Uint8Array => {
  const out: Zippable = {};
  if (files['mimetype']) out['mimetype'] = [files['mimetype'], { level: 0 }];
  for (const [name, data] of Object.entries(files)) {
    if (name !== 'mimetype') out[name] = data;
  }
  return zipSync(out);
};

const setInner = (xml: string, tag: string, value: string | null): string => {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?</${tag}>`);
  if (value === null) return xml.replace(re, '');
  if (re.test(xml)) return xml.replace(re, `<${tag}>${escapeXml(value)}</${tag}>`);
  return xml.replace(/(<ComicInfo(?:\s[^>]*)?>)/, `$1<${tag}>${escapeXml(value)}</${tag}>`);
};

const writeCbz = (bytes: Uint8Array, meta: FileMeta): Uint8Array => {
  const files = unzipSync(bytes);
  let info = files['ComicInfo.xml'] ? strFromU8(files['ComicInfo.xml']) : '<?xml version="1.0" encoding="utf-8"?>\n<ComicInfo>\n</ComicInfo>';
  info = setInner(info, 'Title', meta.title);
  info = setInner(info, 'Series', meta.series);
  info = setInner(info, 'Number', meta.seriesIndex === null ? null : String(meta.seriesIndex));
  files['ComicInfo.xml'] = strToU8(info);
  return rezip(files);
};

const writeEpub = (bytes: Uint8Array, meta: FileMeta): Uint8Array => {
  const files = unzipSync(bytes);
  const container = strFromU8(files['META-INF/container.xml']!);
  const opfPath = /full-path="([^"]+)"/.exec(container)![1]!;
  let opf = strFromU8(files[opfPath]!);

  // dc:title is mandatory in EPUB, dc:creator may be absent — both get
  // replaced in place (attributes kept) or inserted right after <metadata>
  const titleRe = /<dc:title(?:\s[^>]*)?>[\s\S]*?<\/dc:title>/;
  const newTitle = `<dc:title>${escapeXml(meta.title)}</dc:title>`;
  if (titleRe.test(opf)) opf = opf.replace(titleRe, newTitle);
  else opf = opf.replace(/(<metadata[^>]*>)/, `$1${newTitle}`);
  const creatorRe = /<dc:creator(?:\s[^>]*)?>[\s\S]*?<\/dc:creator>/;
  if (meta.author) {
    const creatorMatch = /<dc:creator((?:\s[^>]*)?)>/.exec(opf);
    const newCreator = creatorMatch
      ? `<dc:creator${creatorMatch[1]}>${escapeXml(meta.author)}</dc:creator>`
      : `<dc:creator>${escapeXml(meta.author)}</dc:creator>`;
    if (creatorRe.test(opf)) opf = opf.replace(creatorRe, newCreator);
    else opf = opf.replace(/<\/dc:title>/, `</dc:title>${newCreator}`);
  }

  // EPUB3 collection series: rewrite only if the file already declares one;
  // a cleared series removes the pair, a file without the meta stays as-is
  const collectionRe = /<meta[^>]*property="belongs-to-collection"[^>]*>[\s\S]*?<\/meta>/;
  const positionRe = /<meta[^>]*property="group-position"[^>]*>[\s\S]*?<\/meta>/;
  if (collectionRe.test(opf)) {
    if (meta.series) {
      opf = opf.replace(collectionRe, (m) => m.replace(/>([\s\S]*)<\/meta>/, `>${escapeXml(meta.series!)}</meta>`));
      if (positionRe.test(opf)) {
        opf = opf.replace(positionRe, (m) => m.replace(/>([\s\S]*)<\/meta>/, `>${meta.seriesIndex ?? ''}</meta>`));
      }
    } else {
      opf = opf.replace(collectionRe, '').replace(positionRe, '');
    }
  }

  files[opfPath] = strToU8(opf);
  return rezip(files);
};

/** null: the format does not support embedded metadata writes (MOBI/AZW3) */
export function writeFileMeta(format: BookFormat, bytes: Uint8Array, meta: FileMeta): Uint8Array | null {
  if (format === 'epub') return writeEpub(bytes, meta);
  if (format === 'cbz') return writeCbz(bytes, meta);
  return null;
}

export type MetaFs = Pick<FsAdapter, 'readBytes' | 'writeBytes'>;
export type MetaPaths = Pick<StoragePaths, 'bookPath'>;

/** writes the metadata into the stored file; false when the format is read-only (MOBI/AZW3) */
export async function writeMetaToStoredFile(
  fs: MetaFs,
  paths: MetaPaths,
  book: Pick<Book, 'id' | 'format' | 'originalFormat'>,
  meta: FileMeta,
): Promise<boolean> {
  const format = storedFormat(book);
  const updated = writeFileMeta(format, await fs.readBytes(paths.bookPath(book.id, format)), meta);
  if (!updated) return false;
  await fs.writeBytes(paths.bookPath(book.id, format), updated);
  return true;
}
