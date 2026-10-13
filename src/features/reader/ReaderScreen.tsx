import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useServices } from '../../core/services';
import { useReaderSession } from './useReaderSession';
import { EngineWebView } from './EngineWebView';
import { ProgressSlider } from './ProgressSlider';
import type { ReaderBridge } from '../../core/reader/bridge';
import { themeTokens } from '../../theme/tokens';

export function ReaderScreen({ bookId }: { bookId: string }) {
  const { t } = useTranslation();
  const services = useServices();
  const router = useRouter();
  const { state, errorKind, title, fraction, bridge, retry } = useReaderSession(bookId);
  const [chromeVisible, setChromeVisible] = useState(false);

  if (state === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
        <Text>{t('reader.loading')}</Text>
      </View>
    );
  }

  if (state === 'error' || !bridge) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorText}>{errorKind === 'missing' ? t('reader.error.missing') : t('reader.error.open')}</Text>
        <Pressable style={styles.button} onPress={retry}>
          <Text>{t('common.retry')}</Text>
        </Pressable>
        <Pressable
          style={[styles.button, styles.deleteButton]}
          onPress={() => { void services.books.markDeleted(bookId, Date.now()).then(() => router.back()); }}
        >
          <Text>{t('common.delete')}</Text>
        </Pressable>
      </View>
    );
  }

  const reader = bridge as ReaderBridge;

  return (
    <View style={[styles.root, { backgroundColor: themeTokens('day').background }]}>
      <EngineWebView bridge={reader} onFatal={retry} />
      <View style={styles.overlay} pointerEvents="box-none">
        <Pressable style={styles.zoneSide} pointerEvents="box-only" onPress={() => reader.prev()} />
        <Pressable style={styles.zoneCenter} pointerEvents="box-only" onPress={() => setChromeVisible((v) => !v)} />
        <Pressable style={styles.zoneSide} pointerEvents="box-only" onPress={() => reader.next()} />
      </View>
      {chromeVisible ? (
        <>
          <View style={styles.topBar} pointerEvents="box-none">
            <Pressable onPress={() => router.back()} hitSlop={12}>
              <Text style={styles.chevron}>{'‹'}</Text>
            </Pressable>
            <Text style={styles.titleText} numberOfLines={1}>{title ?? ''}</Text>
            <View style={styles.barSpacer} />
          </View>
          <View style={styles.bottomBar}>
            <Text style={styles.percent}>{`${Math.round(fraction * 100)} %`}</Text>
            <ProgressSlider fraction={fraction} onScrub={(f) => reader.goToFraction(f)} />
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  errorText: { textAlign: 'center' },
  button: { borderWidth: 1, borderColor: '#2D6CDF', borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  deleteButton: { borderColor: '#C0392B' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, flexDirection: 'row' },
  zoneSide: { flex: 1 },
  zoneCenter: { flex: 2 },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 56,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 12,
    backgroundColor: '#FFFFFFEE',
  },
  chevron: { fontSize: 32, lineHeight: 36 },
  titleText: { flex: 1, fontSize: 16, fontWeight: '600' },
  barSpacer: { width: 32 },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
    backgroundColor: '#FFFFFFEE',
  },
  percent: { minWidth: 44, textAlign: 'right' },
});
