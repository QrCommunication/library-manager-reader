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
    expect(fetched).toHaveBeenCalledWith(
      'https://en.wiktionary.org/api/rest_v1/page/definition/book',
    );
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
