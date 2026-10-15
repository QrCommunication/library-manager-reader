import {
  codePointsToUtf16, formatXPointer, isXPointer, parseXPointer, utf16ToCodePoints, xpointerOrNull,
} from '../xpointer';

describe('KOReader XPointer (pure)', () => {
  it('parses the canonical example of the contract', () => {
    expect(parseXPointer('/body/DocFragment[2]/body/p[3]/text()[1].42')).toEqual({
      sectionIndex: 1, steps: [{ name: 'p', index: 3 }], text: { index: 1, offset: 42 },
    });
  });

  it('reads a missing index as [1] (CREngine omits it for unique siblings)', () => {
    expect(parseXPointer('/body/DocFragment[10]/body/div/p[4]/text().146')).toEqual({
      sectionIndex: 9, steps: [{ name: 'div', index: 1 }, { name: 'p', index: 4 }], text: { index: 1, offset: 146 },
    });
    expect(parseXPointer('/body/DocFragment/body')).toEqual({ sectionIndex: 0, steps: [], text: null });
  });

  it('accepts element pointers with the CREngine ".0" suffix', () => {
    expect(parseXPointer('/body/DocFragment[3]/body/div/img.0')).toEqual({
      sectionIndex: 2, steps: [{ name: 'div', index: 1 }, { name: 'img', index: 1 }], text: null,
    });
  });

  it.each([
    'epubcfi(/6/4!/4/2/1:0)',
    '{"type":"reader-scroll-v1"}',
    '/body/p[1]',
    '/html/body/DocFragment[1]/body',
    '/body/DocFragment[0]/body',
    '/body/DocFragment[1]/body/text().1/p',
    '/body/DocFragment[1]/body/p[1]/text()[1]',
    '/body/DocFragment[1]/body/p[-1]',
    '',
    `/body/DocFragment[1]/body${'/div'.repeat(2000)}`,
  ])('rejects %s', (value) => {
    expect(parseXPointer(value)).toBeNull();
    expect(isXPointer(value)).toBe(false);
  });

  it('xpointerOrNull never throws on garbage', () => {
    expect(xpointerOrNull(null)).toBeNull();
    expect(xpointerOrNull(42)).toBeNull();
    expect(xpointerOrNull('/body/DocFragment[1]/body/p/text().0')).toBe('/body/DocFragment[1]/body/p/text().0');
  });

  it('formats like CREngine: index only when siblings share the name', () => {
    expect(formatXPointer({
      sectionIndex: 1, sectionCount: 12,
      steps: [{ name: 'div', index: 1, count: 1 }, { name: 'p', index: 3, count: 7 }],
      text: { index: 1, count: 1, offset: 42 },
    })).toBe('/body/DocFragment[2]/body/div/p[3]/text().42');
    expect(formatXPointer({ sectionIndex: 0, sectionCount: 1, steps: [], text: null })).toBe('/body/DocFragment/body');
  });

  it('counts code points (UTF-32), not UTF-16 units', () => {
    const s = 'a😀b';
    expect(s.length).toBe(4);
    expect(utf16ToCodePoints(s, 3)).toBe(2);
    expect(utf16ToCodePoints(s, 4)).toBe(3);
    expect(codePointsToUtf16(s, 2)).toBe(3);
    expect(codePointsToUtf16(s, 99)).toBe(4);
    // an offset splitting a surrogate pair counts the dangling half once
    expect(utf16ToCodePoints(s, 2)).toBe(2);
  });
});
