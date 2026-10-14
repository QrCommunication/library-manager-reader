import { lmClientFromPrefs } from '../lmAccount';
import { LmClient } from '../lmClient';
import type { UiPrefs } from '../../../core/types';
import { DEFAULT_UI_PREFS } from '../../../core/types';

const okJson = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

const makeSettings = (over: Partial<UiPrefs>) => {
  let current: UiPrefs = { ...DEFAULT_UI_PREFS, ...over };
  return {
    repo: {
      getUiPrefs: async () => current,
      putUiPrefs: async (p: UiPrefs) => { current = p; },
    },
    get: () => current,
  };
};

describe('lmClientFromPrefs', () => {
  it('returns a client from the stored token while it is still fresh', async () => {
    const fetchImpl = jest.fn(async () => okJson({}));
    const { repo } = makeSettings({ lmAccessToken: 'tok-1', lmRefreshToken: 'rt-1', lmTokenExpiresAt: Date.now() + 3600_000 });
    const client = await lmClientFromPrefs(repo, fetchImpl as unknown as typeof fetch);
    expect(client).toBeInstanceOf(LmClient);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refreshes an expired token with the refresh grant and persists the new pair', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return okJson({ access_token: 'at-2', refresh_token: 'rt-2', expires_in: 3600 });
    };
    const { repo, get } = makeSettings({ lmAccessToken: 'old', lmRefreshToken: 'rt-1', lmTokenExpiresAt: Date.now() - 1000 });
    await lmClientFromPrefs(repo, fetchImpl);
    expect(String(calls[0]!.init.body)).toContain('grant_type=refresh_token');
    expect(get().lmAccessToken).toBe('at-2');
    expect(get().lmRefreshToken).toBe('rt-2');
    expect(get().lmTokenExpiresAt).toBeGreaterThan(Date.now());
  });

  it('keeps the stored token when it expired but no refresh token exists', async () => {
    const fetchImpl = jest.fn(async () => okJson({}));
    const { repo, get } = makeSettings({ lmAccessToken: 'old', lmRefreshToken: '', lmTokenExpiresAt: Date.now() - 1000 });
    const client = await lmClientFromPrefs(repo, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(get().lmAccessToken).toBe('old');
  });
});
