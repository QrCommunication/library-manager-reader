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
