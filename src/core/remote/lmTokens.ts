// Secure persistence of library-manager.com tokens (spec §10): iOS Keychain /
// Android Keystore via expo-secure-store. Token values never reach logs or
// error reports — only the typed LmTokens object crosses this port.

export interface LmTokens { accessToken: string; refreshToken: string; expiresAt: number }

export const LM_TOKEN_KEYS = {
  access: 'lm.accessToken',
  refresh: 'lm.refreshToken',
  expiresAt: 'lm.expiresAt',
} as const;

export interface LmSecureStore {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

export interface LmTokenStore {
  get(): Promise<LmTokens | null>;
  set(tokens: LmTokens): Promise<void>;
  clear(): Promise<void>;
}

export function createLmTokenStore(secure: LmSecureStore): LmTokenStore {
  return {
    async get() {
      const accessToken = await secure.getItemAsync(LM_TOKEN_KEYS.access);
      if (!accessToken) return null;
      const refreshToken = (await secure.getItemAsync(LM_TOKEN_KEYS.refresh)) ?? '';
      const expiresRaw = await secure.getItemAsync(LM_TOKEN_KEYS.expiresAt);
      return { accessToken, refreshToken, expiresAt: expiresRaw ? Number(expiresRaw) : 0 };
    },
    async set(tokens: LmTokens) {
      await secure.setItemAsync(LM_TOKEN_KEYS.access, tokens.accessToken);
      await secure.setItemAsync(LM_TOKEN_KEYS.refresh, tokens.refreshToken);
      await secure.setItemAsync(LM_TOKEN_KEYS.expiresAt, String(tokens.expiresAt));
    },
    async clear() {
      await secure.deleteItemAsync(LM_TOKEN_KEYS.access);
      await secure.deleteItemAsync(LM_TOKEN_KEYS.refresh);
      await secure.deleteItemAsync(LM_TOKEN_KEYS.expiresAt);
    },
  };
}

export function memoryTokenStore(): LmTokenStore {
  let current: LmTokens | null = null;
  return {
    async get() {
      return current;
    },
    async set(tokens: LmTokens) {
      current = tokens;
    },
    async clear() {
      current = null;
    },
  };
}

export const LM_PKCE_KEYS = {
  verifier: 'lm.pkce.verifier',
  state: 'lm.pkce.state',
} as const;

export interface LmPendingPkce { verifier: string; state: string }

export interface LmPendingStore {
  get(): Promise<LmPendingPkce | null>;
  set(pending: LmPendingPkce): Promise<void>;
  clear(): Promise<void>;
}

/** PKCE verifier/state live only for the current authorization demand (spec §10) */
export function createLmPendingStore(secure: LmSecureStore): LmPendingStore {
  return {
    async get() {
      const verifier = await secure.getItemAsync(LM_PKCE_KEYS.verifier);
      const state = await secure.getItemAsync(LM_PKCE_KEYS.state);
      return verifier && state ? { verifier, state } : null;
    },
    async set(pending: LmPendingPkce) {
      await secure.setItemAsync(LM_PKCE_KEYS.verifier, pending.verifier);
      await secure.setItemAsync(LM_PKCE_KEYS.state, pending.state);
    },
    async clear() {
      await secure.deleteItemAsync(LM_PKCE_KEYS.verifier);
      await secure.deleteItemAsync(LM_PKCE_KEYS.state);
    },
  };
}

export function memoryPendingStore(): LmPendingStore {
  let current: LmPendingPkce | null = null;
  return {
    async get() {
      return current;
    },
    async set(pending: LmPendingPkce) {
      current = pending;
    },
    async clear() {
      current = null;
    },
  };
}
