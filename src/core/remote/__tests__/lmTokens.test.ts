import { createLmTokenStore, createLmPendingStore, memoryTokenStore, LM_TOKEN_KEYS, LM_PKCE_KEYS, type LmSecureStore } from '../lmTokens';

const makeSecure = () => {
  const bag = new Map<string, string>();
  const secure: LmSecureStore & { bag: Map<string, string> } = {
    bag,
    getItemAsync: async (key) => bag.get(key) ?? null,
    setItemAsync: async (key, value) => { bag.set(key, value); },
    deleteItemAsync: async (key) => { bag.delete(key); },
  };
  return secure;
};

describe('lmTokenStore over a Keychain/Keystore adapter', () => {
  it('round-trips tokens through the secure store keys', async () => {
    const secure = makeSecure();
    const store = createLmTokenStore(secure);
    await store.set({ accessToken: 'lma_1', refreshToken: 'lmr_1', expiresAt: 123456 });
    expect(secure.bag.get(LM_TOKEN_KEYS.access)).toBe('lma_1');
    expect(secure.bag.get(LM_TOKEN_KEYS.refresh)).toBe('lmr_1');
    expect(secure.bag.get(LM_TOKEN_KEYS.expiresAt)).toBe('123456');
    expect(await store.get()).toEqual({ accessToken: 'lma_1', refreshToken: 'lmr_1', expiresAt: 123456 });
  });

  it('returns null when no access token is stored', async () => {
    const store = createLmTokenStore(makeSecure());
    expect(await store.get()).toBeNull();
  });

  it('clear wipes every key and is idempotent', async () => {
    const secure = makeSecure();
    const store = createLmTokenStore(secure);
    await store.set({ accessToken: 'a', refreshToken: 'r', expiresAt: 1 });
    await store.clear();
    expect(secure.bag.size).toBe(0);
    expect(await store.get()).toBeNull();
    await expect(store.clear()).resolves.toBeUndefined();
  });
});

describe('memoryTokenStore', () => {
  it('behaves like the secure store for tests and fallbacks', async () => {
    const store = memoryTokenStore();
    expect(await store.get()).toBeNull();
    await store.set({ accessToken: 'a', refreshToken: 'r', expiresAt: 7 });
    expect(await store.get()).toEqual({ accessToken: 'a', refreshToken: 'r', expiresAt: 7 });
    await store.clear();
    expect(await store.get()).toBeNull();
  });
});

describe('lmPendingStore — PKCE verifier/state, lives only for the current demand', () => {
  it('round-trips through dedicated secure keys', async () => {
    const secure = makeSecure();
    const store = createLmPendingStore(secure);
    await store.set({ verifier: 'v'.repeat(43), state: 'st-1' });
    expect(secure.bag.get(LM_PKCE_KEYS.verifier)).toBe('v'.repeat(43));
    expect(secure.bag.get(LM_PKCE_KEYS.state)).toBe('st-1');
    expect(await store.get()).toEqual({ verifier: 'v'.repeat(43), state: 'st-1' });
  });

  it('returns null when nothing is pending and clears both keys', async () => {
    const secure = makeSecure();
    const store = createLmPendingStore(secure);
    expect(await store.get()).toBeNull();
    await store.set({ verifier: 'v', state: 's' });
    await store.clear();
    expect(secure.bag.size).toBe(0);
    expect(await store.get()).toBeNull();
  });
});
