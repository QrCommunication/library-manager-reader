import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StatusBar, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ExpoSpeech from 'expo-speech';
import { useServices } from '../../core/services';
import { createExpoSpeechService } from '../../core/speech/speechService';
import { useReaderSession } from './useReaderSession';
import { useReadingSync } from './useReadingSync';
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
import { resolveTheme } from '../../core/types';
import type { ReaderBridge } from '../../core/reader/bridge';
import { uuidV7 } from '../../core/uuid';
import { themeTokens } from '../../theme/tokens';
import { ReaderThemeProvider } from '../../theme/context';
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
  const { state, errorKind, title, language, fraction, toc, bridge, retry } = useReaderSession(bookId);
  // Library Manager: explicit conflicts + re-read on return to the foreground
  useReadingSync(services, bookId, bridge, state === 'ready', title);
  const scheme = useColorScheme();
  // react-native reports 'unspecified' when the scheme is undetermined:
  // normalize to null so resolveTheme keeps its light/dark/null signature
  const systemScheme: 'light' | 'dark' | null = scheme === 'light' || scheme === 'dark' ? scheme : null;
  const insets = useSafeAreaInsets();
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
    // the engine reports selection coords relative to the WebView, which sits
    // below the status bar — the popover is positioned in root coords
    return bridge.onSelectionChanged((s) => {
      if (s.text && s.rect) setSelection({ text: s.text, rect: { ...s.rect, y: s.rect.y + insets.top }, cfi: s.cfi, lang: s.lang });
      else setSelection(null);
      setHighlightMode(false);
    });
  }, [bridge, insets.top]);

  // Chrome toggling comes from the engine document (middle-third tap): the RN
  // tap zones were removed because they blocked native text selection.
  useEffect(() => {
    if (!bridge) return;
    return bridge.onChromeToggle(() => setChromeVisible((v) => !v));
  }, [bridge]);

  // top-center engine tap zone: immersive mode has no visible chrome, so the
  // engine asks the app to surface the reading settings directly
  useEffect(() => {
    if (!bridge) return;
    return bridge.onOpenSettings(() => { setChromeVisible(true); setPanel('typography'); });
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

  // re-apply RESOLVED settings whenever the session becomes ready, a setting
  // changes or the system scheme flips: theme 'auto' follows dark mode while
  // reading (useReaderSession resolved only at open time). Resolving here keeps
  // 'auto' out of the engine, which only knows concrete themes.
  useEffect(() => {
    if (state !== 'ready' || !bridge) return;
    (bridge as ReaderBridge).applySettings({ ...settings, theme: resolveTheme(settings.theme, systemScheme) });
  }, [state, bridge, settings, systemScheme]);

  // All reader chrome (bars, drawers, popover, sheets) follows the RESOLVED
  // reader theme — never the system scheme — so a night session never pops
  // white chrome. The provider carries it to panel components.
  const resolvedTheme = resolveTheme(settings.theme, systemScheme);
  const rt = themeTokens(resolvedTheme);

  // Non-ready layouts keep the engine WebView mounted whenever a bridge exists
  // (loading AND error states): the engine's engineReady announcement can only
  // arrive through the WebView's onMessage, so unmounting the WebView while
  // waiting for it deadlocks the ready-gate on a real device.
  if (state !== 'ready' || !bridge) {
    const pending = bridge as ReaderBridge | null;
    return (
      <ReaderThemeProvider value={rt}>
        <View style={[styles.root, { backgroundColor: rt.background }]}>
          <StatusBar barStyle={resolvedTheme === 'night' ? 'light-content' : 'dark-content'} />
          {pending ? <EngineWebView bridge={pending} onFatal={retry} onReload={retry} topInset={insets.top} /> : null}
          <View style={styles.center}>
            {state === 'error' ? (
              <>
                <Text style={[styles.errorText, { color: rt.foreground }]}>{errorKind === 'missing' ? t('reader.error.missing') : t('reader.error.open')}</Text>
                <Pressable style={[styles.button, { borderColor: rt.accent }]} onPress={retry}>
                  <Text style={{ color: rt.foreground }}>{t('common.retry')}</Text>
                </Pressable>
                <Pressable
                  style={[styles.button, { borderColor: rt.danger }]}
                  onPress={() => { void services.books.markDeleted(bookId, Date.now()).then(() => router.back()); }}
                >
                  <Text style={{ color: rt.foreground }}>{t('common.delete')}</Text>
                </Pressable>
              </>
            ) : (
              <>
                <ActivityIndicator color={rt.accent} />
                <Text style={{ color: rt.foreground }}>{t('reader.loading')}</Text>
              </>
            )}
          </View>
        </View>
      </ReaderThemeProvider>
    );
  }

  const reader = bridge as ReaderBridge;
  const navigateFromPanel = (target: string) => { closePanel(); noteNavigation(); reader.goTo(target); };

  return (
    <ReaderThemeProvider value={rt}>
      <View style={[styles.root, { backgroundColor: rt.background }]}>
        <StatusBar barStyle={resolvedTheme === 'night' ? 'light-content' : 'dark-content'} />
        <EngineWebView bridge={reader} onFatal={retry} onReload={retry} topInset={insets.top} />
        {settings.brightness > 0 ? (
          // brightness dimming: full-screen black veil ABOVE the engine content,
          // BELOW the chrome — never intercepts touches (page taps are handled
          // inside the engine document)
          <View pointerEvents="none" style={[styles.brightness, { opacity: settings.brightness / 100 }]} />
        ) : null}
        {chromeVisible ? (
          <>
            <View
              style={[styles.topBar, {
                backgroundColor: rt.chrome,
                paddingTop: insets.top,
                height: 56 + insets.top,
                borderBottomColor: rt.border,
              }]}
              pointerEvents="box-none"
            >
              <Pressable onPress={() => router.back()} hitSlop={12} accessibilityLabel={t('common.cancel')}>
                <Ionicons name="chevron-back" size={26} color={rt.foreground} />
              </Pressable>
              <Text style={[styles.titleText, { color: rt.foreground }]} numberOfLines={1}>{title ?? ''}</Text>
              <View style={styles.barToggles}>
                <Pressable hitSlop={8} onPress={() => setPanel('toc')} accessibilityLabel={t('reader.toc')}>
                  <Ionicons name="list-outline" size={22} color={rt.foreground} />
                </Pressable>
                <Pressable hitSlop={8} onPress={() => setPanel('bookmarks')} accessibilityLabel={t('reader.bookmarks')}>
                  <Ionicons name="bookmark-outline" size={22} color={rt.foreground} />
                </Pressable>
                <Pressable hitSlop={8} onPress={() => setPanel('typography')} accessibilityLabel={t('reader.typography')}>
                  <Text style={[styles.aaGlyph, { color: rt.foreground }]}>{'Aa'}</Text>
                </Pressable>
                <Pressable hitSlop={8} onPress={() => setPanel('annotations')} accessibilityLabel={t('annotations.title')}>
                  <Ionicons name="create-outline" size={22} color={rt.foreground} />
                </Pressable>
                <Pressable hitSlop={8} onPress={() => setPanel('search')} accessibilityLabel={t('search.title')}>
                  <Ionicons name="search-outline" size={22} color={rt.foreground} />
                </Pressable>
                <Pressable hitSlop={8} onPress={() => setTtsActive((v) => !v)} accessibilityLabel={t('reader.tts')}>
                  <Ionicons name="volume-medium-outline" size={22} color={rt.foreground} />
                </Pressable>
              </View>
            </View>
            <View
              style={[styles.bottomBar, {
                backgroundColor: rt.chrome,
                paddingBottom: 12 + insets.bottom,
                borderTopColor: rt.border,
              }]}
            >
              <Text style={[styles.percent, { color: rt.foreground }]}>{`${Math.round(fraction * 100)} %`}</Text>
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
            // book language from the engine metadata: expo-speech picks a
            // matching voice (TtsBar maps 'fr' → 'fr-FR' etc., falls back en-US)
            bookLang={language}
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
              <View testID="reader-drawer" style={[styles.drawer, { backgroundColor: rt.chrome }, sideDrawer ? styles.drawerSide : styles.drawerBottom]}>
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
                    onSettingsChange={(next) => { void update(next); reader.applySettings({ ...next, theme: resolveTheme(next.theme, systemScheme) }); }}
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
    </ReaderThemeProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24 },
  errorText: { textAlign: 'center' },
  button: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 20, paddingVertical: 10 },
  brightness: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#000' },
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  titleText: { flex: 1, fontSize: 16, fontWeight: '600' },
  barToggles: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  aaGlyph: { fontSize: 16, lineHeight: 22, fontWeight: '700' },
  bottomBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 12, paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  percent: { minWidth: 44, textAlign: 'right' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#00000055' },
  backdropSide: { flexDirection: 'row', justifyContent: 'flex-end' },
  backdropPress: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  drawer: {
    paddingTop: 8, paddingBottom: 16, minHeight: 120,
  },
  drawerBottom: {
    // explicit height: the panels are flex:1 ScrollViews, which collapse to
    // minHeight in an auto-height parent — the "tiny panel" phone bug
    height: '65%',
    maxHeight: '70%',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
  },
  drawerSide: {
    width: 400, maxWidth: '85%', height: '100%',
    borderTopLeftRadius: 16, borderBottomLeftRadius: 16,
  },
});
