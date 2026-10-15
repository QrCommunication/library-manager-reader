// KOReader / CREngine XPointer — the ONLY position format of the Library
// Manager reading contract (web, mobile and kosync share it):
//   /body/DocFragment[2]/body/div/p[3]/text()[1].42
// DocFragment[n] is the 1-based spine item; each step is an element local
// name with an optional 1-based index among same-name siblings; the optional
// text() step addresses a text node and its suffix counts Unicode code points
// (UTF-32), not JavaScript UTF-16 units. Pure string logic lives here; the DOM
// walk lives in the engine (src/engine/xpointer.ts).

export interface XPointerStep { name: string; index: number }

export interface ParsedXPointer {
  /** 0-based spine index (DocFragment[n] → n - 1) */
  sectionIndex: number;
  /** element steps below the fragment's own <body> */
  steps: XPointerStep[];
  /** text() step: 1-based text node index + code point offset */
  text: { index: number; offset: number } | null;
}

// bounded on purpose: the API caps whole JSON bodies at 64 KiB and a real
// position never comes close to this
const MAX_LENGTH = 4096;
const NAME = '[A-Za-z_][A-Za-z0-9_.-]*';
const STEP_RE = new RegExp(`^(${NAME})(?:\\[([1-9][0-9]{0,6})\\])?$`);
const TEXT_RE = /^text\(\)(?:\[([1-9][0-9]{0,6})\])?\.(0|[1-9][0-9]{0,8})$/;
const FRAGMENT_RE = /^DocFragment(?:\[([1-9][0-9]{0,6})\])?$/;
// CREngine sometimes suffixes an element pointer with ".0"
const ELEMENT_OFFSET_RE = /\.(0|[1-9][0-9]{0,8})$/;

export function parseXPointer(value: unknown): ParsedXPointer | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_LENGTH) return null;
  if (!value.startsWith('/')) return null;
  const parts = value.slice(1).split('/');
  if (parts[0] !== 'body') return null;
  const fragment = FRAGMENT_RE.exec(parts[1] ?? '');
  if (!fragment) return null;
  if (parts.length === 2) return { sectionIndex: Number(fragment[1] ?? 1) - 1, steps: [], text: null };
  const fragmentBody = parts.length === 3 ? parts[2]!.replace(ELEMENT_OFFSET_RE, '') : parts[2];
  if (fragmentBody !== 'body') return null;
  const steps: XPointerStep[] = [];
  let text: ParsedXPointer['text'] = null;
  for (let i = 3; i < parts.length; i++) {
    let part = parts[i]!;
    const last = i === parts.length - 1;
    if (part.startsWith('text()')) {
      if (!last) return null;
      const m = TEXT_RE.exec(part);
      if (!m) return null;
      text = { index: Number(m[1] ?? 1), offset: Number(m[2]) };
      continue;
    }
    if (last) part = part.replace(ELEMENT_OFFSET_RE, '');
    const m = STEP_RE.exec(part);
    if (!m) return null;
    steps.push({ name: m[1]!.toLowerCase(), index: Number(m[2] ?? 1) });
  }
  return { sectionIndex: Number(fragment[1] ?? 1) - 1, steps, text };
}

export const isXPointer = (value: unknown): value is string => parseXPointer(value) !== null;

/** the value itself when it is a usable XPointer, else null (never throws) */
export const xpointerOrNull = (value: unknown): string | null => (isXPointer(value) ? value : null);

// CREngine writes an index only when several siblings share the name; a
// missing index reads as [1], so both spellings resolve identically
const indexSuffix = (index: number, count: number): string => (count > 1 ? `[${index}]` : '');

export interface XPointerParts {
  sectionIndex: number;
  sectionCount: number;
  steps: (XPointerStep & { count: number })[];
  text: { index: number; count: number; offset: number } | null;
}

export function formatXPointer(p: XPointerParts): string {
  let out = `/body/DocFragment${indexSuffix(p.sectionIndex + 1, p.sectionCount)}/body`;
  for (const s of p.steps) out += `/${s.name}${indexSuffix(s.index, s.count)}`;
  if (p.text) out += `/text()${indexSuffix(p.text.index, p.text.count)}.${p.text.offset}`;
  return out;
}

// CREngine stores each text node pre-processed (lvxml.cpp PreProcessXmlString):
// outside white-space:pre, \r \n \t become spaces and a run of spaces keeps
// only its first one; inside <pre>, \r\n / lone \r become \n and a newline
// right after the <pre> start tag is stripped. KOReader offsets count code
// points of THAT text — not of the raw DOM string.
export interface CrTextMode { pre: boolean; stripLeadingNewline: boolean }

const isXmlSpace = (c: number): boolean => c === 0x20 || c === 0x0d || c === 0x0a || c === 0x09;

/** per raw UTF-16 unit index: does it emit a CREngine code point? (low surrogates: false) */
function crEmitMap(raw: string, mode: CrTextMode): boolean[] {
  const emits = new Array<boolean>(raw.length).fill(false);
  let prevSpace = false;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c >= 0xdc00 && c <= 0xdfff && i > 0) {
      const h = raw.charCodeAt(i - 1);
      if (h >= 0xd800 && h <= 0xdbff) continue; // second half of a pair
    }
    if (mode.pre) {
      emits[i] = !((i === 0 && mode.stripLeadingNewline && c === 0x0a) || (c === 0x0d && raw.charCodeAt(i + 1) === 0x0a));
    } else if (isXmlSpace(c)) {
      emits[i] = !prevSpace;
      prevSpace = true;
    } else {
      emits[i] = true;
      prevSpace = false;
    }
  }
  return emits;
}

/** raw UTF-16 offset in the DOM text → KOReader code point offset */
export function crOffsetFromRaw(raw: string, utf16Offset: number, mode: CrTextMode): number {
  const end = Math.max(0, Math.min(utf16Offset, raw.length));
  const emits = crEmitMap(raw, mode);
  let n = 0;
  for (let i = 0; i < end; i++) if (emits[i]) n++;
  return n;
}

/**
 * KOReader code point offset → raw UTF-16 offset in the DOM text: the raw
 * unit that produced that code point (collapsed spaces resolve to the first
 * one of their run), clamped to the text end.
 */
export function rawOffsetFromCr(raw: string, crOffset: number, mode: CrTextMode): number {
  const emits = crEmitMap(raw, mode);
  let n = 0;
  for (let i = 0; i < raw.length; i++) {
    if (!emits[i]) continue;
    if (n === crOffset) return i;
    n++;
  }
  return raw.length;
}
