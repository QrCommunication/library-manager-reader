import { createKoSyncClient, KoSyncError, type KoSyncProgress } from '../koreaderSync';

const config = {
  baseUrl: 'https://sync.example.org',
  username: 'benoit',
  userkey: 'key-hash',
  device: 'Library Reader',
  deviceId: 'device-1',
};

type Call = { url: string; init: RequestInit };
const makeFetch = (respond: (url: string, init: RequestInit) => { status: number; body?: unknown }): { calls: Call[]; fetchImpl: typeof fetch } => {
  const calls: Call[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const r = respond(String(url), init ?? {});
    return new Response(r.body === undefined ? null : JSON.stringify(r.body), { status: r.status });
  }) as typeof fetch;
  return { calls, fetchImpl };
};

describe('koreaderSync client (KOSync v1)', () => {
  it('authorizes with x-auth headers and the v1 accept header', async () => {
    const { calls, fetchImpl } = makeFetch(() => ({ status: 200, body: { authorized: true } }));
    const client = createKoSyncClient(config, fetchImpl);
    expect(await client.authorize()).toBe(true);
    expect(calls[0]!.url).toBe('https://sync.example.org/users/auth');
    expect(calls[0]!.init.method).toBe('GET');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-auth-user']).toBe('benoit');
    expect(headers['x-auth-key']).toBe('key-hash');
    expect(headers['accept']).toBe('application/vnd.koreader.v1+json');
  });

  it('authorize returns false on 401', async () => {
    const { fetchImpl } = makeFetch(() => ({ status: 401, body: { message: 'unauthorized' } }));
    expect(await createKoSyncClient(config, fetchImpl).authorize()).toBe(false);
  });

  it('registers with md5 password in the body; maps 402 to exists', async () => {
    const { calls, fetchImpl } = makeFetch(() => ({ status: 201, body: {} }));
    const client = createKoSyncClient(config, fetchImpl);
    expect(await client.register()).toBe('created');
    expect(calls[0]!.url).toBe('https://sync.example.org/users/create');
    expect(calls[0]!.init.method).toBe('POST');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ username: 'benoit', password: 'key-hash' });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-auth-user']).toBeUndefined();

    const { fetchImpl: existsFetch } = makeFetch(() => ({ status: 402, body: { message: 'already' } }));
    expect(await createKoSyncClient(config, existsFetch).register()).toBe('exists');
  });

  it('pulls progress: numeric fields from snake_case, missing percentage means none', async () => {
    const { calls, fetchImpl } = makeFetch(() => ({
      status: 200,
      body: { document: 'doc1', progress: '42.3', percentage: 0.423, device: 'Kobo', device_id: 'k1', timestamp: 1700000000 },
    }));
    const p: KoSyncProgress | null = await createKoSyncClient(config, fetchImpl).getProgress('doc1');
    expect(calls[0]!.url).toBe('https://sync.example.org/syncs/progress/doc1');
    expect(p).toEqual({ percentage: 0.423, progress: '42.3', device: 'Kobo', deviceId: 'k1', timestamp: 1700000000 });

    const { fetchImpl: emptyFetch } = makeFetch(() => ({ status: 200, body: {} }));
    expect(await createKoSyncClient(config, emptyFetch).getProgress('doc1')).toBeNull();
  });

  it('pushes progress with device_id payload field', async () => {
    const { calls, fetchImpl } = makeFetch(() => ({ status: 200, body: {} }));
    expect(await createKoSyncClient(config, fetchImpl).updateProgress('doc1', '42.3', 0.423)).toBe(true);
    expect(calls[0]!.init.method).toBe('PUT');
    expect(calls[0]!.url).toBe('https://sync.example.org/syncs/progress');
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      document: 'doc1', progress: '42.3', percentage: 0.423, device: 'Library Reader', device_id: 'device-1',
    });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-auth-key']).toBe('key-hash');
  });

  it('throws KoSyncError with kind auth on 401 and network on fetch failure', async () => {
    const { fetchImpl } = makeFetch(() => ({ status: 401, body: { message: 'unauthorized' } }));
    await expect(createKoSyncClient(config, fetchImpl).getProgress('doc1')).rejects.toMatchObject({ kind: 'auth' });

    const failing = (async () => { throw new TypeError('network down'); }) as unknown as typeof fetch;
    await expect(createKoSyncClient(config, failing).getProgress('doc1')).rejects.toMatchObject({ kind: 'network' });

    const { fetchImpl: serverErr } = makeFetch(() => ({ status: 500, body: {} }));
    await expect(createKoSyncClient(config, serverErr).updateProgress('d', '1', 0.1)).rejects.toBeInstanceOf(KoSyncError);
  });
});
