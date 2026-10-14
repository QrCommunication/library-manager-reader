import { unzipSync, strFromU8 } from 'fflate';
import { buildExportEntries, displayName, uniqueName, zipEntries } from '../exportService';

describe('displayName', () => {
  it('follows the calibre convention "Author - Title.ext"', () => {
    expect(displayName({ title: 'Dune', author: 'Frank Herbert', format: 'epub', originalFormat: null } as never)).toBe('Frank Herbert - Dune.epub');
  });

  it('falls back to "Title.ext" when the author is unknown', () => {
    expect(displayName({ title: 'Dune', author: null, format: 'epub', originalFormat: null } as never)).toBe('Dune.epub');
  });

  it('uses the on-disk extension (cbr stored as cbz) and sanitizes forbidden characters', () => {
    expect(displayName({ title: 'A/B: "C"?', author: 'X\\Y', format: 'cbz', originalFormat: 'cbr' } as never)).toBe('X_Y - A_B_ _C__.cbz');
  });
});

describe('uniqueName', () => {
  it('keeps the name when free and appends (2), (3)... on collisions', () => {
    expect(uniqueName('Dune.epub', new Set())).toBe('Dune.epub');
    expect(uniqueName('Dune.epub', new Set(['Dune.epub']))).toBe('Dune (2).epub');
    expect(uniqueName('Dune.epub', new Set(['Dune.epub', 'Dune (2).epub']))).toBe('Dune (3).epub');
  });
});

describe('buildExportEntries + zipEntries', () => {
  const files: Record<string, Uint8Array> = {
    '/books/b1.epub': new Uint8Array([1, 2, 3]),
    '/books/b2.cbz': new Uint8Array([4, 5]),
  };
  const deps = {
    fs: { readBytes: async (p: string) => files[p]! },
    paths: { bookPath: (id: string, ext: string) => `/books/${id}.${ext}`, root: '' },
    getProgress: async (id: string) =>
      id === 'b2' ? { bookId: 'b2', cfi: null, fraction: 0.4, sectionIndex: 0, updatedAt: 1700000000 } : null,
  };

  it('returns one renamed entry per book plus KOReader sidecars when progress exists', async () => {
    const entries = await buildExportEntries(deps, [
      { id: 'b1', title: 'Dune', author: 'Frank Herbert', format: 'epub', originalFormat: null, language: null } as never,
      { id: 'b2', title: 'Saga 1', author: null, format: 'cbz', originalFormat: 'cbr', language: null } as never,
    ]);
    const names = entries.map((e) => e.path);
    expect(names).toContain('Frank Herbert - Dune.epub');
    expect(names).toContain('Saga 1.cbz');
    expect(names).toContain('Saga_1.sdr/metadata.cbz.lua');
    expect(entries.find((e) => e.path === 'Saga 1.cbz')!.data).toEqual(new Uint8Array([4, 5]));
  });

  it('zips the entries into a valid archive', async () => {
    const entries = await buildExportEntries(deps, [
      { id: 'b1', title: 'Dune', author: 'Frank Herbert', format: 'epub', originalFormat: null, language: null } as never,
    ]);
    const zip = zipEntries(entries);
    const unzipped = unzipSync(zip);
    expect(strFromU8(unzipped['Frank Herbert - Dune.epub']!)).toEqual(String.fromCharCode(1, 2, 3));
  });
});
