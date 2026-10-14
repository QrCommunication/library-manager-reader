import { ReaderBridge } from '../bridge';
import type { BookTransport } from '../bookTransport';

const enc = (o: unknown) => JSON.stringify(o);

function makeTransport(chunks: string[]): BookTransport {
  return {
    read: async (_book, send, onProgress) => {
      for (let i = 0; i < chunks.length; i++) { await send(chunks[i]!, i); onProgress?.((i + 1) / chunks.length); }
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('ReaderBridge', () => {
  it('handshakes and opens a book with backpressured chunking', async () => {
    const transport = makeTransport(['AAA', 'BBB']);
    const outbox: string[] = [];
    const bridge = new ReaderBridge((raw) => outbox.push(raw), transport);
    const ready = bridge.whenReady();
    bridge.handleRaw(enc({ type: 'engineReady', protocolVersion: 1 }));
    expect(await ready).toBe(1);

    const opened = bridge.openBook({ format: 'epub', path: '/b.epub', size: 6 });
    await flush();
    // chunk 0 sent; nothing further until dataAck 0 arrives
    const afterFirst = outbox.filter((m) => m.includes('"openBook"') || m.includes('"data"')).length;
    expect(afterFirst).toBe(2); // openBook + data seq 0

    bridge.handleRaw(enc({ type: 'dataAck', seq: 0 }));
    await flush();
    bridge.handleRaw(enc({ type: 'dataAck', seq: 1 }));
    await flush();
    expect(outbox.some((m) => m.includes('"dataEnd"'))).toBe(true);

    bridge.handleRaw(enc({ type: 'bookLoaded', toc: [{ label: 'C1', target: 'h1' }], metadata: { title: 'T', author: null, language: null, publisher: null, identifier: null, coverJpegBase64: null } }));
    const result = await opened;
    expect(result.toc).toEqual([{ label: 'C1', target: 'h1' }]);
  });

  it('captureBookmark resolves with the next captured event', async () => {
    const transport = makeTransport([]);
    const bridge = new ReaderBridge(() => {}, transport);
    const p = bridge.captureBookmark();
    bridge.handleRaw(enc({ type: 'bookmarkCaptured', target: 'epubcfi(6/2)', fraction: 0.42, excerpt: 'once upon' }));
    await expect(p).resolves.toEqual({ target: 'epubcfi(6/2)', fraction: 0.42, excerpt: 'once upon' });
  });

  it('ignores unknown messages without throwing', () => {
    const bridge = new ReaderBridge(() => {}, makeTransport([]));
    expect(() => bridge.handleRaw('garbage')).not.toThrow();
    expect(() => bridge.handleRaw(enc({ type: 'fromTheFuture', x: 1 }))).not.toThrow();
  });

  it('maps fraction: bookmark targets to goToFraction', () => {
    const outbox: string[] = [];
    const bridge = new ReaderBridge((raw) => outbox.push(raw), makeTransport([]));
    bridge.goTo('fraction:0.42');
    expect(outbox).toHaveLength(1);
    expect(JSON.parse(outbox[0]!)).toMatchObject({ type: 'goToFraction', fraction: 0.42 });
  });

  it('keeps cfi targets on goTo unchanged', () => {
    const outbox: string[] = [];
    const bridge = new ReaderBridge((raw) => outbox.push(raw), makeTransport([]));
    bridge.goTo('epubcfi(6/2!/4)');
    expect(outbox).toHaveLength(1);
    expect(JSON.parse(outbox[0]!)).toMatchObject({ type: 'goTo', target: 'epubcfi(6/2!/4)' });
  });
});

describe('v1.x subscriptions and commands', () => {
  const makeBridge = () => {
    const sent: string[] = [];
    const bridge = new ReaderBridge((raw: string) => sent.push(raw), makeTransport([]));
    return { bridge, sent };
  };

  it('notifies selection subscribers until unsubscribed', () => {
    const { bridge } = makeBridge();
    const seen: unknown[] = [];
    const off = bridge.onSelectionChanged((s) => seen.push(s));
    bridge.handleRaw(JSON.stringify({ type: 'selectionChanged', text: 'mot', rect: { x: 1, y: 2, width: 3, height: 4 }, cfi: 'cfi-1', lang: 'fr' }));
    off();
    bridge.handleRaw(JSON.stringify({ type: 'selectionChanged', text: null, rect: null, cfi: null, lang: null }));
    expect(seen).toEqual([{ text: 'mot', rect: { x: 1, y: 2, width: 3, height: 4 }, cfi: 'cfi-1', lang: 'fr' }]);
  });

  it('notifies search and tts subscribers', () => {
    const { bridge } = makeBridge();
    const results: unknown[] = [];
    const done: number[] = [];
    const sentences: unknown[] = [];
    bridge.onSearchResult((r) => results.push(r));
    bridge.onSearchDone((c) => done.push(c));
    bridge.onTtsSentence((s) => sentences.push(s));
    bridge.handleRaw(JSON.stringify({ type: 'searchResult', cfi: 'c1', excerpt: 'x', fraction: 0.1 }));
    bridge.handleRaw(JSON.stringify({ type: 'searchDone', count: 1 }));
    bridge.handleRaw(JSON.stringify({ type: 'ttsSentence', text: 'Phrase.', cfi: 'c2' }));
    expect(results).toEqual([{ cfi: 'c1', excerpt: 'x', fraction: 0.1 }]);
    expect(done).toEqual([1]);
    expect(sentences).toEqual([{ text: 'Phrase.', cfi: 'c2' }]);
  });

  it('notifies chrome toggle subscribers until unsubscribed', () => {
    const { bridge } = makeBridge();
    let toggles = 0;
    const off = bridge.onChromeToggle(() => { toggles += 1; });
    bridge.handleRaw(JSON.stringify({ type: 'chromeToggle' }));
    off();
    bridge.handleRaw(JSON.stringify({ type: 'chromeToggle' }));
    expect(toggles).toBe(1);
  });

  it('notifies open-settings subscribers until unsubscribed', () => {
    const { bridge } = makeBridge();
    let opens = 0;
    const off = bridge.onOpenSettings(() => { opens += 1; });
    bridge.handleRaw(JSON.stringify({ type: 'openSettings' }));
    off();
    bridge.handleRaw(JSON.stringify({ type: 'openSettings' }));
    expect(opens).toBe(1);
  });

  it('forwards the resume target on openBook and notifies resumeApplied subscribers', async () => {
    const transport = makeTransport([]);
    const outbox: string[] = [];
    const bridge = new ReaderBridge((raw) => outbox.push(raw), transport);
    bridge.handleRaw(enc({ type: 'engineReady', protocolVersion: 1 }));
    const resumed: boolean[] = [];
    const off = bridge.onResumeApplied(() => resumed.push(true));
    const opened = bridge.openBook({ format: 'epub', path: '/b.epub', size: 6, resume: { cfi: 'c7', fraction: 0.7 } });
    await flush();
    expect(JSON.parse(outbox[0]!)).toMatchObject({ type: 'openBook', resume: { cfi: 'c7', fraction: 0.7 } });
    // no resume field emitted when none provided (wire stays minimal for older engines)
    bridge.handleRaw(enc({ type: 'bookLoaded', toc: [], metadata: { title: 'T', author: null, language: null, publisher: null, identifier: null, coverJpegBase64: null } }));
    await opened;
    expect(resumed).toEqual([]);
    bridge.handleRaw(enc({ type: 'resumeApplied' }));
    expect(resumed).toEqual([true]);
    off();
    bridge.handleRaw(enc({ type: 'resumeApplied' }));
    expect(resumed).toEqual([true]);
    const bare = new ReaderBridge((raw) => outbox.push(raw), makeTransport([]));
    bare.handleRaw(enc({ type: 'engineReady', protocolVersion: 1 }));
    const bareOpened = bare.openBook({ format: 'epub', path: '/b.epub', size: 6 });
    await flush();
    bare.handleRaw(enc({ type: 'bookLoaded', toc: [], metadata: { title: 'T', author: null, language: null, publisher: null, identifier: null, coverJpegBase64: null } }));
    await bareOpened;
    expect(JSON.parse(outbox.at(-1)!)).not.toHaveProperty('resume');
  });

  it('emits highlight, search and tts commands', () => {
    const { bridge, sent } = makeBridge();
    bridge.addHighlight('a1', 'cfi-9', 'green');
    bridge.removeHighlight('a1');
    bridge.copySelection();
    bridge.search('mot');
    bridge.searchCancel();
    bridge.ttsStart(null);
    bridge.ttsStop();
    bridge.ttsNext();
    expect(sent.map((s) => JSON.parse(s) as { type: string }).map((m) => m.type)).toEqual([
      'addHighlight', 'removeHighlight', 'copySelection', 'search', 'searchCancel', 'ttsStart', 'ttsStop', 'ttsNext',
    ]);
  });
});
