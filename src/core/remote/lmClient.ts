// library-manager.com mobile API client (MOBILE_API.md): OAuth PKCE with a
// public client, business endpoints under /api/v1/mobile, immutable versions,
// revision-based progress. Remote books are NEVER opened in the reader — only
// copied into (or uploaded from) the local library, via signed URLs that never
// receive the account bearer.

import { LM_CLIENT_ID, LM_REDIRECT_URI } from './lmPkce';
import { sha256HexOfBytes } from './lmSha256';
import type { LmTokens } from './lmTokens';
import { xpointerOrNull } from '../progress/xpointer';

export const LM_BASE_URL = 'https://library-manager.com';

export type LmErrorKind = 'auth' | 'network' | 'forbidden' | 'conflict' | 'rate' | 'server';

export class LmError extends Error {
  constructor(
    public kind: LmErrorKind,
    message?: string,
    public code?: string,
    public details?: unknown,
    /** HTTP status when the error came from a response */
    public status?: number,
  ) {
    super(message ?? kind);
    this.name = 'LmError';
  }
}

const OAUTH_TOKEN_PATH = '/api/mobile/oauth/token';
const OAUTH_REVOKE_PATH = '/api/mobile/oauth/revoke';

// the server's CSRF layer treats Origin-less POSTs as cross-site (403); a
// first-party native client announces its own origin like a browser would
const originOf = (baseUrl: string): string => {
  try { return new URL(baseUrl).origin; } catch { return baseUrl; }
};

const tokenRequest = async (
  body: URLSearchParams,
  fetchImpl: typeof fetch,
  baseUrl: string,
): Promise<LmTokens> => {
  let res: Response;
  try {
    res = await fetchImpl(`${baseUrl}${OAUTH_TOKEN_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: originOf(baseUrl) },
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Origin: originOf(baseUrl) },
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
export type LmCover =
  | { kind: 'ok'; bytes: Uint8Array; etag: string }
  | { kind: 'unmodified' }
  | { kind: 'none' };

export interface LmBookDetails {
  id: string;
  title: string;
  author: string | null;
  versions: LmVersion[];
  /** catalogue metadata, present when the server has them */
  series?: string | null;
  description?: string | null;
  publisher?: string | null;
  language?: string | null;
  genres?: string[] | null;
  tags?: string[] | null;
}
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
/**
 * Personal progress of one version, KOReader contract: progress is a
 * CREngine/KOReader XPointer (or null when no precise anchor exists — legacy
 * CFI/JSON coordinates are no longer exposed), percentage a fraction 0..1.
 * updatedAtMs is normalized client-side (the wire value may be unix seconds,
 * milliseconds or an ISO instant).
 */
export interface LmProgress {
  bookId: string;
  versionId: string;
  progress: string | null;
  percentage: number;
  revision: number;
  updatedAtMs: number;
}
/** PUT body — cfi / chapterId / percent are refused (validationFailed) */
export interface LmProgressOp {
  installationId: string;
  operationId: string;
  expectedRevision: number;
  versionId: string;
  progress: string | null;
  percentage: number;
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** wire timestamp → epoch ms (seconds, ms or ISO 8601); 0 when unreadable */
export function progressUpdatedAtMs(updatedAt: unknown): number {
  if (typeof updatedAt === 'number' && Number.isFinite(updatedAt)) return updatedAt > 1e12 ? updatedAt : updatedAt * 1000;
  if (typeof updatedAt === 'string') {
    const ms = Date.parse(updatedAt);
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

/** defensive read of a progress payload; null for "no progress" */
export function normalizeLmProgress(raw: unknown): LmProgress | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const percentage = typeof r.percentage === 'number' && Number.isFinite(r.percentage) ? clamp01(r.percentage) : null;
  if (percentage === null || typeof r.revision !== 'number') throw new LmError('server', 'progress: unexpected payload');
  return {
    bookId: String(r.bookId ?? ''),
    versionId: String(r.versionId ?? ''),
    progress: xpointerOrNull(r.progress),
    percentage,
    revision: r.revision,
    updatedAtMs: progressUpdatedAtMs(r.updatedAt),
  };
}

export interface LmMe { account?: { id?: string; email?: string; name?: string } }

interface BusinessErrorBody { error?: { code?: string; details?: unknown } }

export class LmClient {
  constructor(private base: string, private token: string, private fetchImpl: typeof fetch) {}

  private async call(path: string, init: RequestInit = {}, opts: { passThrough?: number[] } = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}${path}`, { ...init, headers });
    } catch (err) {
      throw new LmError('network', err instanceof Error ? err.message : String(err));
    }
    if (res.ok) return res;
    if (opts.passThrough?.includes(res.status)) return res;
    if (res.status === 401) throw new LmError('auth', undefined, undefined, undefined, 401);
    let body: BusinessErrorBody = {};
    try { body = (await res.json()) as BusinessErrorBody; } catch { /* non-JSON error body */ }
    if (res.status === 403) throw new LmError('forbidden', `403 ${body.error?.code ?? ''}`.trim(), body.error?.code, undefined, 403);
    if (res.status === 409) throw new LmError('conflict', `409 ${body.error?.code ?? ''}`.trim(), body.error?.code, body.error?.details, 409);
    if (res.status === 429) throw new LmError('rate', `429 ${body.error?.code ?? ''}`.trim(), body.error?.code, undefined, 429);
    throw new LmError('server', `${init.method ?? 'GET'} ${path} → ${res.status}`, body.error?.code, undefined, res.status);
  }

  me(): Promise<LmMe> {
    return this.call('/api/v1/mobile/me').then((r) => r.json());
  }

  async listSpaces(): Promise<LmSpace[]> {
    const res = await this.call('/api/v1/mobile/spaces');
    const data = (await res.json()) as LmSpace[] | { spaces?: LmSpace[] };
    return Array.isArray(data) ? data : (data.spaces ?? []);
  }

  /** catalogue page; search= is the keyword filter of the catalogue route */
  listBooks(spaceId: string, opts: { pageSize?: number; cursor?: string | null; search?: string; series?: string | null } = {}): Promise<LmPage<LmBook>> {
    const params = new URLSearchParams({ pageSize: String(opts.pageSize ?? 50) });
    if (opts.cursor) params.set('cursor', opts.cursor);
    if (opts.search) params.set('search', opts.search);
    if (opts.series) params.set('series', opts.series);
    return this.call(`/api/v1/mobile/spaces/${spaceId}/books?${params.toString()}`).then((r) => r.json());
  }

  /**
   * keyword search on the dedicated /books/search route (q required, 1..512
   * chars; total is null there). LibraryQuery filters ride along (series,
   * sort, direction); continuation keeps every parameter and adds the cursor.
   */
  searchBooks(spaceId: string, opts: { q: string; pageSize?: number; cursor?: string | null; series?: string | null; sort?: string; direction?: string }): Promise<LmPage<LmBook>> {
    const params = new URLSearchParams({ pageSize: String(opts.pageSize ?? 50) });
    params.set('q', opts.q);
    if (opts.cursor) params.set('cursor', opts.cursor);
    if (opts.series) params.set('series', opts.series);
    if (opts.sort) params.set('sort', opts.sort);
    if (opts.direction) params.set('direction', opts.direction);
    return this.call(`/api/v1/mobile/spaces/${spaceId}/books/search?${params.toString()}`).then((r) => r.json());
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

  /**
   * Version-scoped cover (profile cover_v1) with conditional GET. On 200 the
   * WebP bytes are verified against the ETag fingerprint (sha256, ≤ 512 KiB)
   * before being published; 304 means the caller's stored bytes remain valid;
   * 404 means pending or noCover — show the local placeholder.
   */
  async getCover(spaceId: string, bookId: string, versionId: string, storedEtag: string | null): Promise<LmCover> {
    const headers: Record<string, string> = {};
    if (storedEtag) headers['If-None-Match'] = storedEtag;
    const res = await this.call(
      `/api/v1/mobile/spaces/${spaceId}/books/${bookId}/versions/${versionId}/cover?profile=cover_v1`,
      { headers },
      { passThrough: [304, 404] },
    );
    if (res.status === 404) return { kind: 'none' };
    if (res.status === 304) return { kind: 'unmodified' };
    const etag = res.headers.get('etag');
    const bytes = new Uint8Array(await res.arrayBuffer());
    const length = Number(res.headers.get('content-length'));
    if (res.headers.get('content-type') !== 'image/webp') throw new LmError('server', 'cover: bad content type');
    if (!etag || !/^"sha256-[a-f0-9]{64}"$/.test(etag)) throw new LmError('server', 'cover: bad etag');
    if (!Number.isSafeInteger(length) || length < 1 || length > 524288 || bytes.length !== length) {
      throw new LmError('server', 'cover: bad length');
    }
    if (etag !== `"sha256-${await sha256HexOfBytes(bytes)}"`) throw new LmError('server', 'cover: hash mismatch');
    return { kind: 'ok', bytes, etag };
  }

  /** no stored progress on the server → null */
  getProgress(spaceId: string, bookId: string, versionId: string): Promise<LmProgress | null> {
    return this.call(`/api/v1/mobile/spaces/${spaceId}/books/${bookId}/progress?versionId=${versionId}`)
      .then((r) => r.json())
      .then(normalizeLmProgress);
  }

  /**
   * revision-checked write; a 409 surfaces as LmError('conflict', …, 'revisionConflict', details).
   * The body is re-sanitized here: only a valid XPointer (else null) and a
   * fraction clamped to 0..1 ever leave the device.
   */
  putProgress(spaceId: string, bookId: string, op: LmProgressOp): Promise<LmProgress> {
    const body: LmProgressOp = {
      installationId: op.installationId,
      operationId: op.operationId,
      expectedRevision: op.expectedRevision,
      versionId: op.versionId,
      progress: xpointerOrNull(op.progress),
      percentage: clamp01(op.percentage),
    };
    return this.call(`/api/v1/mobile/spaces/${spaceId}/books/${bookId}/progress`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((r) => r.json())
      .then((data) => {
        const receipt = normalizeLmProgress(data);
        if (!receipt) throw new LmError('server', 'progress: empty receipt');
        return receipt;
      });
  }
}

export const createLmClient = (
  opts: { baseUrl?: string; accessToken: string },
  fetchImpl: typeof fetch = globalThis.fetch,
): LmClient => new LmClient(opts.baseUrl ?? LM_BASE_URL, opts.accessToken, fetchImpl);
