export function convertCbrToCbz(
  _rarBytes: Uint8Array,
  deps: {
    extractImages(data: Uint8Array): { name: string; data: Uint8Array }[];
    zip(files: { name: string; data: Uint8Array }[]): Uint8Array;
  },
): Uint8Array {
  const images = deps.extractImages(_rarBytes).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return deps.zip(images);
}
