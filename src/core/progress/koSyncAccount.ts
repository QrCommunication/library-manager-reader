import { uuidV7 } from '../uuid';
import { createKoSyncClient, type KoSyncClient } from './koreaderSync';
import type { UiPrefs } from '../types';

export const KO_SYNC_DEVICE = 'Library Reader';

export function isKoSyncConfigured(prefs: UiPrefs): boolean {
  return prefs.koreaderUsername !== '' && prefs.koreaderUserkey !== '';
}

interface SettingsLike {
  getUiPrefs(): Promise<UiPrefs>;
  putUiPrefs(p: UiPrefs): Promise<void>;
}

export async function koSyncClientFromPrefs(
  settings: SettingsLike,
  newDeviceId: () => string = uuidV7,
  fetchImpl: typeof fetch = fetch,
): Promise<KoSyncClient> {
  const prefs = await settings.getUiPrefs();
  let { koreaderDeviceId: deviceId } = prefs;
  if (!deviceId) {
    deviceId = newDeviceId();
    await settings.putUiPrefs({ ...prefs, koreaderDeviceId: deviceId });
  }
  return createKoSyncClient(
    {
      baseUrl: prefs.koreaderServer,
      username: prefs.koreaderUsername,
      userkey: prefs.koreaderUserkey,
      device: KO_SYNC_DEVICE,
      deviceId,
    },
    fetchImpl,
  );
}
