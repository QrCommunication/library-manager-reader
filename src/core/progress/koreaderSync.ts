import { KoSyncError } from './koSyncError';

export { KoSyncError };

export interface KoSyncConfig {
  baseUrl: string;
  username: string;
  /** md5 hex of the password — the protocol never carries the raw secret */
  userkey: string;
  device: string;
  deviceId: string;
}

export interface KoSyncProgress {
  percentage: number;
  progress: string | null;
  device: string | null;
  deviceId: string | null;
  timestamp: number | null;
}

export interface KoSyncClient {
  register(): Promise<'created' | 'exists'>;
  authorize(): Promise<boolean>;
  /** null: the server has no progress for this document */
  getProgress(document: string): Promise<KoSyncProgress | null>;
  updateProgress(document: string, progress: string, percentage: number): Promise<boolean>;
}

const V1_ACCEPT = 'application/vnd.koreader.v1+json';
// 402 is koreader-sync-server's "username already registered"
const REGISTER_STATUSES = { created: 201, exists: 402 } as const;

export function createKoSyncClient(config: KoSyncConfig, fetchImpl: typeof fetch = fetch): KoSyncClient {
  const base = config.baseUrl.replace(/\/+$/, '');
  const jsonRequest = async (path: string, init: RequestInit): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchImpl(base + path, init);
    } catch (err) {
      throw new KoSyncError('network', err instanceof Error ? err.message : String(err));
    }
    return res;
  };
  const parseJson = async (res: Response): Promise<Record<string, unknown>> => {
    try { return await res.json() as Record<string, unknown>; } catch { return {}; }
  };
  const authHeaders = (): Record<string, string> => ({
    accept: V1_ACCEPT,
    'x-auth-user': config.username,
    'x-auth-key': config.userkey,
  });
  const requireAuth = (res: Response): void => {
    if (res.status === 401) throw new KoSyncError('auth', 'unauthorized');
  };

  return {
    async register() {
      const res = await jsonRequest('/users/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: V1_ACCEPT },
        body: JSON.stringify({ username: config.username, password: config.userkey }),
      });
      if (res.status === REGISTER_STATUSES.created) return 'created';
      if (res.status === REGISTER_STATUSES.exists) return 'exists';
      const body = await parseJson(res);
      throw new KoSyncError('server', typeof body.message === 'string' ? body.message : `status ${res.status}`);
    },

    async authorize() {
      const res = await jsonRequest('/users/auth', { method: 'GET', headers: authHeaders() });
      if (res.status === 200) return true;
      if (res.status === 401) return false;
      throw new KoSyncError('server', `status ${res.status}`);
    },

    async getProgress(document: string) {
      const res = await jsonRequest(`/syncs/progress/${encodeURIComponent(document)}`, { method: 'GET', headers: authHeaders() });
      requireAuth(res);
      if (res.status !== 200) throw new KoSyncError('server', `status ${res.status}`);
      const body = await parseJson(res);
      const percentage = body.percentage;
      if (typeof percentage !== 'number' || !Number.isFinite(percentage)) return null;
      return {
        percentage,
        progress: typeof body.progress === 'string' ? body.progress : null,
        device: typeof body.device === 'string' ? body.device : null,
        deviceId: typeof body.device_id === 'string' ? body.device_id : null,
        timestamp: typeof body.timestamp === 'number' ? body.timestamp : null,
      };
    },

    async updateProgress(document: string, progress: string, percentage: number) {
      const res = await jsonRequest('/syncs/progress', {
        method: 'PUT',
        headers: { ...authHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({
          document, progress, percentage,
          device: config.device, device_id: config.deviceId,
        }),
      });
      requireAuth(res);
      if (res.status === 200 || res.status === 202) return true;
      throw new KoSyncError('server', `status ${res.status}`);
    },
  };
}
