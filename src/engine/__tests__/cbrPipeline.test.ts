import { convertCbrToCbz } from '../extractMode';

describe('convertCbrToCbz', () => {
  it('sorts natural-order images and zips them', () => {
    const calls: string[][] = [];
    const rar = new Uint8Array([1, 2, 3]);
    const out = convertCbrToCbz(rar, {
      extractImages: () => [
        { name: 'page10.jpg', data: new Uint8Array([10]) },
        { name: 'page2.jpg', data: new Uint8Array([2]) },
        { name: 'cover.jpg', data: new Uint8Array([1]) },
      ],
      zip: (files) => { calls.push(files.map((f) => f.name)); return new Uint8Array([9, 9]); },
    });
    expect(calls[0]).toEqual(['cover.jpg', 'page2.jpg', 'page10.jpg']);
    expect(Array.from(out)).toEqual([9, 9]);
  });
});
