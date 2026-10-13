import { create } from 'zustand';
import type { AppServices } from '../../core/services';
import { DEFAULT_UI_PREFS, type UiPrefs } from '../../core/types';

let servicesRef: AppServices | null = null;
export function setServices(s: AppServices) { servicesRef = s; }

export function createUiPrefsStore(getServices: () => AppServices) {
  return create<{
    prefs: UiPrefs; hydrated: boolean;
    hydrate(): Promise<void>; update(partial: Partial<UiPrefs>): Promise<void>;
  }>()((set, get) => ({
    prefs: DEFAULT_UI_PREFS,
    hydrated: false,
    hydrate: async () => {
      const prefs = await getServices().settings.getUiPrefs();
      set({ prefs, hydrated: true });
    },
    update: async (partial) => {
      const next = { ...get().prefs, ...partial };
      set({ prefs: next });
      await getServices().settings.putUiPrefs(next);
    },
  }));
}

export const useUiPrefsStore = createUiPrefsStore(() => {
  if (!servicesRef) throw new Error('ServicesProvider missing');
  return servicesRef;
});
