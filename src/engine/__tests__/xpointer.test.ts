/**
 * @jest-environment jsdom
 */
import { parseXPointer } from '../../core/progress/xpointer';
import { boundaryToXPointer, xpointerToRange } from '../xpointer';

const xhtml = (body: string): Document =>
  new DOMParser().parseFromString(
    `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>${body}</body></html>`,
    'application/xhtml+xml',
  );

const roundTrip = (doc: Document, xp: string): { node: Node; offset: number } => {
  const parsed = parseXPointer(xp);
  expect(parsed).not.toBeNull();
  const range = xpointerToRange(doc, parsed!)!;
  expect(range).not.toBeNull();
  return { node: range.startContainer, offset: range.startOffset };
};

describe('engine XPointer ↔ DOM', () => {
  const doc = xhtml(`
    <div>
      <p>Premier paragraphe.</p>
      <p>Deuxième <em>avec</em> du texte 😀 après.</p>
    </div>
    <p>Hors div</p>`);

  it('maps a text boundary to a CREngine-style XPointer (whitespace between blocks ignored)', () => {
    const p2 = doc.querySelectorAll('p')[1]!;
    const tail = p2.lastChild as Text; // " du texte 😀 après."
    const offset = tail.data.indexOf('après');
    const xp = boundaryToXPointer(doc, 4, 9, tail, offset);
    // 😀 is two UTF-16 units but one code point
    expect(xp).toBe(`/body/DocFragment[5]/body/div/p[2]/text()[2].${offset - 1}`);
    expect(roundTrip(doc, xp!)).toEqual({ node: tail, offset });
  });

  it('maps an element boundary to the next meaningful text', () => {
    const div = doc.querySelector('div')!;
    // childNodes[0] is the whitespace before the first <p>
    const xp = boundaryToXPointer(doc, 0, 3, div, 0);
    expect(xp).toBe('/body/DocFragment[1]/body/div/p[1]/text().0');
  });

  it('treats the concentration wrappers as transparent', () => {
    const d = xhtml('<p>Bonjour le monde</p>');
    const p = d.querySelector('p')!;
    // what applyConcentration produces for "Bonjour le monde"
    p.textContent = '';
    const b = (s: string) => { const el = d.createElementNS('http://www.w3.org/1999/xhtml', 'b'); el.setAttribute('data-concentration', ''); el.textContent = s; return el; };
    p.append(d.createTextNode(''), b('Bon'), d.createTextNode('jour '), b('l'), d.createTextNode('e '), b('mo'), d.createTextNode('nde'));
    const node = p.childNodes[4] as Text; // "e "
    const xp = boundaryToXPointer(d, 1, 2, node, 1);
    expect(xp).toBe('/body/DocFragment[2]/body/p/text().10');
    expect(roundTrip(d, xp!)).toEqual({ node, offset: 1 });
  });

  it('resolves to null when the structure does not exist (caller falls back to the fraction)', () => {
    expect(xpointerToRange(doc, parseXPointer('/body/DocFragment[1]/body/div/p[9]/text().0')!)).toBeNull();
    expect(xpointerToRange(doc, parseXPointer('/body/DocFragment[1]/body/div/p[1]/text()[4].0')!)).toBeNull();
  });

  it('clamps an offset past the end of the text node', () => {
    const p1 = doc.querySelector('p')!;
    const r = roundTrip(doc, '/body/DocFragment[1]/body/div/p[1]/text().9999');
    expect(r).toEqual({ node: p1.firstChild, offset: (p1.firstChild as Text).data.length });
  });

  it('returns null outside the body', () => {
    const title = doc.querySelector('title')!.firstChild!;
    expect(boundaryToXPointer(doc, 0, 1, title, 0)).toBeNull();
  });

  it('addresses the element when no text follows', () => {
    const d = xhtml('<p>texte</p><div><img src="a.png"/></div>');
    const div = d.querySelector('div')!;
    expect(boundaryToXPointer(d, 0, 2, div, 0)).toBe('/body/DocFragment[1]/body/div');
  });

  it('counts offsets in CREngine-processed text (collapsed whitespace), not raw DOM units', () => {
    const d = xhtml('<p>Il était\n      une   fois</p>');
    const t = d.querySelector('p')!.firstChild as Text;
    const raw = t.data.indexOf('fois');
    // CREngine text: "Il était une fois" → "fois" starts at code point 13
    const xp = boundaryToXPointer(d, 0, 1, t, raw);
    expect(xp).toBe('/body/DocFragment/body/p/text().13');
    expect(roundTrip(d, xp!)).toEqual({ node: t, offset: raw });
  });

  it('keeps <pre> whitespace verbatim but strips the newline after the start tag', () => {
    const d = xhtml('<pre>\na  b\n c</pre>');
    const t = d.querySelector('pre')!.firstChild as Text;
    const xp = boundaryToXPointer(d, 0, 1, t, t.data.indexOf('c'));
    // CREngine text "a  b\n c": c is code point 6
    expect(xp).toBe('/body/DocFragment/body/pre/text().6');
    expect(roundTrip(d, xp!)).toEqual({ node: t, offset: t.data.indexOf('c') });
  });

  it('indexes whitespace text between inline elements (kept by CREngine)', () => {
    const d = xhtml('<p><b>un</b> <i>deux</i> trois</p>');
    const p = d.querySelector('p')!;
    const last = p.lastChild as Text; // " trois"
    expect(boundaryToXPointer(d, 0, 1, last, 1)).toBe('/body/DocFragment/body/p/text()[2].1');
  });

  it('drops whitespace-only text bordering blocks inside a mixed container', () => {
    const d = xhtml('<div>\n  <p>a</p>\n  texte libre\n  <p>b</p>\n</div>');
    const div = d.querySelector('div')!;
    const free = Array.from(div.childNodes).find((n) => n.nodeType === 3 && /texte/.test((n as Text).data)) as Text;
    expect(boundaryToXPointer(d, 0, 1, free, free.data.indexOf('texte'))).toBe('/body/DocFragment/body/div/text().1');
  });
});

