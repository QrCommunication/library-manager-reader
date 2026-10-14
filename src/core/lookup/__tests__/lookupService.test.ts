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

  const parseMissing = () => jsonResponse(200, { error: { code: 'missingtitle', info: 'missing' } });

  it('uses the UI-language edition first, then book language, then en', async () => {
    const fetched = jest.fn()
      .mockResolvedValueOnce(jsonResponse(501, { status: 501 })) // fr REST (ui) — endpoint not deployed
      .mockResolvedValueOnce(parseMissing())                     // fr HTML — page missing
      .mockResolvedValueOnce(jsonResponse(200, {                 // en REST (book lang)
        English: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'to read' }] }],
      }));
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch });
    const senses = await service.define('read', 'en', 'fr');
    expect(senses).toEqual([{ pos: 'Noun', glosses: ['to read'] }]);
    expect((fetched.mock.calls[0] as unknown as [string])[0]).toContain('fr.wiktionary.org/api/rest_v1/page/definition/read');
    expect((fetched.mock.calls[1] as unknown as [string])[0]).toContain('action=parse');
    expect((fetched.mock.calls[1] as unknown as [string])[0]).toContain('fr.wiktionary.org');
    expect((fetched.mock.calls[2] as unknown as [string])[0]).toContain('en.wiktionary.org/api/rest_v1');
  });

  it('parses French definitions from the action=parse HTML fallback (nested examples excluded)', async () => {
    const html = '<div class="mw-heading mw-heading2"><h2 id="Français"><span id="Fran.C3.A7ais"></span>Français</h2></div>'
      + '<div class="mw-heading mw-heading3"><h3 id="Nom_commun">Nom commun</h3></div>'
      + '<ol><li><a href="/wiki/invention" title="invention">Invention</a> <a href="/wiki/fabuleux">fabuleuse</a>.'
      + '<ul><li><span class="example"><q><i>exemple cité</i></q></span></li></ul></li>'
      + '<li>Œuvre de l&#39;imagination.</li></ol>';
    const fetched = jest.fn()
      .mockResolvedValueOnce(jsonResponse(501, { status: 501 }))
      .mockResolvedValueOnce(jsonResponse(200, { parse: { title: 'fiction', text: html } }));
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch });
    const senses = await service.define('fiction', 'en', 'fr');
    expect(senses).toEqual([{ pos: 'Nom commun', glosses: ['Invention fabuleuse.', "Œuvre de l'imagination."] }]);
  });

  it('maps exhausted chain (all editions, both sources) to not_found and hard HTTP errors to service_error', async () => {
    const fetched = jest.fn()
      .mockResolvedValueOnce(jsonResponse(501, { status: 501 }))
      .mockResolvedValueOnce(parseMissing())
      .mockResolvedValueOnce(jsonResponse(404, {}))
      .mockResolvedValueOnce(parseMissing());
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch });
    await expect(service.define('zzz', 'en', 'fr')).rejects.toMatchObject({ kind: 'not_found' });

    const se = createLookupService({ fetch: fetchOk(500, {}) as unknown as typeof fetch });
    await expect(se.define('word', 'en')).rejects.toMatchObject({ kind: 'service_error' });
  });

  it('falls through the edition chain [lang, en, fr] and dedupes', async () => {
    const fetched = jest.fn()
      .mockResolvedValueOnce(jsonResponse(404, { error: 'Not found' }))
      .mockResolvedValueOnce(parseMissing())
      .mockResolvedValueOnce(jsonResponse(200, {
        English: [{ partOfSpeech: 'Verb', definitions: [{ definition: 'to read' }] }],
      }));
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch });
    const senses = await service.define('read', 'de');
    expect(senses).toEqual([{ pos: 'Verb', glosses: ['to read'] }]);
    expect((fetched.mock.calls[0] as unknown as [string])[0]).toContain('de.wiktionary.org');
    expect((fetched.mock.calls[2] as unknown as [string])[0]).toContain('en.wiktionary.org');
  });

  it('falls through a 501 edition (endpoint not deployed there, e.g. fr.wiktionary)', async () => {
    // fr.wiktionary answers 501 Not Implemented on the definition REST endpoint
    // for every word — only en ships it; the HTML fallback covers the rest
    const fetched = jest.fn()
      .mockResolvedValueOnce(jsonResponse(501, { error: 'Not implemented' }))
      .mockResolvedValueOnce(parseMissing())
      .mockResolvedValueOnce(jsonResponse(200, {
        English: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'a house' }] }],
      }));
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch });
    const senses = await service.define('maison', 'fr');
    expect(senses).toEqual([{ pos: 'Noun', glosses: ['a house'] }]);
    expect((fetched.mock.calls[0] as unknown as [string])[0]).toContain('fr.wiktionary.org');
    expect((fetched.mock.calls[2] as unknown as [string])[0]).toContain('en.wiktionary.org');
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

  it('decodes numeric entities like &#160; (French non-breaking space)', async () => {
    const out = await firstGloss('Personne&#160;; de grand renom&#160;.');
    expect(out).toBe('Personne\u00A0; de grand renom\u00A0.');
    expect(out).not.toContain('&#');
  });
});

describe('lookupService HTML fallback: references and non-POS sections', () => {
  const htmlFor = (inner: string): string =>
    '<div class="mw-heading mw-heading2"><h2 id="Français">Français</h2></div>'
    + '<div class="mw-heading mw-heading3"><h3 id="Nom_commun">Nom commun</h3></div>'
    + '<ol><li>Personne mise en action dans un ouvrage dramatique.</li></ol>'
    + inner;

  const sensesFor = async (inner: string) => {
    const fetched = jest.fn()
      .mockResolvedValueOnce(jsonResponse(501, { status: 501 }))
      .mockResolvedValueOnce(jsonResponse(200, { parse: { title: 'w', text: htmlFor(inner) } }));
    const service = createLookupService({ fetch: fetched as unknown as typeof fetch });
    return service.define('w', 'en', 'fr');
  };

  it('drops <ol class="references"> blocks and never yields a Sources/Références sense', async () => {
    const senses = await sensesFor(
      '<div class="mw-heading mw-heading3"><h3 id="Sources">Sources</h3></div>'
      + '<ol class="references"><li id="cite_note-1">↑ «&#160;w&#160;», dans&#160;TLFi, 1971–1994&#160;→ consulter</li></ol>',
    );
    expect(senses).toEqual([{ pos: 'Nom commun', glosses: ['Personne mise en action dans un ouvrage dramatique.'] }]);
  });

  it('skips non-POS headings (Étymologie, Prononciation, Voir aussi) even with lists', async () => {
    const senses = await sensesFor(
      '<div class="mw-heading mw-heading3"><h3 id="Étymologie">Étymologie</h3></div>'
      + '<ol><li>(XI<sup>e</sup> siècle) Du latin persona.</li></ol>'
      + '<div class="mw-heading mw-heading3"><h3 id="Prononciation">Prononciation</h3></div>'
      + '<ol><li>/pɛʁ.sɔ.naʒ/</li></ol>',
    );
    expect(senses).toEqual([{ pos: 'Nom commun', glosses: ['Personne mise en action dans un ouvrage dramatique.'] }]);
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
