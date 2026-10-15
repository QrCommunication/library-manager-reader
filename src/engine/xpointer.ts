// DOM side of the KOReader XPointer contract (see core/progress/xpointer.ts).
// Positions are computed against the section document as parsed from the
// source XHTML, with two engine-specific adjustments:
//  - the bionic "concentration" wrappers (b[data-concentration]) the engine
//    injects are transparent: their text merges with the neighbouring text
//    nodes, as in the source file;
//  - like CREngine, whitespace-only text between block boundaries is not a
//    text node (it never receives a text() index).
// Anything unresolvable returns null: the caller falls back to the fraction,
// it never invents another position format.

import {
  codePointsToUtf16, formatXPointer, utf16ToCodePoints,
  type ParsedXPointer, type XPointerParts,
} from '../core/progress/xpointer';

const TEXT_NODE = 3;
const CDATA_NODE = 4;
const ELEMENT_NODE = 1;

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'br', 'caption', 'dd', 'details', 'div', 'dl', 'dt',
  'figcaption', 'figure', 'footer', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'li', 'main', 'nav',
  'ol', 'p', 'pre', 'section', 'table', 'tbody', 'td', 'tfoot', 'th', 'thead', 'tr', 'ul',
]);

const isText = (n: Node): n is Text => n.nodeType === TEXT_NODE || n.nodeType === CDATA_NODE;
const isElement = (n: Node): n is Element => n.nodeType === ELEMENT_NODE;
const nameOf = (el: Element): string => (el.localName || el.nodeName).toLowerCase();
const isTransparent = (n: Node): boolean => isElement(n) && n.hasAttribute('data-concentration');

interface Piece { node: Text; start: number }
type Item =
  | { kind: 'el'; el: Element }
  | { kind: 'text'; pieces: Piece[]; text: string; meaningful: boolean };

/** children as CREngine sees them: merged text runs + real elements */
function logicalChildren(parent: Node): Item[] {
  const items: Item[] = [];
  let run: Extract<Item, { kind: 'text' }> | null = null;
  const visit = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (isText(child)) {
        if (!run) { run = { kind: 'text', pieces: [], text: '', meaningful: false }; items.push(run); }
        run.pieces.push({ node: child, start: run.text.length });
        run.text += child.data;
      } else if (isTransparent(child)) {
        visit(child);
      } else if (isElement(child)) {
        run = null;
        items.push({ kind: 'el', el: child });
      }
      // comments / processing instructions: invisible, they split nothing
    }
  };
  visit(parent);
  const blockish = (it: Item | undefined): boolean => !it || (it.kind === 'el' && BLOCK.has(nameOf(it.el)));
  items.forEach((it, i) => {
    if (it.kind !== 'text') return;
    it.meaningful = /\S/.test(it.text) || !(blockish(items[i - 1]) || blockish(items[i + 1]));
  });
  return items;
}

const logicalParent = (node: Node): Node | null => {
  let p = node.parentNode;
  while (p && isTransparent(p)) p = p.parentNode;
  return p;
};

/** next node in document order, optionally skipping `node`'s subtree */
function following(node: Node, root: Node, skipChildren: boolean): Node | null {
  if (!skipChildren && node.firstChild) return node.firstChild;
  for (let c: Node | null = node; c && c !== root; c = c.parentNode) {
    if (c.nextSibling) return c.nextSibling;
  }
  return null;
}

/** first text node at or after `start` (inclusive) in document order */
function firstTextFrom(start: Node | null, root: Node): Text | null {
  for (let n = start; n; n = following(n, root, false)) if (isText(n)) return n;
  return null;
}

function elementSteps(el: Element, body: Element): XPointerParts['steps'] | null {
  const steps: XPointerParts['steps'] = [];
  let cur: Element = el;
  while (cur !== body) {
    const parent = logicalParent(cur);
    if (!parent || !isElement(parent)) return null;
    const name = nameOf(cur);
    const same = logicalChildren(parent).filter((it): it is Extract<Item, { kind: 'el' }> => it.kind === 'el' && nameOf(it.el) === name);
    const index = same.findIndex((it) => it.el === cur);
    if (index < 0) return null;
    steps.unshift({ name, index: index + 1, count: same.length });
    cur = parent;
  }
  return steps;
}

/**
 * XPointer of a DOM boundary point (typically the start of foliate's visible
 * range) in section `sectionIndex` of `sectionCount`. Null when the point is
 * outside the document body or the document has no body.
 */
export function boundaryToXPointer(
  doc: Document,
  sectionIndex: number,
  sectionCount: number,
  container: Node,
  offset: number,
): string | null {
  const body = doc.body;
  if (!body || !body.contains(container)) return null;
  let text: Text | null;
  let utf16 = 0;
  if (isText(container)) {
    text = container;
    utf16 = offset;
  } else {
    const child = container.childNodes[offset] ?? null;
    text = firstTextFrom(child ?? following(container, body, true), body);
  }
  // skip text that CREngine would not index (whitespace between blocks)
  for (let guard = 0; text && guard < 10000; guard++) {
    const parent = logicalParent(text);
    if (!parent || !isElement(parent)) return null;
    const items = logicalChildren(parent);
    const textItems = items.filter((it): it is Extract<Item, { kind: 'text' }> => it.kind === 'text' && it.meaningful);
    const run = textItems.find((it) => it.pieces.some((p) => p.node === text));
    if (run) {
      const piece = run.pieces.find((p) => p.node === text)!;
      const steps = elementSteps(parent, body);
      if (!steps) return null;
      return formatXPointer({
        sectionIndex,
        sectionCount,
        steps,
        text: {
          index: textItems.indexOf(run) + 1,
          count: textItems.length,
          offset: utf16ToCodePoints(run.text, piece.start + Math.min(utf16, text.data.length)),
        },
      });
    }
    text = firstTextFrom(following(text, body, true), body);
    utf16 = 0;
  }
  // no text after the point (image-only tail…): address the element itself
  const el = isElement(container) ? container : logicalParent(container);
  if (!el || !isElement(el)) return null;
  const steps = elementSteps(el, body);
  return steps ? formatXPointer({ sectionIndex, sectionCount, steps, text: null }) : null;
}

/** collapsed Range for a parsed XPointer in its section document, or null */
export function xpointerToRange(doc: Document, xp: ParsedXPointer): Range | null {
  let cur: Element | null = doc.body;
  if (!cur) return null;
  for (const step of xp.steps) {
    const same: Element[] = logicalChildren(cur)
      .filter((it): it is Extract<Item, { kind: 'el' }> => it.kind === 'el' && nameOf(it.el) === step.name)
      .map((it) => it.el);
    cur = same[step.index - 1] ?? null;
    if (!cur) return null;
  }
  const range = doc.createRange();
  if (!xp.text) {
    range.setStart(cur, 0);
    range.collapse(true);
    return range;
  }
  const runs = logicalChildren(cur).filter((it): it is Extract<Item, { kind: 'text' }> => it.kind === 'text' && it.meaningful);
  const run = runs[xp.text.index - 1];
  if (!run) return null;
  const target = codePointsToUtf16(run.text, xp.text.offset);
  let piece = run.pieces[0]!;
  for (const p of run.pieces) if (p.start <= target) piece = p;
  range.setStart(piece.node, Math.min(target - piece.start, piece.node.data.length));
  range.collapse(true);
  return range;
}
