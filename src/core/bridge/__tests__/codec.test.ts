import { encodeMessage, parseMessage } from '../codec';
import { PROTOCOL_VERSION, type AppToEngine, type EngineToApp } from '../protocol';

describe('codec', () => {
  it('round-trips a message', () => {
    const msg = { type: 'progress', cfi: 'epubcfi(6/4)', fraction: 0.5, sectionIndex: 2 } as const;
    const parsed = parseMessage(encodeMessage(msg));
    expect(parsed).toEqual(msg);
  });

  it('flags unknown or malformed messages instead of throwing', () => {
    expect(parseMessage('not json').type).toBe('unknown');
    expect(parseMessage('{"type":"fromTheFuture"}').type).toBe('unknown');
    expect(parseMessage('[1,2,3]').type).toBe('unknown');
  });

  it('exposes protocol version 1', () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

describe('additive v1.x messages', () => {
  it('round-trips selectionChanged', () => {
    const msg = { type: 'selectionChanged', text: 'mot', rect: { x: 1, y: 2, width: 3, height: 4 }, cfi: 'epubcfi(/6/4)', lang: 'fr' } as const;
    expect(parseMessage(encodeMessage(msg))).toEqual(msg);
  });

  it('round-trips selectionChanged with nulls', () => {
    const msg = { type: 'selectionChanged', text: null, rect: null, cfi: null, lang: null } as const;
    expect(parseMessage(encodeMessage(msg))).toEqual(msg);
  });

  it('round-trips highlight, search and tts messages', () => {
    const msgs: (AppToEngine | EngineToApp)[] = [
      { type: 'addHighlight', id: 'a1', cfi: 'epubcfi(/6/4)', color: 'yellow' },
      { type: 'removeHighlight', id: 'a1' },
      { type: 'copySelection' },
      { type: 'search', query: 'mot' },
      { type: 'searchCancel' },
      { type: 'searchResult', cfi: 'epubcfi(/6/4)', excerpt: '…mot…', fraction: 0.42 },
      { type: 'searchDone', count: 3 },
      { type: 'ttsStart', cfi: null },
      { type: 'ttsStop' },
      { type: 'ttsNext' },
      { type: 'ttsSentence', text: 'Phrase.', cfi: null },
    ];
    for (const m of msgs) expect(parseMessage(encodeMessage(m))).toEqual(m);
  });

  it('round-trips chromeToggle', () => {
    const msg = { type: 'chromeToggle' } as const;
    expect(parseMessage(encodeMessage(msg))).toEqual(msg);
  });

  it('still rejects unknown engine types', () => {
    expect(parseMessage(JSON.stringify({ type: 'notAThing' })).type).toBe('unknown');
  });
});
