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
const mockLoadListeners: ((e: unknown) => void)[] = [];
let mockInitCalls = 0;
// headless extraction must parse via makeBook (pure data), never via the renderer
const mockMakeBook = jest.fn();
// concentration live-toggle: the section doc the renderer reports + setStyles calls
let mockCurrentDoc: unknown = null;
const mockStyleCalls: string[] = [];

jest.mock('foliate-js/view.js', () => ({
  View: class {
    // no renderer pre-open (mirrors real foliate: renderer exists only after open)
    renderer = {
      setStyles(css: string): void { mockStyleCalls.push(css); },
      getContents(): { index: number; doc?: unknown }[] {
        return mockCurrentDoc ? [{ index: 0, doc: mockCurrentDoc }] : [];
      },
      async next(): Promise<void> {},
      async prev(): Promise<void> {},
    };
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
      // foliate always dispatches a real event: the engine's listener reads
      // e.detail — open emits one without a section doc (the doc arrives with
      // the first render driven by init())
      for (const fn of [...mockLoadListeners]) fn({ detail: { doc: null, index: 0 } });
    }
    // real foliate: init() drives the first render that makes 'load' fire;
    // open() alone never displays anything
    async init(): Promise<void> { mockInitCalls++; }
    goTo(): void { throw new Error('goTo on unloaded book'); }
    goToFraction(): void { throw new Error('goToFraction on unloaded book'); }
  },
  makeBook: mockMakeBook,
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

// ---- minimal DOM stubs for the concentration (bionic) transform ----
type StubNode = {
  nodeType: number; tagName?: string; textContent?: string; parentNode: StubNode | null;
  childNodes: StubNode[];
  append(...ns: StubNode[]): void;
  replaceChild(fresh: StubNode, old: StubNode): void;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, fn: () => void): void;
  querySelectorAll(selector: string): StubNode[];
};

const stubElement = (tag: string): StubNode => ({
  nodeType: 1, tagName: tag, textContent: '', parentNode: null, childNodes: [],
  append(...ns) { for (const n of ns) { n.parentNode = this; this.childNodes.push(n); } },
  replaceChild(fresh, old) {
    const i = this.childNodes.indexOf(old);
    if (i < 0) return;
    // real DOM: fragments splice their children in, plain nodes insert as-is;
    // inserting re-parents each inserted child
    const inserted = fresh.nodeType === 11 ? fresh.childNodes : [fresh];
    this.childNodes.splice(i, 1, ...inserted);
    for (const n of inserted) n.parentNode = this;
  },
  setAttribute() {},
  addEventListener() {},
  querySelectorAll(selector) {
    if (!selector.startsWith('b[')) return [];
    const found: StubNode[] = [];
    const scan = (n: StubNode) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 1) { if (c.tagName === 'b') found.push(c); scan(c); }
      }
    };
    scan(this);
    return found;
  },
});

const stubText = (text: string): StubNode => ({
  nodeType: 3, textContent: text, parentNode: null, childNodes: [],
  append() {}, replaceChild() {}, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [],
});

const stubFragment = (): StubNode => ({
  nodeType: 11, textContent: '', parentNode: null, childNodes: [],
  append(...ns) { for (const n of ns) { n.parentNode = this; this.childNodes.push(n); } },
  replaceChild() {}, setAttribute() {}, addEventListener() {}, querySelectorAll: () => [],
});

const makeStubDoc = (bodyText: string): Document & { body: StubNode } => {
  const body = stubElement('body');
  body.append(stubText(bodyText));
  return { body, addEventListener: () => {}, querySelectorAll: () => [] } as unknown as Document & { body: StubNode };
};

const boldSegments = (body: StubNode): string[] => {
  const out: string[] = [];
  const scan = (n: StubNode) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 1 && c.tagName === 'b') out.push(c.textContent ?? '');
      else scan(c);
    }
  };
  scan(body);
  return out;
};

const plainText = (body: StubNode): string => {
  let out = '';
  const scan = (n: StubNode) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += c.textContent ?? '';
      else scan(c);
    }
  };
  scan(body);
  return out;
};

// drive the module-level 'load' listeners the way foliate dispatches them
const fireLoad = (doc: unknown, index = 0): void => {
  for (const fn of [...mockLoadListeners]) (fn as (e: unknown) => void)({ detail: { doc, index } });
};

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
    feed({ type: 'applySettings', settings: { fontFamily: 'serif', fontSize: 18, lineHeight: 1.6, margin: 20, theme: 'day', ttsRate: 1, brightness: 0, concentration: false } });
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

describe('engine opens visible-reader payloads as named Files (foliate sniffs format from file.name)', () => {
  beforeEach(() => {
    posted = [];
    mockOpened.length = 0;
    mockInitCalls = 0;
    mockMakeBook.mockReset();
    // esbuild define absent under jest: provide the base64 global the engine reads
    (globalThis as Record<string, unknown>).__UNRAR_WASM_B64__ = 'QQ==';
  });

  it('openBook epub: opens the assembled payload as a File named book.epub', async () => {
    feed({ type: 'openBook', format: 'epub', size: 1 });
    feed({ type: 'data', seq: 0, base64: 'QQ==' });
    await flush();
    expect(mockOpened).toHaveLength(1);
    expect(mockOpened[0]).toBeInstanceOf(File);
    expect((mockOpened[0] as File).name).toBe('book.epub');
    expect(mockInitCalls).toBe(1);
  });
});

describe('engine extracts metadata headlessly via makeBook (never the renderer)', () => {
  beforeEach(() => {
    posted = [];
    mockOpened.length = 0;
    mockInitCalls = 0;
    mockMakeBook.mockReset();
    (globalThis as Record<string, unknown>).__UNRAR_WASM_B64__ = 'QQ==';
    const { createExtractorFromData } = jest.requireMock('node-unrar-js') as { createExtractorFromData: jest.Mock };
    createExtractorFromData.mockImplementation(async () => ({
      getFileList: () => ({ fileHeaders: [{ name: 'p1.jpg' }] }),
      extract: () => ({
        files: [{ fileHeader: { name: 'p1.jpg' }, extraction: new Uint8Array([0xff, 0xd8, 0xff]).buffer }],
      }),
    }));
  });

  it('extract epub: parses via makeBook with a File named book.epub and normalizes metadata', async () => {
    mockMakeBook.mockImplementation(async () => ({
      metadata: {
        title: 'Titre', author: [{ name: 'Auteure' }], language: ['fr'],
        publisher: { name: 'Éditeur' }, identifier: { scheme: 'urn', value: 'isbn:1234567890' },
      },
    }));
    feed({ type: 'extract', requestId: 'r1', format: 'epub', size: 1 });
    feed({ type: 'data', seq: 0, base64: 'QQ==' });
    await flush();
    const res = posted.find((m) => m.type === 'extractResult');
    expect(res).toMatchObject({
      requestId: 'r1', ok: true, cbzBase64: null,
      // foliate metadata is polymorphic (LanguageMap objects, contributor arrays):
      // the protocol carries flat strings — sending raw shapes would poison the DB row
      metadata: { title: 'Titre', author: 'Auteure', language: 'fr', publisher: 'Éditeur', identifier: 'isbn:1234567890', coverJpegBase64: null },
    });
    expect(mockMakeBook).toHaveBeenCalledTimes(1);
    const file = mockMakeBook.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('book.epub');
    // on device the old path drove a full render in the 1×1 hidden WebView; the
    // first render never completed there and every import died in the 60s timeout
    expect(mockOpened).toHaveLength(0);
    expect(mockInitCalls).toBe(0);
  });

  it('extract cbr: converts to cbz and hands makeBook a File named book.cbz', async () => {
    mockMakeBook.mockImplementation(async () => ({ metadata: {} }));
    feed({ type: 'extract', requestId: 'r2', format: 'cbr', size: 1 });
    feed({ type: 'data', seq: 0, base64: 'QQ==' });
    await flush();
    const res = posted.find((m) => m.type === 'extractResult') as { ok?: boolean; cbzBase64?: string | null };
    expect(res?.ok).toBe(true);
    expect(typeof res?.cbzBase64).toBe('string');
    const file = mockMakeBook.mock.calls[0][0] as File;
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe('book.cbz');
    expect(mockOpened).toHaveLength(0);
  });

  it('extract reports parse failures as ok:false without swallowing into a hang', async () => {
    mockMakeBook.mockRejectedValue(new Error('unsupported magic'));
    feed({ type: 'extract', requestId: 'r4', format: 'epub', size: 1 });
    feed({ type: 'data', seq: 0, base64: 'QQ==' });
    await flush();
    const res = posted.find((m) => m.type === 'extractResult');
    expect(res).toMatchObject({ requestId: 'r4', ok: false });
    expect(String((res as { error?: string }).error)).toMatch(/unsupported magic/);
    // the failure is the extractResult itself — no duplicate engineError noise
    expect(engineErrors()).toHaveLength(0);
  });

  it('watchdog: a stalled extraction answers ok:false naming the stage, before the app 60s timeout', async () => {
    jest.useFakeTimers();
    try {
      mockMakeBook.mockImplementation(() => new Promise(() => { /* never settles */ }));
      feed({ type: 'extract', requestId: 'r5', format: 'epub', size: 1 });
      feed({ type: 'data', seq: 0, base64: 'QQ==' });
      await jest.advanceTimersByTimeAsync(44_000);
      expect(posted.find((m) => m.type === 'extractResult')).toBeUndefined();
      await jest.advanceTimersByTimeAsync(1_500);
      const res = posted.find((m) => m.type === 'extractResult') as { ok?: boolean; error?: string } | undefined;
      expect(res?.ok).toBe(false);
      expect(String(res?.error)).toMatch(/makeBook/);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('engine concentration mode (bionic word starts)', () => {
  const BASE = {
    fontFamily: 'serif', fontSize: 18, lineHeight: 1.6, margin: 20,
    theme: 'day', ttsRate: 1, brightness: 0, concentration: false,
  };

  beforeEach(async () => {
    posted = [];
    mockOpened.length = 0;
    mockInitCalls = 0;
    mockMakeBook.mockReset();
    mockCurrentDoc = null;
    mockStyleCalls.length = 0;
    const docGlobal = globalThis.document as unknown as Record<string, unknown>;
    docGlobal.createDocumentFragment = () => stubFragment();
    docGlobal.createElement = (tag: string) => stubElement(tag);
    docGlobal.createTextNode = (text: string) => stubText(text);
    // the engine module keeps settings/documentLoaded across tests in this file:
    // pin a known baseline (book loaded, concentration off) through the real
    // protocol so no test depends on execution order
    fireLoad(makeStubDoc('intro'));
    feed({ type: 'applySettings', settings: { ...BASE } });
    await flush();
    mockStyleCalls.length = 0;
  });

  it('bolds word starts synchronously at section load when enabled', async () => {
    // first load unlocks post-load settings handling (documentLoaded)
    fireLoad(makeStubDoc('intro'));
    await flush();
    expect(posted.some((m) => m.type === 'engineError')).toBe(false);

    const doc = makeStubDoc('Bonjour le monde');
    mockCurrentDoc = doc;
    feed({ type: 'applySettings', settings: { ...BASE, concentration: true } });
    await flush();
    // live toggle: the displayed section is transformed immediately and setStyles
    // drives the paginator re-measure
    expect(boldSegments(doc.body)).toEqual(['Bon', 'l', 'mo']);
    expect(mockStyleCalls).toHaveLength(1);
    // every subsequently loaded section is transformed pre-pagination
    const doc2 = makeStubDoc('Salut toi');
    fireLoad(doc2, 1);
    expect(boldSegments(doc2.body)).toEqual(['Sa', 't']);
    expect(posted.some((m) => m.type === 'engineError')).toBe(false);
  });

  it('un-bolds on live toggle-off', async () => {
    fireLoad(makeStubDoc('intro'));
    await flush();
    const doc = makeStubDoc('Bonjour le monde');
    mockCurrentDoc = doc;
    feed({ type: 'applySettings', settings: { ...BASE, concentration: true } });
    await flush();
    expect(boldSegments(doc.body)).toHaveLength(3);
    feed({ type: 'applySettings', settings: { ...BASE, concentration: false } });
    await flush();
    expect(boldSegments(doc.body)).toHaveLength(0);
    expect(plainText(doc.body)).toBe('Bonjour le monde');
  });

  it('leaves sections untouched when disabled', async () => {
    const doc = makeStubDoc('Bonjour le monde');
    fireLoad(doc);
    await flush();
    expect(boldSegments(doc.body)).toHaveLength(0);
    expect(plainText(doc.body)).toBe('Bonjour le monde');
  });
});
