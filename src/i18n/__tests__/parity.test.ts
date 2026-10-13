import { fr } from '../fr';
import { en } from '../en';

const flatten = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (typeof v === 'object' && v !== null ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

describe('i18n key parity', () => {
  it('fr and en expose exactly the same keys', () => {
    expect(flatten(fr).sort()).toEqual(flatten(en).sort());
  });
  it('has no empty strings', () => {
    for (const bundle of [fr, en]) {
      for (const key of flatten(bundle)) {
        const value = key.split('.').reduce<unknown>((acc, k) => (acc as Record<string, unknown>)[k], bundle);
        expect(typeof value).toBe('string');
        expect(value as string).not.toBe('');
      }
    }
  });
});
