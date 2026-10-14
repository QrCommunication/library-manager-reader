import { createLmClient, lmRefresh, type LmClient } from './lmClient';
import type { UiPrefs } from '../types';

interface SettingsLike {
  getUiPrefs(): Promise<UiPrefs>;
  putUiPrefs(p: UiPrefs): Promise<void>;
}

// a bearer 401 mid-session is answered by the UI (re-sign-in); here we only
// renew proactively, 30 s before expiry, when a refresh token was stored
export async function lmClientFromPrefs(
  settings: SettingsLike,
  fetchImpl: typeof fetch = fetch,
): Promise<LmClient> {
  const prefs = await settings.getUiPrefs();
  let { lmAccessToken: token, lmRefreshToken: refresh, lmTokenExpiresAt: expiresAt } = prefs;
  if (token && refresh && expiresAt - 30_000 <= Date.now()) {
    const renewed = await lmRefresh({ refreshToken: refresh }, fetchImpl);
    token = renewed.accessToken;
    refresh = renewed.refreshToken || refresh;
    expiresAt = renewed.expiresAt;
    await settings.putUiPrefs({ ...prefs, lmAccessToken: token, lmRefreshToken: refresh, lmTokenExpiresAt: expiresAt });
  }
  return createLmClient({ accessToken: token }, fetchImpl);
}
