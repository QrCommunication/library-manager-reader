import { hasEnoughSpace } from '../spaceCheck';
import type { FsAdapter } from '../fsAdapter';

const fakeFs = (free: number): FsAdapter => ({ freeDiskBytes: async () => free }) as FsAdapter;

describe('hasEnoughSpace', () => {
  it('requires file size plus margin', async () => {
    const fs = fakeFs(70 * 1024 * 1024);
    await expect(hasEnoughSpace(fs, 20 * 1024 * 1024)).resolves.toBe(true);
    const fs2 = fakeFs(70 * 1024 * 1024);
    await expect(hasEnoughSpace(fs2, 20 * 1024 * 1024 + 1)).resolves.toBe(false);
  });
});
