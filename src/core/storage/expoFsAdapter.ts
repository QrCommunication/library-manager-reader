import { File, Directory, Paths } from 'expo-file-system';
import { readAsStringAsync, EncodingType, getFreeDiskStorageAsync } from 'expo-file-system/legacy';
import { decode } from 'base64-arraybuffer';
import type { FsAdapter } from './fsAdapter';

export function createExpoFsAdapter(): FsAdapter {
  return {
    async freeDiskBytes() { return getFreeDiskStorageAsync(); },
    async ensureDir(path) { new Directory(path).create({ idempotent: true, intermediates: true }); },
    async copy(from, to) { await new File(from).copy(new File(to), { overwrite: true }); },
    async exists(path) { return new File(path).exists; },
    async remove(path) { const f = new File(path); if (f.exists) f.delete(); },
    async fileSize(path) { return new File(path).size; },
    async writeBase64(path, b64) { new File(path).write(new Uint8Array(decode(b64))); },
    async readBase64Chunks(path, chunkSize, onChunk) {
      const size = new File(path).size;
      for (let pos = 0; pos < size; pos += chunkSize) {
        const length = Math.min(chunkSize, size - pos);
        const b64 = await readAsStringAsync(path, { position: pos, length, encoding: EncodingType.Base64 });
        await onChunk(b64);
      }
    },
    async directorySize(path) {
      const dir = new Directory(path);
      if (!dir.exists) return 0;
      let total = 0;
      for (const entry of dir.list()) if (entry instanceof File) total += entry.size;
      return total;
    },
  };
}
export const documentRoot = () => Paths.document.uri;
