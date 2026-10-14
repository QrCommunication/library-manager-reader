export interface KoReaderProgress {
  /** 0..1, mirrors KOReader's percent_finished */
  percentFinished: number;
  /** unix seconds, as KOReader stores it */
  lastRead: number | null;
  title: string | null;
  authors: string | null;
  language: string | null;
}

const KEY_LINE = /^\s*\[\s*"((?:[^"\\]|\\.)*)"\s*\]\s*=\s*(.+?),?\s*$/;
const DOC_PROPS_OPEN = /\[\s*"doc_props"\s*\]\s*=\s*\{/;
const CLOSING_BRACE = /^\s*\}/;

const unescapeLua = (s: string): string =>
  s.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c));

const asString = (v: string): string | null => {
  const m = /^"((?:[^"\\]|\\.)*)"$/.exec(v);
  return m ? unescapeLua(m[1]!) : null;
};

const asNumber = (v: string): number | null => {
  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
};

// KOReader's metadata.<ext>.lua is a `return { ... }` table. The keys this
// feature needs (percent_finished, last_read, doc_props.title/authors/language)
// are flat string/number values, so a line scanner is enough — unknown keys and
// nested tables (summary, highlight, bookmarks) are skipped.
export function parseSidecar(lua: string): KoReaderProgress | null {
  let percentFinished: number | null = null;
  let lastRead: number | null = null;
  let title: string | null = null;
  let authors: string | null = null;
  let language: string | null = null;
  let inDocProps = false;
  for (const line of lua.split(/\r?\n/)) {
    if (DOC_PROPS_OPEN.test(line)) { inDocProps = true; continue; }
    if (CLOSING_BRACE.test(line)) { inDocProps = false; continue; }
    const m = KEY_LINE.exec(line);
    if (!m) continue;
    const key = unescapeLua(m[1]!);
    const value = m[2]!.trim();
    if (inDocProps) {
      if (key === 'title') title = asString(value) ?? title;
      else if (key === 'authors') authors = asString(value) ?? authors;
      else if (key === 'language') language = asString(value) ?? language;
    } else if (key === 'percent_finished') {
      percentFinished = asNumber(value);
    } else if (key === 'last_read') {
      lastRead = asNumber(value);
    }
  }
  if (percentFinished === null) return null;
  return { percentFinished, lastRead, title, authors, language };
}

const escapeLua = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');

export function serializeSidecar(p: KoReaderProgress): string {
  const lines: string[] = ['return {', '    ["doc_props"] = {'];
  if (p.title !== null) lines.push(`        ["title"] = "${escapeLua(p.title)}",`);
  if (p.authors !== null) lines.push(`        ["authors"] = "${escapeLua(p.authors)}",`);
  if (p.language !== null) lines.push(`        ["language"] = "${escapeLua(p.language)}"`);
  lines.push('    },');
  lines.push(`    ["percent_finished"] = ${p.percentFinished},`);
  lines.push(`    ["last_read"] = ${p.lastRead ?? Math.round(Date.now() / 1000)}`);
  lines.push('}');
  return lines.join('\n') + '\n';
}
