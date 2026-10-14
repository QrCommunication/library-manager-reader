// Global test setup: safe-area insets come from the native layer, absent in
// the test renderer — provide zeroed insets so screens using useSafeAreaInsets
// render without a SafeAreaProvider.
jest.mock('react-native-safe-area-context', () => {
  const inset = { top: 0, right: 0, bottom: 0, left: 0 };
  return {
    __esModule: true,
    SafeAreaProvider: ({ children }: { children?: React.ReactNode }) => children ?? null,
    SafeAreaView: ({ children }: { children?: React.ReactNode }) => children ?? null,
    useSafeAreaInsets: () => inset,
    initialWindowMetrics: {
      frame: { x: 0, y: 0, width: 0, height: 0 },
      insets: inset,
    },
  };
});

// Keychain/Keystore stand-in: the real module is native-only, so screens under
// test get a deterministic in-memory secure store. Per-file mocks (core tests)
// override this one.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __esModule: true,
    getItemAsync: async (key: string) => store.get(key) ?? null,
    setItemAsync: async (key: string, value: string) => { store.set(key, value); },
    deleteItemAsync: async (key: string) => { store.delete(key); },
    __store: store,
  };
});
