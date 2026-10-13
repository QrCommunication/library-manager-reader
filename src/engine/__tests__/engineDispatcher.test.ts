// Engine dispatcher seam tests: the engine module is written for the WebView
// (DOM globals, foliate View, injected RN bridge), so this suite stubs the DOM
// surface and mocks foliate/node-unrar, then requires the REAL engine module.
// Load-bearing behavior under test: handler exceptions must surface as a single
// engineError postMessage instead of being silently swallowed (invisible hang),
// while pre-open navigation/settings stay sanctioned quiet no-ops.

type EngineMsg = { type: string; code?: string; message?: string };
let posted: EngineMsg[] = [];
let bootMessages: EngineMsg[] = [];
// open() captures + 'load' listener bookkeeping (mock-prefixed: referenced from the hoisted factory)
const mockOpened: unknown[] = [];
const mockLoadListeners: (() => void)[] = [];

jest.mock('foliate-js/view.js', () => ({
  View: class {
    // no renderer pre-open (mirrors real foliate: renderer exists only after open)
    renderer: undefined;
    book = { metadata: { title: 'T', author: null, language: null, publisher: null, identifier: null } };
    addEventListener(type: string, fn: () => void): void {
      if (type === 'load') mockLoadListeners.push(fn);
    }
    removeEventListener(type: string, fn: () => void): void {
      if (type !== 'load') return;
      const i = mockLoadListeners.indexOf(fn);
      if (i >= 0) mockLoadListeners.splice(i, 1);
    }
    async open(file: unknown): Promise<void> {
      mockOpened.push(file);
      for (const fn of [...mockLoadListeners]) fn();
    }
    goTo(): void { throw new Error('goTo on unloaded book'); }
    goToFraction(): void { throw new Error('goToFraction on unloaded book'); }
  },
}));

// foliate-js ships pure ESM ("type": "module") and sits in jest's
// transformIgnorePatterns, so the real overlayer.js cannot be parsed here;
// the dispatcher tests never draw, a shape-compatible stub is enough
jest.mock('foliate-js/overlayer.js', () => ({
  Overlayer: class {
    static highlight(): unknown { return {}; }
    static underline(): unknown { return {}; }
    // eslint-disable-next-line @typescript-eslint/no-useless-constructor, @typescript-eslint/no-unused-vars
    constructor(doc: unknown) {}
  },
}));

// same story for the TTS imports the engine now pulls in: never driven in
// these tests (sentence streaming is DOM wiring), stubs only satisfy the imports
jest.mock('foliate-js/tts.js', () => ({
  TTS: class {
    doc: unknown;
    constructor(doc: unknown) { this.doc = doc; }
    start(): string | undefined { return undefined; }
    resume(): string | undefined { return undefined; }
    next(): string | undefined { return undefined; }
    prev(): string | undefined { return undefined; }
  },
}));

jest.mock('foliate-js/text-walker.js', () => ({
  textWalker: function* (_x: unknown, _func: unknown): Generator<unknown> { /* unused */ },
}));

// keep the emscripten unrar glue out of the node test process
jest.mock('node-unrar-js', () => ({ createExtractorFromData: jest.fn() }));

beforeAll(() => {
  (globalThis as { document: unknown }).document = {
    addEventListener: jest.fn(),
    getElementById: () => ({ append: jest.fn(), style: {} }),
  };
  const w = window as unknown as Record<string, unknown>;
  w.addEventListener = jest.fn();
  w.ReactNativeWebView = {
    postMessage: (raw: string) => { posted.push(JSON.parse(raw) as EngineMsg); },
  };
  require('../engine'); // registers its dispatcher as an import side effect
  bootMessages = posted;
});

// feed an app→engine message through the DOM listener the engine registered
const feed = (msg: unknown): void => {
  const doc = globalThis.document as unknown as { addEventListener: jest.Mock };
  const call = doc.addEventListener.mock.calls.find((c: unknown[]) => c[0] === 'message');
  if (!call) throw new Error('engine did not register a message listener');
  (call[1] as (raw: unknown) => void)({ data: JSON.stringify(msg) });
};

const flush = () => new Promise((r) => setTimeout(r, 0));
const engineErrors = () => posted.filter((m) => m.type === 'engineError');

describe('engine dispatcher error surfacing', () => {
  beforeEach(() => { posted = []; });

  it('announces engineReady on boot through the injected bridge', () => {
    expect(bootMessages).toEqual([expect.objectContaining({ type: 'engineReady', protocolVersion: 1 })]);
  });

  it('surfaces a handler exception as one engineError and keeps handling', async () => {
    // data before any openBook: assembler is null → handle throws
    feed({ type: 'data', seq: 0, base64: 'QQ==' });
    await flush();
    expect(engineErrors()).toHaveLength(1);
    expect(engineErrors()[0]).toMatchObject({ code: 'unknown' });
    // subsequent messages must still be processed (no poisoned dispatcher):
    // a chunk overflowing the declared size makes the assembler throw again
    feed({ type: 'openBook', format: 'epub', size: 1 });
    feed({ type: 'data', seq: 0, base64: 'QQI=' }); // 2 bytes > declared 1
    await flush();
    expect(engineErrors()).toHaveLength(2);
    expect(engineErrors()[1]).toMatchObject({ code: 'unknown' });
  });

  it('quiet-ignores pre-open navigation/settings (sanctioned T15/T21)', async () => {
    feed({ type: 'goTo', target: 'epubcfi(6/2)' });
    feed({ type: 'goToFraction', fraction: 0.5 });
    feed({ type: 'next' });
    feed({ type: 'prev' });
    feed({ type: 'applySettings', settings: { fontFamily: 'serif', fontSize: 18, lineHeight: 1.6, margin: 20, theme: 'day' } });
    // TTS commands are gated the same way (ttsStart/ttsNext per the Task 14
    // brief); ttsStop is NOT gated but nulling the null state must stay a
    // silent no-op pre-load
    feed({ type: 'ttsStart', cfi: null });
    feed({ type: 'ttsNext' });
    feed({ type: 'ttsStop' });
    await flush();
    expect(engineErrors()).toHaveLength(0);
    expect(posted.filter((m) => m.type !== 'engineReady')).toHaveLength(0);
  });
});

describe('engine opens payloads as named Files (foliate sniffs format from file.name)', () => {
  beforeEach(() => {
    posted = [];
    mockOpened.length = 0;
    mockLoadListeners.length = 0;
    // esbuild define absent under jest: provide the base64 global the engine reads
    (globalThis as Record<string, unknown>).__UNRAR_WASM_B64__ = 'QQ==';
    const { createExtractorFromData } = jest.requireMock('node-unrar-js') as { createExtractorFromData: jest.Mock };
    createExtractorFromData.mockImplementation(async () => ({
      getFileList: () => ({ fileHeaders: [{ name: 'p1.jpg' }] }),
      extract: () => ({
        files: [{ fileHeader: { name: 'p1.jpg' }, extraction: new Uint8Array([0xff, 0xd8, 0xff]).buffer }],
      }),
    }));
  });

  it('openBook epub: opens the assembled payload as a File named book.epub', async () => {
    feed({ type: 'openBook', format: 'epub', size: 1 });
    feed({ type: 'data', seq: 0, base64: 'QQ==' });
    await flush();
    expect(mockOpened).toHaveLength(1);
    expect(mockOpened[0]).toBeInstanceOf(File);
    expect((mockOpened[0] as File).name).toBe('book.epub');
  });

  it('extract epub: opens a File named book.epub and reports success', async () => {
    feed({ type: 'extract', requestId: 'r1', format: 'epub', size: 1 });
    feed({ type: 'data', seq: 0, base64: 'QQ==' });
    await flush();
    const res = posted.find((m) => m.type === 'extractResult');
    expect(res).toMatchObject({ requestId: 'r1', ok: true });
    expect(mockOpened[0]).toBeInstanceOf(File);
    expect((mockOpened[0] as File).name).toBe('book.epub');
  });

  it('extract cbr: opens the converted archive as a File named book.cbz', async () => {
    feed({ type: 'extract', requestId: 'r2', format: 'cbr', size: 1 });
    feed({ type: 'data', seq: 0, base64: 'QQ==' });
    await flush();
    const res = posted.find((m) => m.type === 'extractResult') as { ok?: boolean; cbzBase64?: string | null };
    expect(res?.ok).toBe(true);
    expect(typeof res?.cbzBase64).toBe('string');
    expect(mockOpened[0]).toBeInstanceOf(File);
    expect((mockOpened[0] as File).name).toBe('book.cbz');
  });
});
