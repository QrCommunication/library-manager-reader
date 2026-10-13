import type { FsAdapter } from './fsAdapter';

export const MIN_FREE_MARGIN_BYTES = 50 * 1024 * 1024;

export async function hasEnoughSpace(fs: FsAdapter, fileSize: number): Promise<boolean> {
  const free = await fs.freeDiskBytes();
  return free >= fileSize + MIN_FREE_MARGIN_BYTES;
}
