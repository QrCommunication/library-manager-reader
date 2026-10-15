// DOM side of the KOReader XPointer contract (see core/progress/xpointer.ts),
// modelled on how CREngine (koreader/crengine lvtinydom.cpp / lvxml.cpp)
// builds the tree its XPointers address:
//  - text is pre-processed (whitespace collapsed outside <pre>), and offsets
//    count code points of that processed text;
//  - a whitespace-only text node is dropped when it is the first child of a
//    block element (ldomElementWriter::onText) and, in a container holding
//    block children, when it borders a block or the container edge
//    (initNodeRendMethod autoBoxing cleanup);
//  - boxing elements CREngine inserts are invisible to XPointers — here the
//    engine's own bionic "concentration" wrappers (b[data-concentration])
//    play that role: their text merges with the neighbouring text nodes.
// "Block" follows CREngine's built-in HTML element defaults (fb2def.h); the
// book CSS is not consulted, so both directions stay deterministic between
// the live (styled) document and a fresh parse of the source XHTML.
// Anything unresolvable returns null: the caller falls back to the fraction,
// it never invents another position format.

import {
  crOffsetFromRaw, formatXPointer, rawOffsetFromCr,
  type CrTextMode, type ParsedXPointer, type XPointerParts,
} from '../core/progress/xpointer';

const TEXT_NODE = 3;
const CDATA_NODE = 4;
const ELEMENT_NODE = 1;

const BLOCK = new Set([
  'address', 'article', 'aside', 'blockquote', 'body', 'caption', 'center', 'dd', 'details', 'dir', 'div', 'dl',
  'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header',
  'hgroup', 'hr', 'li', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'summary', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'tr', 'ul',
]);
const PRE = new Set(['pre', 'textarea', 'listing', 'xmp', 'plaintext']);

const isText = (n: Node): n is Text => n.nodeType === TEXT_NODE || n.nodeType === CDATA_NODE;
const isElement = (n: Node): n is Element => n.nodeType === ELEMENT_NODE;
const nameOf = (el: Element): string => (el.localName || el.nodeName).toLowerCase();
const isTransparent = (n: Node): boolean => isElement(n) && n.hasAttribute('data-concentration');
const isBlock = (el: Element): boolean => BLOCK.has(nameOf(el));
const isWhitespace = (s: string): boolean => /^[ \r\n\t]*$/.test(s);

const inPre = (el: Element): boolean => {
  for (let e: Element | null = el; e; e = e.parentElement) if (PRE.has(nameOf(e))) return true;
  return false;
};

interface Piece { node: Text; start: number }
interface TextItem { kind: 'text'; pieces: Piece[]; text: string; kept: boolean; mode: CrTextMode }
type Item = { kind: 'el'; el: Element } | TextItem;

/** children as CREngine sees them: processed text nodes + real elements */
function logicalChildren(parent: Element): Item[] {
  const items: Item[] = [];
  let run: TextItem | null = null;
  const visit = (node: Node): void => {
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (isText(child)) {
        if (!run) {
          run = { kind: 'text', pieces: [], text: '', kept: true, mode: { pre: false, stripLeadingNewline: false } };
          items.push(run);
        }
        run.pieces.push({ node: child, start: run.text.length });
        run.text += child.data;
      } else if (isTransparent(child)) {
        visit(child);
      } else if (isElement(child)) {
        run = null;
        items.push({ kind: 'el', el: child });
      }
      // comments / processing instructions are skipped by the XML parser
    }
  };
  visit(parent);
  const pre = inPre(parent);
  const parentBlock = isBlock(parent);
  const hasBlockChild = items.some((it) => it.kind === 'el' && isBlock(it.el));
  const blockOrEdge = (it: Item | undefined): boolean => !it || (it.kind === 'el' && isBlock(it.el));
  items.forEach((it, i) => {
    if (it.kind !== 'text') return;
    it.mode = { pre, stripLeadingNewline: pre && i === 0 && PRE.has(nameOf(parent)) };
    if (pre || !isWhitespace(it.text)) return;
    if (i === 0 && parentBlock) it.kept = false;
    else if (hasBlockChild && (blockOrEdge(items[i - 1]) || blockOrEdge(items[i + 1]))) it.kept = false;
  });
  return items;
}

const keptTexts = (items: Item[]): TextItem[] => items.filter((it): it is TextItem => it.kind === 'text' && it.kept);

const logicalParent = (node: Node): Element | null => {
  let p = node.parentNode;
  while (p && isTransparent(p)) p = p.parentNode;
  return p && isElement(p) ? p : null;
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
    if (!parent) return null;
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
  // skip text CREngine drops (whitespace at block boundaries)
  for (let guard = 0; text && guard < 10000; guard++) {
    const parent = logicalParent(text);
    if (!parent) return null;
    const texts = keptTexts(logicalChildren(parent));
    const run = texts.find((it) => it.pieces.some((p) => p.node === text));
    if (run) {
      const piece = run.pieces.find((p) => p.node === text)!;
      const steps = elementSteps(parent, body);
      if (!steps) return null;
      return formatXPointer({
        sectionIndex,
        sectionCount,
        steps,
        text: {
          index: texts.indexOf(run) + 1,
          count: texts.length,
          offset: crOffsetFromRaw(run.text, piece.start + Math.min(utf16, text.data.length), run.mode),
        },
      });
    }
    text = firstTextFrom(following(text, body, true), body);
    utf16 = 0;
  }
  // no text after the point (image-only tail…): address the element itself
  const el = isElement(container) ? container : logicalParent(container);
  if (!el) return null;
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
  const run = keptTexts(logicalChildren(cur))[xp.text.index - 1];
  if (!run) return null;
  const target = rawOffsetFromCr(run.text, xp.text.offset, run.mode);
  let piece = run.pieces[0]!;
  for (const p of run.pieces) if (p.start <= target) piece = p;
  range.setStart(piece.node, Math.min(target - piece.start, piece.node.data.length));
  range.collapse(true);
  return range;
}
