import { create } from 'zustand';
import type { AppServices } from '../../core/services';
import { DEFAULT_READER_SETTINGS, type ReaderSettings } from '../../core/types';

let servicesRef: AppServices | null = null;
export function setServices(s: AppServices) { servicesRef = s; }

export function createReaderSettingsStore(getServices: () => AppServices) {
  return create<{
    settings: ReaderSettings; hydrated: boolean;
    hydrate(): Promise<void>; update(partial: Partial<ReaderSettings>): Promise<void>;
  }>()((set, get) => ({
    settings: DEFAULT_READER_SETTINGS,
    hydrated: false,
    hydrate: async () => {
      const settings = await getServices().settings.getReaderSettings();
      set({ settings, hydrated: true });
    },
    update: async (partial) => {
      const next = { ...get().settings, ...partial };
      set({ settings: next });
      await getServices().settings.putReaderSettings(next);
    },
  }));
}

export const useReaderSettingsStore = createReaderSettingsStore(() => {
  if (!servicesRef) throw new Error('ServicesProvider missing');
  return servicesRef;
});
