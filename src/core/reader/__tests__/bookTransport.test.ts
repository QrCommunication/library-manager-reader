import { createBase64BookTransport } from '../bookTransport';

const makeFs = (chunks: string[]) => ({
  readBase64Chunks: async (_p: string, size: number, onChunk: (b64: string) => Promise<void>) => {
    for (const c of chunks) await onChunk(c);
  },
  fileSize: async () => 100,
});

describe('createBase64BookTransport', () => {
  it('streams chunks with sequential seq numbers and progress', async () => {
    const sent: { base64: string; seq: number }[] = [];
    const progress: number[] = [];
    const fs = makeFs(['AAA', 'BBB', 'CCC']);
    const t = createBase64BookTransport(fs as never, 3);
    await t.read({ path: '/x', size: 9 }, async (base64, seq) => { sent.push({ base64, seq }); }, (p) => progress.push(p));
    expect(sent.map((s) => s.seq)).toEqual([0, 1, 2]);
    expect(progress).toEqual([1 / 3, 2 / 3, 1]);
  });
});
