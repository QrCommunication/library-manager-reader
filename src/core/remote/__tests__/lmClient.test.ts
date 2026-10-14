import {
  createLmClient, lmExchangeCode, lmRefresh, lmRevoke, LmError, LM_BASE_URL,
} from '../lmClient';

// deterministic digest so cover integrity checks match node's sha256
jest.mock('expo-crypto', () => ({
  __esModule: true,
  CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
  digest: async (_alg: string, data: BufferSource) => {
    const { createHash } = require('node:crypto');
    const hashed = createHash('sha256').update(new Uint8Array(data as ArrayBuffer)).digest();
    return hashed.buffer.slice(hashed.byteOffset, hashed.byteOffset + hashed.byteLength);
  },
  getRandomValues: (arr: Uint8Array) => { require('node:crypto').webcrypto.getRandomValues(arr); return arr; },
}));

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const tokensJson = { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 600, token_type: 'Bearer' };

describe('lmExchangeCode — authorization_code + PKCE', () => {
  it('posts the public-client token request with the verifier', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return okJson(tokensJson);
    };
    const out = await lmExchangeCode({ code: 'abc-1', codeVerifier: 'v'.repeat(43) }, fetchImpl);
    expect(out).toEqual({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: expect.any(Number) });
    const { url, init } = calls[0]!;
    expect(url).toBe(`${LM_BASE_URL}/api/mobile/oauth/token`);
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    // the server's CSRF layer treats Origin-less POSTs as cross-site (403);
    // a first-party client must announce its own origin like a browser would
    expect((init.headers as Record<string, string>).Origin).toBe('https://library-manager.com');
    const body = String(init.body);
    expect(body).toContain('grant_type=authorization_code');
    expect(body).toContain('client_id=library-manager-mobile');
    expect(body).toContain(`redirect_uri=${encodeURIComponent('https://library-manager.com/mobile/callback')}`);
    expect(body).toContain('code=abc-1');
    expect(body).toContain(`code_verifier=${'v'.repeat(43)}`);
  });

  it('maps 400/401 to auth and fetch failure to network', async () => {
    await expect(lmExchangeCode({ code: 'x', codeVerifier: 'v' }, async () => new Response('nope', { status: 400 })))
      .rejects.toMatchObject({ kind: 'auth' });
    await expect(lmExchangeCode({ code: 'x', codeVerifier: 'v' }, async () => { throw new TypeError('offline'); }))
      .rejects.toMatchObject({ kind: 'network' });
  });
});

describe('lmRefresh — rotating refresh_token grant', () => {
  it('sends client_id with the refresh token', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return okJson({ ...tokensJson, access_token: 'at-2', refresh_token: 'rt-2', expires_in: 7200 });
    };
    const out = await lmRefresh({ refreshToken: 'rt-1' }, fetchImpl);
    expect(out).toEqual({ accessToken: 'at-2', refreshToken: 'rt-2', expiresAt: expect.any(Number) });
    const body = String(calls[0]!.init.body);
    expect(body).toContain('grant_type=refresh_token');
    expect(body).toContain('client_id=library-manager-mobile');
    expect(body).toContain('refresh_token=rt-1');
  });
});

describe('lmCover — version-scoped cover with conditional GET and integrity', () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const sha = require('node:crypto').createHash('sha256').update(bytes).digest('hex') as string;
  const etag = `"sha256-${sha}"`;

  const make = (status: number, headers: Record<string, string>, body?: BodyInit) =>
    createLmClient({ accessToken: 't' }, (async () => new Response(body ?? null, { status, headers })) as unknown as typeof fetch);

  it('returns verified bytes + etag on 200', async () => {
    const client = make(200, { 'Content-Type': 'image/webp', ETag: etag, 'Content-Length': String(bytes.length) }, bytes.buffer);
    await expect(client.getCover('s1', 'b1', 'v1', null)).resolves.toEqual({ kind: 'ok', bytes, etag });
  });

  it('sends the profile and the stored etag as If-None-Match; 304 → unmodified', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const client = createLmClient({ accessToken: 't' }, (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }) as unknown as typeof fetch);
    await expect(client.getCover('s1', 'b1', 'v1', etag)).resolves.toEqual({ kind: 'unmodified' });
    expect(calls[0]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/spaces/s1/books/b1/versions/v1/cover?profile=cover_v1`);
    expect((calls[0]!.init.headers as Headers).get('If-None-Match')).toBe(etag);
  });

  it('maps 404 to none (pending or noCover)', async () => {
    const client = make(404, { 'Content-Type': 'application/json' });
    await expect(client.getCover('s1', 'b1', 'v1', null)).resolves.toEqual({ kind: 'none' });
  });

  it('rejects bytes whose hash does not match the etag', async () => {
    const client = make(200, { 'Content-Type': 'image/webp', ETag: `"sha256-${'a'.repeat(64)}"`, 'Content-Length': String(bytes.length) }, bytes.buffer);
    await expect(client.getCover('s1', 'b1', 'v1', null)).rejects.toMatchObject({ kind: 'server' });
  });

  it('rejects a non-webp content type', async () => {
    const client = make(200, { 'Content-Type': 'image/jpeg', ETag: etag, 'Content-Length': String(bytes.length) }, bytes.buffer);
    await expect(client.getCover('s1', 'b1', 'v1', null)).rejects.toMatchObject({ kind: 'server' });
  });
});

describe('lmRevoke — idempotent, best-effort', () => {
  it('posts client_id + token to the revoke endpoint', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 200 });
    };
    await lmRevoke({ refreshToken: 'rt-9' }, fetchImpl);
    const { url, init } = calls[0]!;
    expect(url).toBe(`${LM_BASE_URL}/api/mobile/oauth/revoke`);
    const body = String(init.body);
    expect(body).toContain('client_id=library-manager-mobile');
    expect(body).toContain('token=rt-9');
    expect(body).toContain('token_type_hint=refresh_token');
  });

  it('swallows network failures and non-2xx: revocation must not block sign-out', async () => {
    await expect(lmRevoke({ refreshToken: 'r' }, async () => { throw new TypeError('offline'); })).resolves.toBeUndefined();
    await expect(lmRevoke({ refreshToken: 'r' }, async () => new Response('x', { status: 500 }))).resolves.toBeUndefined();
  });
});

describe('LmClient — /api/v1/mobile business endpoints', () => {
  const make = (handler: (url: string, init: RequestInit) => Response | Promise<Response>) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return handler(String(url), init ?? {});
    };
    const client = createLmClient({ baseUrl: LM_BASE_URL, accessToken: 'tok-1' }, fetchImpl);
    return { calls, client };
  };

  it('lists spaces with roles, tolerating both array and {spaces} bodies', async () => {
    const { calls, client } = make(() => okJson({ spaces: [{ id: 's1', name: 'Perso', role: 'owner' }] }));
    const spaces = await client.listSpaces();
    expect(spaces).toEqual([{ id: 's1', name: 'Perso', role: 'owner' }]);
    expect(calls[0]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/spaces`);
    expect(new Headers(calls[0]!.init.headers).get('Authorization')).toBe('Bearer tok-1');

    const bare = make(() => okJson([{ id: 's2', name: 'Partagé', role: 'reader' }]));
    await expect(bare.client.listSpaces()).resolves.toEqual([{ id: 's2', name: 'Partagé', role: 'reader' }]);
  });

  it('reads the identity with me()', async () => {
    const { calls, client } = make(() => okJson({ account: { id: 'a1', email: 'r@example.com' } }));
    const me = await client.me();
    expect(me.account?.email).toBe('r@example.com');
    expect(calls[0]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/me`);
  });

  it('lists a space catalogue page with cursor pagination', async () => {
    const { calls, client } = make(() => okJson({
      items: [{ id: 'b1', title: 'Dune', author: 'F. Herbert', series: null, seriesIndex: null, updatedAt: 5 }],
      nextCursor: 'cur-2',
      total: 12,
    }));
    const page = await client.listBooks('s1', { cursor: 'cur-1' });
    expect(page.nextCursor).toBe('cur-2');
    expect(page.total).toBe(12);
    expect(page.items[0]!.title).toBe('Dune');
    expect(calls[0]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/spaces/s1/books?pageSize=50&cursor=cur-1`);
  });

  it('passes the catalogue search and series filters (search= on /books)', async () => {
    const { calls, client } = make(() => okJson({ items: [], nextCursor: 'cur-2', total: 0 }));
    await client.listBooks('s1', { search: 'verne', series: 'Pern' });
    expect(calls[0]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/spaces/s1/books?pageSize=50&search=verne&series=Pern`);
  });

  it('searches through the dedicated /books/search route (q required, total null)', async () => {
    const { calls, client } = make(() => okJson({ items: [], nextCursor: null, total: null }));
    const page = await client.searchBooks('s1', { q: 'Jules Verne', series: 'Pern', sort: 'title', direction: 'asc' });
    expect(page.total).toBeNull();
    expect(calls[0]!.url).toBe(
      `${LM_BASE_URL}/api/v1/mobile/spaces/s1/books/search?pageSize=50&q=Jules+Verne&series=Pern&sort=title&direction=asc`,
    );
  });

  it('continues a search with the cursor while keeping every parameter', async () => {
    const { calls, client } = make(() => okJson({ items: [], nextCursor: null, total: null }));
    await client.searchBooks('s1', { q: 'verne', cursor: 'cur-9' });
    expect(calls[0]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/spaces/s1/books/search?pageSize=50&q=verne&cursor=cur-9`);
  });

  it('fetches book details with immutable versions', async () => {
    const { calls, client } = make(() => okJson({
      id: 'b1', title: 'Dune', author: 'F. Herbert',
      versions: [{ id: 'v1', format: 'epub', status: 'ready', sizeBytes: 100, sha256: 'a'.repeat(64) }],
    }));
    const details = await client.getBook('s1', 'b1');
    expect(details.versions[0]!.status).toBe('ready');
    expect(calls[0]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/spaces/s1/books/b1`);
  });

  it('gets a signed download capability for a version', async () => {
    const { calls, client } = make(() => okJson({
      versionId: 'v1', format: 'epub', filename: 'dune.epub', sizeBytes: 100, sha256: 'a'.repeat(64),
      download: { url: 'https://objects.example/signed', method: 'GET', headers: {} },
      readingMode: 'local_copy',
    }));
    const dl = await client.getDownload('s1', 'b1', 'v1');
    expect(dl.download.url).toBe('https://objects.example/signed');
    expect(dl.sha256).toBe('a'.repeat(64));
    expect(calls[0]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/spaces/s1/books/b1/versions/v1/download`);
  });

  it('confirms a local copy', async () => {
    const { calls, client } = make(() => okJson({}));
    await client.confirmLocalCopy('s1', 'b1', {
      installationId: 'i1', versionId: 'v1', sha256: 'a'.repeat(64), sizeBytes: 100,
    });
    expect(calls[0]!.init.method).toBe('PUT');
    expect(calls[0]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/spaces/s1/books/b1/local-copy`);
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({ installationId: 'i1', versionId: 'v1' });
  });

  it('lists and deletes own local-copy confirmations', async () => {
    const { calls, client } = make(() => okJson({ items: [{ versionId: 'v1', sha256: 'a'.repeat(64), sizeBytes: 100 }], nextCursor: null, total: 1 }));
    const page = await client.listLocalCopies('s1', 'i1');
    expect(page.items).toHaveLength(1);
    expect(calls[0]!.url).toContain('/api/v1/mobile/spaces/s1/local-copies?');
    expect(calls[0]!.url).toContain('installationId=i1');

    const del = make(() => new Response(null, { status: 200 }));
    await del.client.deleteLocalCopy('s1', 'v1', 'i1');
    expect(del.calls[0]!.init.method).toBe('DELETE');
    expect(del.calls[0]!.url).toContain('/api/v1/mobile/spaces/s1/local-copies/v1?installationId=i1');
  });

  it('begins an import, completes it and polls its status', async () => {
    const plan = {
      session: { id: 'imp-1', revision: 1 },
      upload: { url: 'https://objects.example/upload-signed', method: 'PUT', headers: { 'x-signed': '1' } },
    };
    const { calls, client } = make((url, init) => {
      if (url.endsWith('/imports') && init.method === 'POST') return okJson(plan);
      if (url.endsWith('/complete')) return okJson({ id: 'imp-1', status: 'processing' });
      return okJson({ id: 'imp-1', status: 'ready' });
    });
    const got = await client.beginImport('s1', {
      filename: 'dune.epub', format: 'epub', sizeBytes: 100, sha256: 'a'.repeat(64), idempotencyKey: '88888888-8888-4888-8888-888888888888',
    });
    expect(got.upload.url).toBe('https://objects.example/upload-signed');
    expect(calls[0]!.init.method).toBe('POST');
    expect(calls[0]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/spaces/s1/imports`);

    await client.completeImport('s1', 'imp-1', { expectedRevision: 1, sha256: 'a'.repeat(64) });
    expect(calls[1]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/spaces/s1/imports/imp-1/complete`);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ expectedRevision: 1, sha256: 'a'.repeat(64) });

    const status = await client.getImport('s1', 'imp-1');
    expect(status.status).toBe('ready');
  });

  it('reads per-version progress: null body means no progress', async () => {
    const { calls, client } = make(() => new Response('null', { status: 200 }));
    const progress = await client.getProgress('s1', 'b1', 'v1');
    expect(progress).toBeNull();
    expect(calls[0]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/spaces/s1/books/b1/progress?versionId=v1`);
  });

  it('puts a progress operation and returns the stored receipt', async () => {
    const { calls, client } = make(() => okJson({
      bookId: 'b1', versionId: 'v1', cfi: null, chapterId: null, percent: 12.5, revision: 1, updatedAt: 1700000000,
    }));
    const receipt = await client.putProgress('s1', 'b1', {
      installationId: 'i1', operationId: 'op-1', expectedRevision: 0, versionId: 'v1',
      cfi: null, chapterId: null, percent: 12.5,
    });
    expect(receipt.revision).toBe(1);
    expect(calls[0]!.init.method).toBe('PUT');
    expect(calls[0]!.url).toBe(`${LM_BASE_URL}/api/v1/mobile/spaces/s1/books/b1/progress`);
    const sent = JSON.parse(String(calls[0]!.init.body));
    expect(sent).toMatchObject({ expectedRevision: 0, percent: 12.5 });
  });

  it('maps business errors: 401 auth, 403 forbidden, 429 rate, 500 server', async () => {
    const auth = make(() => new Response(JSON.stringify({ error: { code: 'unauthenticated' } }), { status: 401 }));
    await expect(auth.client.listSpaces()).rejects.toMatchObject({ kind: 'auth' });

    const forbidden = make(() => new Response(JSON.stringify({ error: { code: 'forbidden' } }), { status: 403 }));
    await expect(forbidden.client.listSpaces()).rejects.toMatchObject({ kind: 'forbidden' });

    const rate = make(() => new Response(JSON.stringify({ error: { code: 'quotaExceeded' } }), { status: 429 }));
    await expect(rate.client.listSpaces()).rejects.toMatchObject({ kind: 'rate' });

    const server = make(() => new Response('boom', { status: 500 }));
    await expect(server.client.listSpaces()).rejects.toMatchObject({ kind: 'server' });

    const down = createLmClient({ baseUrl: LM_BASE_URL, accessToken: 't' }, async () => { throw new TypeError('offline'); });
    await expect(down.listSpaces()).rejects.toMatchObject({ kind: 'network' });
  });

  it('surfaces revisionConflict code and details on 409', async () => {
    const { client } = make(() => new Response(JSON.stringify({
      error: { code: 'revisionConflict', messageKey: 'errors.revisionConflict', requestId: 'rid-1', details: { expectedRevision: 0, currentRevision: 1 } },
    }), { status: 409 }));
    const err = await client.putProgress('s1', 'b1', {
      installationId: 'i1', operationId: 'op-1', expectedRevision: 0, versionId: 'v1', cfi: null, chapterId: null, percent: 1,
    }).catch((e: unknown) => e as LmError) as LmError;
    expect(err).toBeInstanceOf(LmError);
    expect(err.kind).toBe('conflict');
    expect(err.code).toBe('revisionConflict');
    expect(err.details).toEqual({ expectedRevision: 0, currentRevision: 1 });
  });
});
