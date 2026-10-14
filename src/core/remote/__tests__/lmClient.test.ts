import { createLmClient, LmError, lmLogin, lmRefresh, LM_BASE_URL } from '../lmClient';

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('lmLogin — OAuth password grant', () => {
  it('exchanges user+password for tokens at the prepared token endpoint', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return okJson({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, token_type: 'Bearer' });
    };
    const out = await lmLogin({ username: 'rony', password: 'secret' }, fetchImpl);
    expect(out).toEqual({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: expect.any(Number) });
    const { url, init } = calls[0]!;
    expect(url).toBe(`${LM_BASE_URL}/api/oauth/token`);
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(String(init.body)).toContain('grant_type=password');
    expect(String(init.body)).toContain('username=rony');
    expect(String(init.body)).toContain('password=secret');
  });

  it('throws an auth LmError on 401/400 and a network LmError on fetch failure', async () => {
    await expect(lmLogin({ username: 'u', password: 'bad' }, async () => new Response('nope', { status: 401 })))
      .rejects.toMatchObject({ kind: 'auth' });
    await expect(lmLogin({ username: 'u', password: 'p' }, async () => { throw new TypeError('offline'); }))
      .rejects.toMatchObject({ kind: 'network' });
  });
});

describe('lmRefresh — refresh_token grant', () => {
  it('exchanges a refresh token for a new token pair', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return okJson({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 7200 });
    };
    const out = await lmRefresh({ refreshToken: 'rt-1' }, fetchImpl);
    expect(out).toEqual({ accessToken: 'at-2', refreshToken: 'rt-2', expiresAt: expect.any(Number) });
    expect(String(calls[0]!.init.body)).toContain('grant_type=refresh_token');
    expect(String(calls[0]!.init.body)).toContain('refresh_token=rt-1');
  });

  it('maps failures like the password grant', async () => {
    await expect(lmRefresh({ refreshToken: 'bad' }, async () => new Response('nope', { status: 400 })))
      .rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('createLmClient', () => {
  const make = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return handler(String(url), init ?? {});
    };
    const client = createLmClient({ baseUrl: 'https://library-manager.com', accessToken: 'tok-1' }, fetchImpl);
    return { calls, client };
  };

  it('lists the user spaces with the bearer token', async () => {
    const { calls, client } = make(() => okJson([{ id: 's1', name: 'Perso', booksCount: 12 }]));
    const spaces = await client.listSpaces();
    expect(spaces).toEqual([{ id: 's1', name: 'Perso', booksCount: 12 }]);
    expect(calls[0]!.url).toBe('https://library-manager.com/api/spaces');
    expect(new Headers(calls[0]!.init.headers).get('Authorization')).toBe('Bearer tok-1');
  });

  it('lists a space books with series and progress fields', async () => {
    const { calls, client } = make(() => okJson([{ id: 'b1', title: 'Dune', author: 'F. Herbert', series: 'Dune', seriesIndex: 1, format: 'epub', fileSize: 1000, updatedAt: 5 }]));
    const books = await client.listBooks('s1');
    expect(books[0]!.title).toBe('Dune');
    expect(calls[0]!.url).toBe('https://library-manager.com/api/spaces/s1/books');
  });

  it('downloads a book file as bytes', async () => {
    const { calls, client } = make(() => new Response(new Uint8Array([1, 2, 3]), { status: 200 }));
    const bytes = await client.downloadBook('s1', 'b1');
    expect([...bytes]).toEqual([1, 2, 3]);
    expect(calls[0]!.url).toBe('https://library-manager.com/api/spaces/s1/books/b1/file');
  });

  it('uploads a book with its metadata as multipart', async () => {
    const { calls, client } = make(() => okJson({ id: 'rb1' }));
    const out = await client.uploadBook('s1', { fileName: 'Dune.epub', mime: 'application/epub+zip', bytes: new Uint8Array([9]) }, { title: 'Dune', author: 'F. Herbert', series: null, seriesIndex: null });
    expect(out).toBe('rb1');
    const init = calls[0]!.init;
    expect(init.method).toBe('POST');
    const body = init.body as FormData;
    expect(body.get('title')).toBe('Dune');
    expect((body.get('file') as File).name).toBe('Dune.epub');
    expect(new Headers(init.headers).get('Authorization')).toBe('Bearer tok-1');
  });

  it('refreshes metadata through the user AI system', async () => {
    const { calls, client } = make(() => okJson({ updated: 3 }));
    const out = await client.refreshMetadataAi('s1');
    expect(out.updated).toBe(3);
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url).toBe('https://library-manager.com/api/spaces/s1/books/metadata-ai');
  });

  it('gets and puts reading progress', async () => {
    const { calls, client } = make((_url, init) => (init.method === 'PUT' ? okJson({}) : okJson({ fraction: 0.4, updatedAt: 1700000000 })));
    await client.putProgress('s1', 'b1', { fraction: 0.5, updatedAt: 1700000001000 });
    expect(calls[0]!.init.method).toBe('PUT');
    expect(calls[0]!.url).toBe('https://library-manager.com/api/spaces/s1/books/b1/progress');
    const progress = await client.getProgress('s1', 'b1');
    // timestamps ride the wire in unix seconds, like KOReader
    expect(progress).toEqual({ fraction: 0.4, updatedAt: 1700000000 });
  });

  it('maps 401 to an auth LmError and connection failures to network', async () => {
    const { client } = make(() => new Response('denied', { status: 401 }));
    await expect(client.listSpaces()).rejects.toMatchObject({ kind: 'auth' });
    const down = createLmClient({ baseUrl: 'https://library-manager.com', accessToken: 't' }, async () => { throw new TypeError('offline'); });
    await expect(down.listSpaces()).rejects.toMatchObject({ kind: 'network' });
  });
});
