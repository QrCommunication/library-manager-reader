import {
  lmClientFromAccount, lmBeginSignIn, lmCompleteSignIn, lmDisconnect, lmInstallationId,
  type LmAccountDeps,
} from '../lmAccount';
import { memoryTokenStore, memoryPendingStore } from '../lmTokens';
import { LmClient, LmError } from '../lmClient';
import type { UiPrefs } from '../../../core/types';
import { DEFAULT_UI_PREFS } from '../../../core/types';

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const fixedCrypto = {
  random: (n: number) => new Uint8Array(n).fill(7),
  sha256Base64url: async () => 'challenge-fixed',
};

const makeDeps = (over: Partial<UiPrefs> = {}) => {
  let prefs: UiPrefs = { ...DEFAULT_UI_PREFS, ...over };
  const deps: LmAccountDeps & { getPrefs: () => UiPrefs; tokens: ReturnType<typeof memoryTokenStore>; pending: ReturnType<typeof memoryPendingStore> } = {
    settings: {
      getUiPrefs: async () => prefs,
      putUiPrefs: async (p: UiPrefs) => { prefs = p; },
    },
    tokens: memoryTokenStore(),
    pending: memoryPendingStore(),
    getPrefs: () => prefs,
  };
  return deps;
};

describe('lmInstallationId', () => {
  it('persists a stable UUID on first use', async () => {
    const deps = makeDeps();
    const id = await lmInstallationId(deps);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await lmInstallationId(deps)).toBe(id);
    expect(deps.getPrefs().lmInstallationId).toBe(id);
  });
});

describe('PKCE sign-in', () => {
  it('begin: stashes verifier+state and returns the authorize url', async () => {
    const deps = makeDeps();
    const url = await lmBeginSignIn(deps, fixedCrypto);
    expect(url).toContain('https://library-manager.com/api/mobile/oauth/authorize?');
    expect(url).toContain('code_challenge=challenge-fixed');
    expect(url).toContain('state=');
    const pending = await deps.pending.get();
    expect(pending?.verifier).toHaveLength(43);
    expect(url).toContain(`state=${pending?.state}`);
  });

  it('complete: validates state, exchanges the code, keychains tokens, remembers the name', async () => {
    const deps = makeDeps();
    const url = await lmBeginSignIn(deps, fixedCrypto);
    const state = new URL(url).searchParams.get('state')!;

    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(u), init: init ?? {} });
      if (String(u).endsWith('/oauth/token')) return okJson({ access_token: 'at-1', refresh_token: 'rt-1', expires_in: 600 });
      if (String(u).endsWith('/me')) return okJson({ account: { id: 'a1', email: 'rony@example.com' } });
      throw new Error('unexpected ' + String(u));
    };
    const name = await lmCompleteSignIn(deps, `https://library-manager.com/mobile/callback?code=abc&state=${state}`, fetchImpl as unknown as typeof fetch);
    expect(name).toBe('rony@example.com');
    expect(await deps.tokens.get()).toMatchObject({ accessToken: 'at-1', refreshToken: 'rt-1' });
    expect(deps.getPrefs().lmUsername).toBe('rony@example.com');
    expect(await deps.pending.get()).toBeNull();
    const body = String(calls[0]!.init.body);
    expect(body).toContain('grant_type=authorization_code');
    // 32 bytes of 0x07 = the fixed entropy injected above
    expect(body).toContain('code_verifier=BwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwc');
    expect(calls[1]!.url).toContain('/api/v1/mobile/me');
  });

  it('complete: rejects a state mismatch and leaves no tokens behind', async () => {
    const deps = makeDeps();
    await lmBeginSignIn(deps, fixedCrypto);
    const fetchImpl = jest.fn(async () => okJson({ access_token: 'x' }));
    await expect(
      lmCompleteSignIn(deps, 'https://library-manager.com/mobile/callback?code=abc&state=WRONG', fetchImpl as unknown as typeof fetch),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await deps.tokens.get()).toBeNull();
    expect(await deps.pending.get()).toBeNull();
  });

  it('complete: surfaces an oauth error return as an auth failure', async () => {
    const deps = makeDeps();
    await lmBeginSignIn(deps, fixedCrypto);
    await expect(
      lmCompleteSignIn(deps, 'https://library-manager.com/mobile/callback?error=access_denied', jest.fn() as unknown as typeof fetch),
    ).rejects.toMatchObject({ kind: 'auth' });
    expect(await deps.pending.get()).toBeNull();
  });

  it('complete without a pending demand is refused', async () => {
    const deps = makeDeps();
    await expect(
      lmCompleteSignIn(deps, 'https://library-manager.com/mobile/callback?code=abc&state=s', jest.fn() as unknown as typeof fetch),
    ).rejects.toMatchObject({ kind: 'auth' });
  });
});

describe('lmDisconnect', () => {
  it('revokes the refresh token and wipes every credential', async () => {
    const deps = makeDeps({ lmUsername: 'rony' });
    await deps.tokens.set({ accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 1000 });
    await deps.pending.set({ verifier: 'v', state: 's' });
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(u), init: init ?? {} });
      return new Response(null, { status: 200 });
    };
    await lmDisconnect(deps, fetchImpl as unknown as typeof fetch);
    expect(calls[0]!.url).toBe('https://library-manager.com/api/mobile/oauth/revoke');
    expect(String(calls[0]!.init.body)).toContain('token=rt');
    expect(await deps.tokens.get()).toBeNull();
    expect(await deps.pending.get()).toBeNull();
    expect(deps.getPrefs().lmUsername).toBe('');
    // prefs never carried the tokens
    expect(deps.getPrefs()).not.toHaveProperty('lmAccessToken');
  });

  it('still wipes when the revoke call fails', async () => {
    const deps = makeDeps();
    await deps.tokens.set({ accessToken: 'at', refreshToken: 'rt', expiresAt: 1 });
    await expect(lmDisconnect(deps, (async () => { throw new TypeError('offline'); }) as unknown as typeof fetch)).resolves.toBeUndefined();
    expect(await deps.tokens.get()).toBeNull();
  });
});

describe('lmClientFromAccount', () => {
  it('throws auth when nothing is stored', async () => {
    const deps = makeDeps();
    await expect(lmClientFromAccount(deps)).rejects.toMatchObject({ kind: 'auth' });
  });

  it('returns a client with the fresh bearer and skips renewal', async () => {
    const deps = makeDeps();
    await deps.tokens.set({ accessToken: 'at-1', refreshToken: 'rt-1', expiresAt: Date.now() + 3600_000 });
    const fetchImpl = jest.fn(async () => okJson({}));
    const client = await lmClientFromAccount(deps, fetchImpl as unknown as typeof fetch);
    expect(client).toBeInstanceOf(LmClient);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('renews 30 s before expiry and atomically stores the rotated pair', async () => {
    const deps = makeDeps();
    await deps.tokens.set({ accessToken: 'old', refreshToken: 'rt-1', expiresAt: Date.now() - 1000 });
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (u: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(u), init: init ?? {} });
      return okJson({ access_token: 'new', refresh_token: 'rt-2', expires_in: 600 });
    };
    const client = await lmClientFromAccount(deps, fetchImpl as unknown as typeof fetch);
    expect(client).toBeInstanceOf(LmClient);
    expect(String(calls[0]!.init.body)).toContain('grant_type=refresh_token');
    expect(await deps.tokens.get()).toMatchObject({ accessToken: 'new', refreshToken: 'rt-2' });
  });

  it('keeps the old access token when no refresh token exists', async () => {
    const deps = makeDeps();
    await deps.tokens.set({ accessToken: 'old', refreshToken: '', expiresAt: Date.now() - 1000 });
    const fetchImpl = jest.fn(async () => okJson({}));
    await lmClientFromAccount(deps, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await deps.tokens.get())?.accessToken).toBe('old');
  });
});

describe('LmError surface', () => {
  it('keeps a stable name for downstream matching', () => {
    const err = new LmError('conflict', '409 revisionConflict', 'revisionConflict');
    expect(err.name).toBe('LmError');
    expect(err.kind).toBe('conflict');
  });
});
