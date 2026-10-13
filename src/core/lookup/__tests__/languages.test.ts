import { byCode, LOOKUP_LANGUAGES, wiktionarySubdomain } from '../languages';

describe('lookup languages', () => {
  it('has at least 40 unique ISO codes with labels in both languages', () => {
    expect(LOOKUP_LANGUAGES.length).toBeGreaterThanOrEqual(40);
    const codes = new Set(LOOKUP_LANGUAGES.map((l) => l.code));
    expect(codes.size).toBe(LOOKUP_LANGUAGES.length);
    for (const l of LOOKUP_LANGUAGES) {
      expect(l.wiktionary).toMatch(/^[a-z-]+$/);
      expect(l.label.fr.length).toBeGreaterThan(0);
      expect(l.label.en.length).toBeGreaterThan(0);
    }
  });

  it('covers the major European languages', () => {
    for (const c of ['fr','en','de','es','it','pt','nl','ru','el','tr','pl','sv','uk','cs','da','fi','hu','ro','bg','hr','sk','sl','sr','lt','lv','et','ga','is','mt','sq','hy','az','eu','be','bs','ca','gl','mk','lb','ka','cy','gd']) {
      expect(byCode(c)).toBeDefined();
    }
  });

  it('returns null for unknown codes', () => {
    expect(byCode('zz')).toBeNull();
  });

  it('normalizes BCP-47 tags and falls back to en', () => {
    expect(wiktionarySubdomain('fr-FR')).toBe('fr');
    expect(wiktionarySubdomain('fr')).toBe('fr');
    expect(wiktionarySubdomain(null)).toBe('en');
    expect(wiktionarySubdomain('zz')).toBe('en');
  });
});
