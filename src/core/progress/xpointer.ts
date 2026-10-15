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

/** UTF-16 offset → Unicode code point count (KOReader counts UTF-32) */
export function utf16ToCodePoints(text: string, utf16Offset: number): number {
  const end = Math.max(0, Math.min(utf16Offset, text.length));
  let count = 0;
  for (let i = 0; i < end; i++) {
    const c = text.charCodeAt(i);
    // a high surrogate followed by its low half is one code point
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < end) {
      const n = text.charCodeAt(i + 1);
      if (n >= 0xdc00 && n <= 0xdfff) i++;
    }
    count++;
  }
  return count;
}

/** code point count → UTF-16 offset, clamped to the text length */
export function codePointsToUtf16(text: string, codePoints: number): number {
  let i = 0;
  let count = 0;
  while (i < text.length && count < codePoints) {
    const c = text.charCodeAt(i);
    i += c >= 0xd800 && c <= 0xdbff && i + 1 < text.length
      && text.charCodeAt(i + 1) >= 0xdc00 && text.charCodeAt(i + 1) <= 0xdfff ? 2 : 1;
    count++;
  }
  return i;
}
