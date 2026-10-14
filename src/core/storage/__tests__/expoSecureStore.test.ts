import { createLmAccountDeps } from '../expoSecureStore';
import { LM_PKCE_KEYS, LM_TOKEN_KEYS } from '../../remote/lmTokens';
import { DEFAULT_UI_PREFS, type UiPrefs } from '../../types';

jest.mock('expo-secure-store', () => {
  const mockMap = new Map<string, string>();
  return {
    __esModule: true,
    getItemAsync: async (k: string) => mockMap.get(k) ?? null,
    setItemAsync: async (k: string, v: string) => { mockMap.set(k, v); },
    deleteItemAsync: async (k: string) => { mockMap.delete(k); },
  };
});

const settingsRepo = () => {
  let current: UiPrefs = { ...DEFAULT_UI_PREFS };
  return {
    getUiPrefs: async () => current,
    putUiPrefs: async (p: UiPrefs) => { current = p; },
  };
};

describe('createLmAccountDeps (Keychain/Keystore wiring)', () => {
  it('stores OAuth tokens in the secure store, not in prefs', async () => {
    const deps = createLmAccountDeps(settingsRepo());
    await deps.tokens.set({ accessToken: 'at', refreshToken: 'rt', expiresAt: 123 });
    const SecureStore = require('expo-secure-store');
    expect(await SecureStore.getItemAsync(LM_TOKEN_KEYS.access)).toBe('at');
    expect(await SecureStore.getItemAsync(LM_TOKEN_KEYS.refresh)).toBe('rt');
    expect(await deps.tokens.get()).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: 123 });
    await deps.tokens.clear();
    expect(await deps.tokens.get()).toBeNull();
  });

  it('keeps the pending PKCE demand in the secure store too', async () => {
    const deps = createLmAccountDeps(settingsRepo());
    await deps.pending.set({ verifier: 'v', state: 's' });
    const SecureStore = require('expo-secure-store');
    expect(await SecureStore.getItemAsync(LM_PKCE_KEYS.verifier)).toBe('v');
    expect(await deps.pending.get()).toEqual({ verifier: 'v', state: 's' });
    await deps.pending.clear();
    expect(await deps.pending.get()).toBeNull();
  });
});
