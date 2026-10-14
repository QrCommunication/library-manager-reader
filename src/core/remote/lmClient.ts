// library-manager.com API client. The server API is being prepared — these
// are the agreed endpoints; every call maps failures to LmError kinds so the
// UI can react (auth = reconnect, network = offline, server = message).
// Remote books are NEVER opened in the reader: only downloaded into (or
// uploaded from) the local library.

export const LM_BASE_URL = 'https://library-manager.com';

export type LmErrorKind = 'auth' | 'network' | 'server';

export class LmError extends Error {
  constructor(public kind: LmErrorKind, message?: string) {
    super(message ?? kind);
    this.name = 'LmError';
  }
}

export interface LmTokens { accessToken: string; refreshToken: string; expiresAt: number }

const tokenRequest = async (
  body: URLSearchParams,
  fetchImpl: typeof fetch,
  baseUrl: string,
): Promise<LmTokens> => {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    throw new LmError('network', err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) throw new LmError(res.status === 401 || res.status === 400 ? 'auth' : 'server', `oauth ${res.status}`);
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) throw new LmError('server', 'no access_token in response');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? '',
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
};

/** OAuth password grant: user+password exchanged once for a bearer token */
export const lmLogin = (
  creds: { username: string; password: string },
  fetchImpl: typeof fetch = globalThis.fetch,
  baseUrl: string = LM_BASE_URL,
): Promise<LmTokens> =>
  tokenRequest(
    new URLSearchParams({ grant_type: 'password', username: creds.username, password: creds.password }),
    fetchImpl,
    baseUrl,
  );

/** silent renewal of an expired bearer token */
export const lmRefresh = (
  creds: { refreshToken: string },
  fetchImpl: typeof fetch = globalThis.fetch,
  baseUrl: string = LM_BASE_URL,
): Promise<LmTokens> =>
  tokenRequest(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: creds.refreshToken }), fetchImpl, baseUrl);

export interface LmSpace { id: string; name: string; booksCount: number }
export interface LmBook {
  id: string;
  title: string;
  author: string | null;
  series: string | null;
  seriesIndex: number | null;
  format: string;
  fileSize: number;
  updatedAt: number;
}
export interface LmProgress { fraction: number; updatedAt: number }

export class LmClient {
  constructor(private base: string, private token: string, private fetchImpl: typeof fetch) {}

  private async call(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { ...init, headers });
    } catch (err) {
      throw new LmError('network', err instanceof Error ? err.message : String(err));
    }
    if (res.status === 401) throw new LmError('auth');
    if (!res.ok) throw new LmError('server', `${init.method ?? 'GET'} ${path} → ${res.status}`);
    return res;
  }

  listSpaces(): Promise<LmSpace[]> {
    return this.call('/api/spaces').then((r) => r.json());
  }

  listBooks(spaceId: string): Promise<LmBook[]> {
    return this.call(`/api/spaces/${spaceId}/books`).then((r) => r.json());
  }

  async downloadBook(spaceId: string, bookId: string): Promise<Uint8Array> {
    const res = await this.call(`/api/spaces/${spaceId}/books/${bookId}/file`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async uploadBook(
    spaceId: string,
    file: { fileName: string; mime: string; bytes: Uint8Array },
    meta: { title: string; author: string | null; series: string | null; seriesIndex: number | null },
  ): Promise<string> {
    const form = new FormData();
    form.append('title', meta.title);
    form.append('author', meta.author ?? '');
    form.append('series', meta.series ?? '');
    form.append('seriesIndex', meta.seriesIndex == null ? '' : String(meta.seriesIndex));
    form.append('file', new File([new Uint8Array(file.bytes)], file.fileName, { type: file.mime }));
    const res = await this.call(`/api/spaces/${spaceId}/books`, { method: 'POST', body: form });
    const data = (await res.json()) as { id?: string };
    return data.id ?? '';
  }

  refreshMetadataAi(spaceId: string, bookIds?: string[]): Promise<{ updated: number }> {
    return this.call(`/api/spaces/${spaceId}/books/metadata-ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bookIds ? { bookIds } : {}),
    }).then((r) => r.json());
  }

  getProgress(spaceId: string, bookId: string): Promise<LmProgress | null> {
    return this.call(`/api/spaces/${spaceId}/books/${bookId}/progress`)
      .then((r) => r.json())
      .catch((err) => {
        if (err instanceof LmError && err.kind === 'server' && err.message.endsWith('→ 404')) return null;
        throw err;
      });
  }

  putProgress(spaceId: string, bookId: string, progress: LmProgress): Promise<void> {
    return this.call(`/api/spaces/${spaceId}/books/${bookId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(progress),
    }).then(() => undefined);
  }
}

export const createLmClient = (
  opts: { baseUrl?: string; accessToken: string },
  fetchImpl: typeof fetch = globalThis.fetch,
): LmClient => new LmClient(opts.baseUrl ?? LM_BASE_URL, opts.accessToken, fetchImpl);
