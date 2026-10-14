// Account-level flows for library-manager.com: PKCE sign-in through the system
// browser, keychained tokens, installation identity, silent renewal. Tokens and
// the PKCE verifier/state never leave the secure store — prefs carry only the
// display name and the installation UUID (spec §10).

import { createLmClient, lmExchangeCode, lmRefresh, lmRevoke, LmError, type LmClient } from './lmClient';
import { buildAuthorizationUrl, createChallenge, parseCallback } from './lmPkce';
import { lmCrypto } from './lmSha256';
import type { LmPendingStore, LmTokenStore } from './lmTokens';
import type { PkceDeps } from './lmPkce';
import { uuidV7 } from '../uuid';
import type { UiPrefs } from '../types';

interface SettingsLike {
  getUiPrefs(): Promise<UiPrefs>;
  putUiPrefs(p: UiPrefs): Promise<void>;
}

export interface LmAccountDeps {
  settings: SettingsLike;
  tokens: LmTokenStore;
  pending: LmPendingStore;
}

/** stable per-installation UUID, created once and reused by progress ops and copy confirmations */
export async function lmInstallationId(deps: LmAccountDeps): Promise<string> {
  const prefs = await deps.settings.getUiPrefs();
  if (prefs.lmInstallationId) return prefs.lmInstallationId;
  const id = uuidV7();
  await deps.settings.putUiPrefs({ ...prefs, lmInstallationId: id });
  return id;
}

/** PKCE step 1: build the challenge, keep verifier+state in secure storage, hand back the browser URL */
export async function lmBeginSignIn(
  deps: LmAccountDeps,
  crypto: Pick<PkceDeps, 'random' | 'sha256Base64url'> = lmCrypto,
): Promise<string> {
  const challenge = await createChallenge(crypto);
  await deps.pending.set({ verifier: challenge.verifier, state: challenge.state });
  return buildAuthorizationUrl(challenge);
}

/**
 * PKCE step 2: the system browser landed on the callback. The pending demand is
 * consumed first — state is single-use, so any failure means starting over.
 */
export async function lmCompleteSignIn(
  deps: LmAccountDeps,
  callbackUrl: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string> {
  const pending = await deps.pending.get();
  await deps.pending.clear();
  const parsed = parseCallback(callbackUrl);
  if (!pending) throw new LmError('auth', 'no pending sign-in');
  if (parsed.error) throw new LmError('auth', `oauth_error:${parsed.error}`);
  if (!parsed.code) throw new LmError('auth', 'missing_code');
  if (parsed.state !== pending.state) throw new LmError('auth', 'state_mismatch');

  const tokens = await lmExchangeCode({ code: parsed.code, codeVerifier: pending.verifier }, fetchImpl);
  await deps.tokens.set(tokens);

  // display name is cosmetic: a failed /me must not fail the sign-in
  let display = '';
  try {
    const me = await createLmClient({ accessToken: tokens.accessToken }, fetchImpl).me();
    display = me.account?.email ?? me.account?.name ?? me.account?.id ?? '';
  } catch { /* keep whatever name we had */ }
  if (display) {
    const prefs = await deps.settings.getUiPrefs();
    await deps.settings.putUiPrefs({ ...prefs, lmUsername: display });
  }
  return display;
}

export async function lmIsConnected(deps: LmAccountDeps): Promise<boolean> {
  return (await deps.tokens.get()) !== null;
}

/** revoke best-effort, then wipe every credential; local files and prefs stay */
export async function lmDisconnect(deps: LmAccountDeps, fetchImpl: typeof fetch = globalThis.fetch): Promise<void> {
  const tokens = await deps.tokens.get();
  if (tokens?.refreshToken) await lmRevoke({ refreshToken: tokens.refreshToken }, fetchImpl);
  await deps.tokens.clear();
  await deps.pending.clear();
  const prefs = await deps.settings.getUiPrefs();
  await deps.settings.putUiPrefs({ ...prefs, lmUsername: '' });
}

/**
 * Client factory for a signed-in account. Renews proactively 30 s before
 * expiry; the rotated pair is persisted BEFORE any business call goes out, so
 * a crash never resurrects the consumed refresh token.
 */
export async function lmClientFromAccount(deps: LmAccountDeps, fetchImpl: typeof fetch = globalThis.fetch): Promise<LmClient> {
  const current = await deps.tokens.get();
  if (!current) throw new LmError('auth', 'not signed in');
  let { accessToken, refreshToken, expiresAt } = current;
  if (refreshToken && expiresAt - 30_000 <= Date.now()) {
    const renewed = await lmRefresh({ refreshToken }, fetchImpl);
    const next = {
      accessToken: renewed.accessToken,
      refreshToken: renewed.refreshToken || refreshToken,
      expiresAt: renewed.expiresAt,
    };
    await deps.tokens.set(next);
    ({ accessToken, refreshToken, expiresAt } = next);
  }
  return createLmClient({ accessToken }, fetchImpl);
}
