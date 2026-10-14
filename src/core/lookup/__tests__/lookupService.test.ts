import { createLookupService, LookupError } from '../lookupService';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const fetchOk = (status: number, body: unknown) =>
  jest.fn(async () => jsonResponse(status, body));

describe('lookupService.define', () => {
  it('parses Wiktionary senses, strips HTML and truncates long glosses', async () => {
    const fetched = fetchOk(200, {
      English: [{
        partOfSpeech: 'Noun',
        definitions: [
          { definition: 'A <b>book</b> &amp; its pages' },
          { definition: 'x'.repeat(400) },
        ],
      }],
    });
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch });
    const senses = await service.define('book', 'en');
    expect(senses).toEqual([{ pos: 'Noun', glosses: ['A book & its pages', `${'x'.repeat(299)}…`] }]);
    expect((fetched.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://en.wiktionary.org/api/rest_v1/page/definition/book',
    );
  });

  it('sends a compliant User-Agent (Wikimedia 403s the default okhttp UA on device)', async () => {
    const fetched = fetchOk(200, {
      English: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'a book' }] }],
    });
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch });
    await service.define('book', 'en');
    const [, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
    const ua = (init?.headers as Record<string, string>)['User-Agent'];
    expect(typeof ua).toBe('string');
    expect(ua).toContain('LibraryManagerReader');
    expect(ua).not.toMatch(/okhttp/i);
  });

  it('falls through the edition chain [lang, en, fr] and dedupes', async () => {
    const fetched = jest.fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: 'Not found' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        English: [{ partOfSpeech: 'Verb', definitions: [{ definition: 'to read' }] }],
      }));
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch });
    const senses = await service.define('read', 'de');
    expect(senses).toEqual([{ pos: 'Verb', glosses: ['to read'] }]);
    expect((fetched.mock.calls[0] as string[])[0]).toContain('de.wiktionary.org');
    expect((fetched.mock.calls[1] as string[])[0]).toContain('en.wiktionary.org');
  });

  it('falls through a 501 edition (endpoint not deployed there, e.g. fr.wiktionary)', async () => {
    // fr.wiktionary answers 501 Not Implemented on the definition REST endpoint
    // for every word — only some editions ship it
    const fetched = jest.fn()
      .mockResolvedValueOnce(jsonResponse(501, { error: 'Not implemented' }))
      .mockResolvedValueOnce(jsonResponse(200, {
        English: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'a house' }] }],
      }));
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch });
    const senses = await service.define('maison', 'fr');
    expect(senses).toEqual([{ pos: 'Noun', glosses: ['a house'] }]);
    expect((fetched.mock.calls[0] as string[])[0]).toContain('fr.wiktionary.org');
    expect((fetched.mock.calls[1] as string[])[0]).toContain('en.wiktionary.org');
  });

  it('maps network rejection to offline', async () => {
    const service = createLookupService({ fetch: jest.fn(async () => { throw new Error('dns'); }) as unknown as typeof fetch });
    await expect(service.define('word', 'en')).rejects.toMatchObject({ kind: 'offline' });
  });

  it('maps exhausted chain to not_found and other HTTP errors to service_error', async () => {
    const nf = createLookupService({ fetch: fetchOk(404, {}) as unknown as typeof fetch });
    await expect(nf.define('word', 'en')).rejects.toMatchObject({ kind: 'not_found' });
    const se = createLookupService({ fetch: fetchOk(500, {}) as unknown as typeof fetch });
    await expect(se.define('word', 'en')).rejects.toMatchObject({ kind: 'service_error' });
    expect(new LookupError('offline') instanceof Error).toBe(true);
  });
});

describe('lookupService gloss sanitization (entity-borne tag injection)', () => {
  const firstGloss = async (definition: string): Promise<string> => {
    const service = createLookupService({
      fetch: fetchOk(200, {
        English: [{ partOfSpeech: 'Noun', definitions: [{ definition }] }],
      }) as unknown as typeof fetch,
    });
    const senses = await service.define('w', 'en');
    return senses[0]?.glosses[0] ?? '';
  };

  it('neutralizes entity-encoded script tags so no "<" survives', async () => {
    const out = await firstGloss('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(out).toBe('alert(1)');
    expect(out).not.toContain('<');
  });

  it('decodes double-encoded tags before stripping them', async () => {
    const out = await firstGloss('&amp;lt;i&amp;gt;bold&amp;lt;/i&amp;gt;');
    expect(out).toBe('bold');
    expect(out).not.toContain('<i>');
  });

  it('strips real tags and entity-encoded tags mixed in one gloss', async () => {
    const out = await firstGloss('<b>Hello</b> &amp; &lt;b&gt;world&lt;/b&gt;');
    expect(out).toBe('Hello & world');
  });

  it('keeps legit math prose like "3 < 5 > 2"', async () => {
    const out = await firstGloss('3 < 5 &gt; 2');
    expect(out).toBe('3 < 5 > 2');
  });
});

describe('lookupService.translate', () => {
  const cfg = async () => ({ url: 'https://lt.example', apiKey: null as string | null });

  it('posts the payload and returns translatedText (no api_key when unset)', async () => {
    const fetched = jest.fn(async () => jsonResponse(200, { translatedText: 'libro' }));
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch, translateConfig: cfg });
    const out = await service.translate('book', 'en', 'es');
    expect(out).toBe('libro');
    const [url, init] = fetched.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://lt.example/translate');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toEqual({ q: 'book', source: 'en', target: 'es', format: 'text' });
  });

  it('includes api_key when configured', async () => {
    const fetched = jest.fn(async () => jsonResponse(200, { translatedText: 'x' }));
    const service = createLookupService({
      fetch: fetched as unknown as typeof fetch,
      translateConfig: async () => ({ url: 'https://lt.example/', apiKey: 'secret' }),
    });
    await service.translate('book', 'en', 'es');
    const body = JSON.parse((fetched.mock.calls[0] as unknown as [string, RequestInit])[1].body as string) as Record<string, unknown>;
    expect(body.api_key).toBe('secret');
  });

  it('maps network rejection to offline and missing field to service_error', async () => {
    const offline = createLookupService({ fetch: jest.fn(async () => { throw new Error('x'); }) as unknown as typeof fetch, translateConfig: cfg });
    await expect(offline.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'offline' });
    const bad = createLookupService({ fetch: fetchOk(200, {}) as unknown as typeof fetch, translateConfig: cfg });
    await expect(bad.translate('a', 'en', 'fr')).rejects.toMatchObject({ kind: 'service_error' });
  });
});
