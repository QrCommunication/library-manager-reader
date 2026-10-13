import { createHeadlessExtractor, ExtractionError } from '../metadataPort';

const makeFs = (chunks: string[]) => ({
  readBase64Chunks: async (_p: string, _size: number, onChunk: (b64: string) => Promise<void>) => {
    for (const c of chunks) await onChunk(c);
  },
  fileSize: async () => 100,
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('headless extractor ready gate', () => {
  it('sends nothing until engineReady arrives, then streams the extraction', async () => {
    const sent: string[] = [];
    const port = createHeadlessExtractor((raw) => sent.push(raw), makeFs(['QQ==']) as never);

    const extracting = port.extract({ path: '/f.epub', format: 'epub', size: 1 });
    await flush();
    // not booted yet: the extract request must NOT be sent into the void
    expect(sent).toHaveLength(0);

    port.handleRaw(JSON.stringify({ type: 'engineReady', protocolVersion: 1 }));
    await flush();
    expect(sent.map((raw) => JSON.parse(raw).type)).toEqual(['extract', 'data', 'dataEnd']);

    port.handleRaw(JSON.stringify({
      type: 'extractResult', requestId: JSON.parse(sent[0]!).requestId, ok: true,
      metadata: { title: 'T', author: null, language: null, publisher: null, identifier: null, coverJpegBase64: null },
      cbzBase64: null,
    }));
    await expect(extracting).resolves.toMatchObject({ metadata: { title: 'T' } });
  });

  it('extract() proceeds immediately when the engine already booted', async () => {
    const sent: string[] = [];
    const port = createHeadlessExtractor((raw) => sent.push(raw), makeFs([]) as never);
    port.handleRaw(JSON.stringify({ type: 'engineReady', protocolVersion: 1 }));

    const extracting = port.extract({ path: '/f.epub', format: 'epub', size: 1 });
    await flush();
    expect(sent.map((raw) => JSON.parse(raw).type)).toEqual(['extract', 'dataEnd']);

    port.handleRaw(JSON.stringify({
      type: 'extractResult', requestId: JSON.parse(sent[0]!).requestId, ok: true,
      metadata: { title: 'T2', author: null, language: null, publisher: null, identifier: null, coverJpegBase64: null },
      cbzBase64: null,
    }));
    await expect(extracting).resolves.toMatchObject({ metadata: { title: 'T2' } });
  });

  it('rejects with ExtractionError when the engine never boots', async () => {
    jest.useFakeTimers();
    try {
      const sent: string[] = [];
      const port = createHeadlessExtractor((raw) => sent.push(raw), makeFs([]) as never);
      const extracting = port.extract({ path: '/f.epub', format: 'epub', size: 1 });
      await jest.advanceTimersByTimeAsync(0);
      expect(sent).toHaveLength(0);
      const assertion = expect(extracting).rejects.toBeInstanceOf(ExtractionError);
      await jest.advanceTimersByTimeAsync(60_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects with ExtractionError when the engine boots but never replies', async () => {
    jest.useFakeTimers();
    try {
      const sent: string[] = [];
      const port = createHeadlessExtractor((raw) => sent.push(raw), makeFs([]) as never);
      port.handleRaw(JSON.stringify({ type: 'engineReady', protocolVersion: 1 }));
      const extracting = port.extract({ path: '/f.epub', format: 'epub', size: 1 });
      await jest.advanceTimersByTimeAsync(0);
      expect(sent.length).toBeGreaterThan(0);
      const assertion = expect(extracting).rejects.toBeInstanceOf(ExtractionError);
      await jest.advanceTimersByTimeAsync(60_000);
      await assertion;
    } finally {
      jest.useRealTimers();
    }
  });
});
