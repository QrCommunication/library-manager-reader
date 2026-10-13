import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { initI18n } from '../src/i18n';
import { createExpoDriver } from '../src/db/expoDriver';
import { migrate } from '../src/db/migrate';
import type { DbDriver } from '../src/db/driver';
import { createServices, ServicesProvider, type AppServices } from '../src/core/services';
import { createExpoFsAdapter, documentRoot } from '../src/core/storage/expoFsAdapter';
import { uuidV7 } from '../src/core/uuid';

let db: DbDriver | null = null;
let services: AppServices | null = null;

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void (async () => {
      db = createExpoDriver();
      await migrate(db);
      services = createServices({ db, fs: createExpoFsAdapter(), root: documentRoot(), newId: uuidV7 });
      await initI18n('auto');
      setReady(true);
    })();
  }, []);
  if (!ready || !services) return null;
  return (
    <ServicesProvider value={services}>
      <Stack />
    </ServicesProvider>
  );
}
