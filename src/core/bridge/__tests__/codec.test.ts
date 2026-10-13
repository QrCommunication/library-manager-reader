import { encodeMessage, parseMessage } from '../codec';
import { PROTOCOL_VERSION } from '../protocol';

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
