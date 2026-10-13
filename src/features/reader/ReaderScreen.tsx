import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as ExpoSpeech from 'expo-speech';
import { useServices } from '../../core/services';
import { createExpoSpeechService } from '../../core/speech/speechService';
import { useReaderSession } from './useReaderSession';
import { EngineWebView } from './EngineWebView';
import { ProgressSlider } from './ProgressSlider';
import { TocPanel } from './TocPanel';
import { BookmarksPanel } from './BookmarksPanel';
import { AnnotationsPanel } from './AnnotationsPanel';
import { TypographyPanel } from './TypographyPanel';
import { SearchPanel } from './SearchPanel';
import { SelectionPopover, type SelectionState } from './SelectionPopover';
import { DefinitionSheet } from './DefinitionSheet';
import { TtsBar } from './TtsBar';
import { useReaderSettingsStore } from '../settings/readerSettingsStore';
import type { ReaderBridge } from '../../core/reader/bridge';
import { uuidV7 } from '../../core/uuid';
import { themeTokens } from '../../theme/tokens';
import { useWindowLayout } from '../../ui/windowClasses';

type PanelName = 'toc' | 'bookmarks' | 'typography' | 'annotations' | 'search';

// One app-wide instance: expo-speech owns a global utterance queue, and a
// module-level service keeps a live TTS stream stable across bar re-renders.
const speechService = createExpoSpeechService(ExpoSpeech);

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
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [highlightMode, setHighlightMode] = useState(false);
  const [sheet, setSheet] = useState<{ word: string; lang: string | null; mode: 'define' | 'translate' } | null>(null);
  const [ttsActive, setTtsActive] = useState(false);
  const [follow, setFollow] = useState(false);
  // bumped on every USER navigation: mid-TTS the engine tears its stream down
  // silently, so TtsBar must treat this as stream end (follow's own goTo never
  // bumps it)
  const [navigationKey, setNavigationKey] = useState(0);
  const noteNavigation = () => setNavigationKey((k) => k + 1);

  // The anchored bubble lives only as long as the engine selection does; each
  // new selectionChanged restarts from the plain actions (never a stale color
  // row).
  useEffect(() => {
    if (!bridge) return;
    return bridge.onSelectionChanged((s) => {
      setSelection(s.text && s.rect ? { text: s.text, rect: s.rect, cfi: s.cfi, lang: s.lang } : null);
      setHighlightMode(false);
    });
  }, [bridge]);

  // clearing on position change must not wait for an effect tick (stale
  // popovers must not survive a page turn) — render-time adjustment, the same
  // pattern as useReaderSession's session key
  const [seenFraction, setSeenFraction] = useState(fraction);
  if (seenFraction !== fraction) {
    setSeenFraction(fraction);
    setSelection(null);
  }

  // replay persisted highlights once the session is ready (engine overlays do
  // not survive a page reload; the engine re-adds per section on relocate)
  useEffect(() => {
    if (state !== 'ready' || !bridge) return;
    let cancelled = false;
    void (async () => {
      const list = await services.annotations.listByBook(bookId);
      if (cancelled) return;
      for (const a of list) bridge.addHighlight(a.id, a.cfi, a.color);
    })();
    return () => { cancelled = true; };
  }, [state, bridge, bookId, services]);

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
  const navigateFromPanel = (target: string) => { closePanel(); noteNavigation(); reader.goTo(target); };

  return (
    <View style={[styles.root, { backgroundColor: themeTokens(settings.theme).background }]}>
      <EngineWebView bridge={reader} onFatal={retry} onReload={retry} />
      <View style={styles.overlay} pointerEvents="box-none">
        <Pressable style={styles.zoneSide} pointerEvents="box-only" onPress={() => { noteNavigation(); reader.prev(); }} />
        <Pressable style={styles.zoneCenter} pointerEvents="box-only" onPress={() => setChromeVisible((v) => !v)} />
        <Pressable style={styles.zoneSide} pointerEvents="box-only" onPress={() => { noteNavigation(); reader.next(); }} />
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
              <Pressable hitSlop={8} onPress={() => setPanel('annotations')} accessibilityLabel={t('annotations.title')}>
                <Text style={styles.barGlyph}>{'✎'}</Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={() => setPanel('search')} accessibilityLabel={t('search.title')}>
                <Text style={styles.barGlyph}>{'⌕'}</Text>
              </Pressable>
              <Pressable hitSlop={8} onPress={() => setTtsActive((v) => !v)} accessibilityLabel={t('reader.tts')}>
                <Text style={styles.barGlyph}>{'♪'}</Text>
              </Pressable>
            </View>
          </View>
          <View style={styles.bottomBar}>
            <Text style={styles.percent}>{`${Math.round(fraction * 100)} %`}</Text>
            <ProgressSlider fraction={fraction} onScrub={(f) => { noteNavigation(); reader.goToFraction(f); }} />
          </View>
        </>
      ) : null}
      {ttsActive ? (
        <TtsBar
          bridge={reader}
          speech={speechService}
          rate={settings.ttsRate}
          onRateChange={(r) => { void update({ ttsRate: r }); }}
          // book language: engine metadata is not surfaced into ReaderScreen
          // state (brief ruling) — TtsBar falls back to en-US via BCP-47 helper
          bookLang={null}
          // brief ruling: start position = current view → ttsStart(null)
          onStart={() => reader.ttsStart(null)}
          follow={follow}
          onFollowChange={setFollow}
          navigationKey={navigationKey}
        />
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
              {panel === 'annotations' ? (
                <AnnotationsPanel bookId={bookId} bridge={reader} onNavigate={navigateFromPanel} />
              ) : null}
              {panel === 'typography' ? (
                <TypographyPanel
                  settings={settings}
                  onSettingsChange={(next) => { void update(next); reader.applySettings(next); }}
                />
              ) : null}
              {panel === 'search' ? <SearchPanel bridge={reader} onNavigate={navigateFromPanel} /> : null}
            </View>
          </View>
        </Modal>
      ) : null}
      {selection ? (
        <SelectionPopover
          selection={selection}
          highlightMode={highlightMode}
          onHighlightPress={() => setHighlightMode(true)}
          onHighlight={(color) => {
            const sel = selection;
            if (sel.cfi) {
              void services.annotations.add({
                id: uuidV7(), bookId, cfi: sel.cfi, color, note: null, excerpt: sel.text, createdAt: Date.now(),
              }).then((a) => { reader.addHighlight(a.id, a.cfi, color); });
            }
            setSelection(null);
            setHighlightMode(false);
          }}
          onDefine={() => { setSheet({ word: selection.text, lang: selection.lang ?? null, mode: 'define' }); setSelection(null); }}
          onTranslate={() => { setSheet({ word: selection.text, lang: selection.lang ?? null, mode: 'translate' }); setSelection(null); }}
          onCopy={() => { reader.copySelection(); setSelection(null); }}
          onDismiss={() => { setSelection(null); setHighlightMode(false); }}
        />
      ) : null}
      {sheet ? (
        <DefinitionSheet
          // fresh mount per selection: no stale results carried across lookups
          key={`${sheet.word}|${sheet.lang ?? ''}|${sheet.mode}`}
          word={sheet.word}
          lang={sheet.lang}
          initialMode={sheet.mode}
          onClose={() => setSheet(null)}
        />
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
