// Real LmSecureStore over expo-secure-store (iOS Keychain / Android Keystore)
// plus the account-deps assembly used by the UI screens (spec §10: tokens and
// the PKCE demand never leave the secure storage).

import * as SecureStore from 'expo-secure-store';
import type { LmAccountDeps } from '../remote/lmAccount';
import { createLmPendingStore, createLmTokenStore, type LmSecureStore } from '../remote/lmTokens';

const secure: LmSecureStore = {
  getItemAsync: (key) => SecureStore.getItemAsync(key),
  setItemAsync: (key, value) => SecureStore.setItemAsync(key, value),
  deleteItemAsync: (key) => SecureStore.deleteItemAsync(key),
};

export function createLmAccountDeps(settings: LmAccountDeps['settings']): LmAccountDeps {
  return { settings, tokens: createLmTokenStore(secure), pending: createLmPendingStore(secure) };
}
