import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { initI18n } from '../src/i18n';
import { createAppServices } from '../src/core/startup';
import { ServicesProvider, type AppServices } from '../src/core/services';
import { setServices as setUiPrefsServices, useUiPrefsStore } from '../src/features/settings/uiPrefsStore';
import { setServices as setReaderSettingsServices, useReaderSettingsStore } from '../src/features/settings/readerSettingsStore';
import { initHeadlessEngine } from '../src/core/reader/headlessEngine';
import { HeadlessEngineView } from '../src/features/reader/HeadlessEngineView';

export default function RootLayout() {
  const [services, setServicesState] = useState<AppServices | null>(null);
  useEffect(() => {
    void (async () => {
      const s = await createAppServices();
      setUiPrefsServices(s); // closes the Task 10 deferred wiring
      setReaderSettingsServices(s); // both stores share the services singleton
      initHeadlessEngine(s.fs);
      await useUiPrefsStore.getState().hydrate();
      await useReaderSettingsStore.getState().hydrate();
      await initI18n(useUiPrefsStore.getState().prefs.language);
      setServicesState(s);
    })();
  }, []);
  if (!services) return null;
  return (
    <ServicesProvider value={services}>
      <HeadlessEngineView />
      <Stack />
    </ServicesProvider>
  );
}
