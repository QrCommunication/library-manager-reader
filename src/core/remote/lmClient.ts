// library-manager.com mobile API client (MOBILE_API.md): OAuth PKCE with a
// public client, business endpoints under /api/v1/mobile, immutable versions,
// revision-based progress. Remote books are NEVER opened in the reader — only
// copied into (or uploaded from) the local library, via signed URLs that never
// receive the account bearer.

import { LM_CLIENT_ID, LM_REDIRECT_URI } from './lmPkce';
import type { LmTokens } from './lmTokens';

export const LM_BASE_URL = 'https://library-manager.com';

export type LmErrorKind = 'auth' | 'network' | 'forbidden' | 'conflict' | 'rate' | 'server';

export class LmError extends Error {
  constructor(
    public kind: LmErrorKind,
    message?: string,
    public code?: string,
    public details?: unknown,
  ) {
    super(message ?? kind);
    this.name = 'LmError';
  }
}

const OAUTH_TOKEN_PATH = '/api/mobile/oauth/token';
const OAUTH_REVOKE_PATH = '/api/mobile/oauth/revoke';

const tokenRequest = async (
  body: URLSearchParams,
  fetchImpl: typeof fetch,
  baseUrl: string,
): Promise<LmTokens> => {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}${OAUTH_TOKEN_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
  } catch (err) {
    throw new LmError('network', err instanceof Error ? err.message : String(err));
  }
  if (!res.ok) {
    throw new LmError(res.status === 400 || res.status === 401 ? 'auth' : res.status === 429 ? 'rate' : 'server', `oauth ${res.status}`);
  }
  const data = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
  if (!data.access_token) throw new LmError('server', 'no access_token in response');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? '',
    expiresAt: Date.now() + (data.expires_in ?? 600) * 1000,
  };
};

/** PKCE step 2: exchange the callback code (verifier never left the device) */
export const lmExchangeCode = (
  grant: { code: string; codeVerifier: string },
  fetchImpl: typeof fetch = globalThis.fetch,
  baseUrl: string = LM_BASE_URL,
): Promise<LmTokens> =>
  tokenRequest(
    new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: LM_CLIENT_ID,
      redirect_uri: LM_REDIRECT_URI,
      code: grant.code,
      code_verifier: grant.codeVerifier,
    }),
    fetchImpl,
    baseUrl,
  );

/** silent renewal; the server rotates BOTH tokens on success */
export const lmRefresh = (
  grant: { refreshToken: string },
  fetchImpl: typeof fetch = globalThis.fetch,
  baseUrl: string = LM_BASE_URL,
): Promise<LmTokens> =>
  tokenRequest(
    new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: LM_CLIENT_ID,
      refresh_token: grant.refreshToken,
    }),
    fetchImpl,
    baseUrl,
  );

/** idempotent revoke; network/server failures are swallowed so sign-out never blocks */
export const lmRevoke = async (
  grant: { refreshToken: string },
  fetchImpl: typeof fetch = globalThis.fetch,
  baseUrl: string = LM_BASE_URL,
): Promise<void> => {
  try {
    await fetchImpl(`${baseUrl}${OAUTH_REVOKE_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: LM_CLIENT_ID,
        token: grant.refreshToken,
        token_type_hint: 'refresh_token',
      }).toString(),
    });
  } catch {
    // best-effort: a lost revoke request leaves the token to expire server-side
  }
};

export interface LmSpace { id: string; name: string; role: string }
export interface LmBook {
  id: string;
  title: string;
  author: string | null;
  series: string | null;
  seriesIndex: number | null;
  updatedAt: number | null;
}
export interface LmVersion { id: string; format: string; status: string; sizeBytes: number; sha256: string }
export interface LmBookDetails { id: string; title: string; author: string | null; versions: LmVersion[] }
export interface LmPage<T> { items: T[]; nextCursor: string | null; total: number }
export interface LmDownload {
  versionId: string;
  format: string;
  filename: string;
  sizeBytes: number;
  sha256: string;
  download: { url: string; method: string; headers: Record<string, string> };
}
export interface LmLocalCopy { versionId: string; sha256: string; sizeBytes: number }
export interface LmUploadPlan {
  session: { id: string; revision: number };
  upload: { url: string; method: string; headers: Record<string, string> };
}
export interface LmImportStatus { id: string; status: string }
export interface LmProgress {
  bookId: string;
  versionId: string;
  cfi: string | null;
  chapterId: string | null;
  percent: number;
  revision: number;
  updatedAt: number;
}
export interface LmProgressOp {
  installationId: string;
  operationId: string;
  expectedRevision: number;
  versionId: string;
  cfi: string | null;
  chapterId: string | null;
  percent: number;
}
export interface LmMe { account?: { id?: string; email?: string; name?: string } }

interface BusinessErrorBody { error?: { code?: string; details?: unknown } }

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
    if (res.ok) return res;
    if (res.status === 401) throw new LmError('auth');
    let body: BusinessErrorBody = {};
    try { body = (await res.json()) as BusinessErrorBody; } catch { /* non-JSON error body */ }
    if (res.status === 403) throw new LmError('forbidden', `403 ${body.error?.code ?? ''}`.trim(), body.error?.code);
    if (res.status === 409) throw new LmError('conflict', `409 ${body.error?.code ?? ''}`.trim(), body.error?.code, body.error?.details);
    if (res.status === 429) throw new LmError('rate', `429 ${body.error?.code ?? ''}`.trim(), body.error?.code);
    throw new LmError('server', `${init.method ?? 'GET'} ${path} → ${res.status}`, body.error?.code);
  }

  me(): Promise<LmMe> {
    return this.call('/api/v1/mobile/me').then((r) => r.json());
  }

  async listSpaces(): Promise<LmSpace[]> {
    const res = await this.call('/api/v1/mobile/spaces');
    const data = (await res.json()) as LmSpace[] | { spaces?: LmSpace[] };
    return Array.isArray(data) ? data : (data.spaces ?? []);
  }

  listBooks(spaceId: string, opts: { pageSize?: number; cursor?: string | null } = {}): Promise<LmPage<LmBook>> {
    const params = new URLSearchParams({ pageSize: String(opts.pageSize ?? 50) });
    if (opts.cursor) params.set('cursor', opts.cursor);
    return this.call(`/api/v1/mobile/spaces/${spaceId}/books?${params.toString()}`).then((r) => r.json());
  }

  getBook(spaceId: string, bookId: string): Promise<LmBookDetails> {
    return this.call(`/api/v1/mobile/spaces/${spaceId}/books/${bookId}`).then((r) => r.json());
  }

  getDownload(spaceId: string, bookId: string, versionId: string): Promise<LmDownload> {
    return this.call(`/api/v1/mobile/spaces/${spaceId}/books/${bookId}/versions/${versionId}/download`).then((r) => r.json());
  }

  confirmLocalCopy(
    spaceId: string,
    bookId: string,
    copy: { installationId: string; versionId: string; sha256: string; sizeBytes: number },
  ): Promise<void> {
    return this.call(`/api/v1/mobile/spaces/${spaceId}/books/${bookId}/local-copy`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(copy),
    }).then(() => undefined);
  }

  listLocalCopies(spaceId: string, installationId: string, opts: { limit?: number; cursor?: string | null } = {}): Promise<LmPage<LmLocalCopy>> {
    const params = new URLSearchParams({ installationId });
    params.set('limit', String(opts.limit ?? 50));
    if (opts.cursor) params.set('cursor', opts.cursor);
    return this.call(`/api/v1/mobile/spaces/${spaceId}/local-copies?${params.toString()}`).then((r) => r.json());
  }

  deleteLocalCopy(spaceId: string, versionId: string, installationId: string): Promise<void> {
    return this.call(`/api/v1/mobile/spaces/${spaceId}/local-copies/${versionId}?installationId=${installationId}`, {
      method: 'DELETE',
    }).then(() => undefined);
  }

  beginImport(
    spaceId: string,
    input: { filename: string; format: string; sizeBytes: number; sha256?: string; idempotencyKey: string },
  ): Promise<LmUploadPlan> {
    return this.call(`/api/v1/mobile/spaces/${spaceId}/imports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => r.json());
  }

  completeImport(spaceId: string, importId: string, input: { expectedRevision: number; sha256: string }): Promise<LmImportStatus> {
    return this.call(`/api/v1/mobile/spaces/${spaceId}/imports/${importId}/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }).then((r) => r.json());
  }

  getImport(spaceId: string, importId: string): Promise<LmImportStatus> {
    return this.call(`/api/v1/mobile/spaces/${spaceId}/imports/${importId}`).then((r) => r.json());
  }

  /** no stored progress on the server → null */
  getProgress(spaceId: string, bookId: string, versionId: string): Promise<LmProgress | null> {
    return this.call(`/api/v1/mobile/spaces/${spaceId}/books/${bookId}/progress?versionId=${versionId}`)
      .then((r) => r.json())
      .then((data: LmProgress | null) => data ?? null);
  }

  /** revision-checked write; a 409 surfaces as LmError('conflict', …, 'revisionConflict', details) */
  putProgress(spaceId: string, bookId: string, op: LmProgressOp): Promise<LmProgress> {
    return this.call(`/api/v1/mobile/spaces/${spaceId}/books/${bookId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(op),
    }).then((r) => r.json());
  }
}

export const createLmClient = (
  opts: { baseUrl?: string; accessToken: string },
  fetchImpl: typeof fetch = globalThis.fetch,
): LmClient => new LmClient(opts.baseUrl ?? LM_BASE_URL, opts.accessToken, fetchImpl);
