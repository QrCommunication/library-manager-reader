import { koSyncClientFromPrefs, isKoSyncConfigured, KO_SYNC_DEVICE } from '../koSyncAccount';
import { DEFAULT_UI_PREFS } from '../../types';

const makeSettings = () => {
  let prefs = { ...DEFAULT_UI_PREFS };
  const saved: UiPrefsShape[] = [];
  return {
    saved,
    get: () => prefs,
    settings: {
      getUiPrefs: async () => prefs,
      putUiPrefs: async (p: UiPrefsShape) => { saved.push(p); prefs = p; },
    },
  };
};
type UiPrefsShape = typeof DEFAULT_UI_PREFS;

describe('koSyncAccount', () => {
  it('generates and persists a device id on first use, then reuses it', async () => {
    const { settings, saved, get } = makeSettings();
    let n = 0;
    const first = await koSyncClientFromPrefs(settings, () => `dev-${++n}`);
    expect(saved).toHaveLength(1);
    expect(get().koreaderDeviceId).toBe('dev-1');
    await koSyncClientFromPrefs(settings, () => `dev-${++n}`);
    expect(saved).toHaveLength(1); // no second write
    expect(get().koreaderDeviceId).toBe('dev-1');
    expect(first).toBeTruthy();
  });

  it('builds the client from the stored account fields with the app device name', async () => {
    const { settings } = makeSettings();
    await settings.putUiPrefs({ ...DEFAULT_UI_PREFS, koreaderServer: 'https://kosync.local:8080', koreaderUsername: 'benoit', koreaderUserkey: 'k3y', koreaderDeviceId: 'dev-9' });
    // observable through the request it makes
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(null, { status: 200 });
    }) as typeof fetch;
    const client = await koSyncClientFromPrefs(settings, () => 'unused', fetchImpl);
    expect(await client.authorize()).toBe(true);
    expect(calls[0]!.url).toBe('https://kosync.local:8080/users/auth');
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers['x-auth-user']).toBe('benoit');
    expect(headers['x-auth-key']).toBe('k3y');
  });

  it('isKoSyncConfigured requires both username and userkey', () => {
    expect(isKoSyncConfigured(DEFAULT_UI_PREFS)).toBe(false);
    expect(isKoSyncConfigured({ ...DEFAULT_UI_PREFS, koreaderUsername: 'b', koreaderUserkey: 'k' })).toBe(true);
    expect(KO_SYNC_DEVICE).toBe('Library Reader');
  });
});
