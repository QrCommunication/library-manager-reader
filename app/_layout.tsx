import { Stack } from 'expo-router';
import { useEffect, useState } from 'react';
import { initI18n } from '../src/i18n';

export default function RootLayout() {
  const [ready, setReady] = useState(false);
  useEffect(() => { initI18n('auto').then(() => setReady(true)); }, []);
  if (!ready) return null;
  return <Stack />;
}
