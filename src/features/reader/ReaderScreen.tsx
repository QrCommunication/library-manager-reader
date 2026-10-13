import React, { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useServices } from '../../core/services';
import { useReaderSession } from './useReaderSession';
import { EngineWebView } from './EngineWebView';
import { ProgressSlider } from './ProgressSlider';
import { TocPanel } from './TocPanel';
import { BookmarksPanel } from './BookmarksPanel';
import { TypographyPanel } from './TypographyPanel';
import { useReaderSettingsStore } from '../settings/readerSettingsStore';
import type { ReaderBridge } from '../../core/reader/bridge';
import { themeTokens } from '../../theme/tokens';
import { useWindowLayout } from '../../ui/windowClasses';

type PanelName = 'toc' | 'bookmarks' | 'typography';

export function ReaderScreen({ bookId }: { bookId: string }) {
  const { t } = useTranslation();
  const services = useServices();
  const router = useRouter();
  const { settings, update } = useReaderSettingsStore();
  const { state, errorKind, title, fraction, toc, bridge, retry } = useReaderSession(bookId);
  const { panel: panelSurface } = useWindowLayout();
  const sideDrawer = panelSurface === 'side';
  const [chromeVisible, setChromeVisible] = useState(false);
  const [panel, setPanel] = useState<PanelName | null>(null);
  const closePanel = () => setPanel(null);

  // Non-ready layouts keep the engine WebView mounted whenever a bridge exists
  // (loading AND error states): the engine's engineReady announcement can only
  // arrive through the WebView's onMessage, so unmounting the WebView while
  // waiting for it deadlocks the ready-gate on a real device.
  if (state !== 'ready' || !bridge) {
    const pending = bridge as ReaderBridge | null;
    return (
      <View style={styles.root}>
        {pending ? <EngineWebView bridge={pending} onFatal={retry} onReload={retry} /> : null}
        <View style={styles.center}>
          {state === 'error' ? (
            <>
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
            </>
          ) : (
            <>
              <ActivityIndicator />
              <Text>{t('reader.loading')}</Text>
            </>
          )}
        </View>
      </View>
    );
  }

  const reader = bridge as ReaderBridge;
  const navigateFromPanel = (target: string) => { closePanel(); reader.goTo(target); };

  return (
    <View style={[styles.root, { backgroundColor: themeTokens(settings.theme).background }]}>
      <EngineWebView bridge={reader} onFatal={retry} onReload={retry} />
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
            <View style={styles.barToggles}>
              <Pressable hitSlop={8} onPress={() => setPanel('toc')} accessibilityLabel={t('reader.toc')}>
                <Text style={styles.barGlyph}>{'☰'}</Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={() => setPanel('bookmarks')} accessibilityLabel={t('reader.bookmarks')}>
                <Text style={styles.barGlyph}>{'⚑'}</Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={() => setPanel('typography')} accessibilityLabel={t('reader.typography')}>
                <Text style={styles.barGlyph}>{'Aa'}</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.bottomBar}>
            <Text style={styles.percent}>{`${Math.round(fraction * 100)} %`}</Text>
            <ProgressSlider fraction={fraction} onScrub={(f) => reader.goToFraction(f)} />
          </View>
        </>
      ) : null}
      {panel ? (
        <Modal transparent visible animationType="slide" onRequestClose={closePanel}>
          <View style={[styles.backdrop, sideDrawer && styles.backdropSide]}>
            <Pressable style={styles.backdropPress} onPress={closePanel} accessibilityLabel={t('common.cancel')} />
            <View style={[styles.drawer, sideDrawer ? styles.drawerSide : styles.drawerBottom]}>
              {panel === 'toc' ? <TocPanel toc={toc} onNavigate={navigateFromPanel} /> : null}
              {panel === 'bookmarks' ? (
                <BookmarksPanel bookId={bookId} bridge={reader} onNavigate={navigateFromPanel} />
              ) : null}
              {panel === 'typography' ? (
                <TypographyPanel
                  settings={settings}
                  onSettingsChange={(next) => { void update(next); reader.applySettings(next); }}
                />
              ) : null}
            </View>
          </View>
        </Modal>
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
  barToggles: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  barGlyph: { fontSize: 18, lineHeight: 22, fontWeight: '600' },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12,
    backgroundColor: '#FFFFFFEE',
  },
  percent: { minWidth: 44, textAlign: 'right' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000055' },
  backdropSide: { flexDirection: 'row', justifyContent: 'flex-end' },
  backdropPress: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  drawer: {
    backgroundColor: '#FFFFFF',
    paddingTop: 8, paddingBottom: 16, minHeight: 120,
  },
  drawerBottom: {
    maxHeight: '70%',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
  },
  drawerSide: {
    width: 400, maxWidth: '85%', height: '100%',
    borderTopLeftRadius: 16, borderBottomLeftRadius: 16,
  },
});
