import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildEngineHtml } from '../../engine/engineHtml';
import { bridgeTarget } from './useReaderSession';
import type { ReaderBridge } from '../../core/reader/bridge';

// topInset reserves the status-bar height above the engine viewport. It is set
// at mount and never changes mid-session: resizing the paginator host while
// reading loses the page (see engine.ts applySettings), so the inset must not
// be applied as a live style update.
export function EngineWebView({ bridge, onFatal, onReload, topInset = 0 }: { bridge: ReaderBridge; onFatal(): void; onReload(): void; topInset?: number }) {
  const ref = useRef<WebView>(null);
  const reloads = useRef(0);

  useEffect(() => {
    bridgeTarget.current = (raw: string) => ref.current?.postMessage(raw);
    return () => { bridgeTarget.current = () => {}; };
  }, []);

  const onMessage = (e: WebViewMessageEvent) => bridge.handleRaw(e.nativeEvent.data);
  // WebViewRenderProcessGoneEvent isn't exported by react-native-webview's typings,
  // so the handler takes no argument; it fits both onRenderProcessGone and onError.
  const onGone = () => {
    if (reloads.current < 1) { reloads.current += 1; ref.current?.reload(); onReload(); }
    else onFatal();
  };

  return (
    <View testID="engine-root" style={[StyleSheet.absoluteFill, { top: topInset }]}>
      <WebView
        ref={ref}
        // baseUrl gives the engine document a real origin: from about:blank
        // (opaque origin) foliate's section blob: iframes crash WebView 154+
        // renderers on device (CHECK in libwebviewchromium, crash loop)
        source={{ html: buildEngineHtml(), baseUrl: 'https://localhost/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        setSupportMultipleWindows={false}
        // Android: an empty custom menu REPLACES the system selection action
        // mode (contextMenuHidden was removed in react-native-webview 13) —
        // selection still works in the engine, only the app's SelectionPopover
        // (Définir/Traduire/Copier/Surligner) shows
        menuItems={[]}
        onMessage={onMessage}
        onRenderProcessGone={onGone}
        onError={onGone}
        // only the engine document may load: the html is memory-backed (baseUrl
        // https://localhost is never fetched) and engine-internal content uses
        // data:/blob: URIs — anything else is a book link trying to navigate
        // the webview away
        onShouldStartLoadWithRequest={(request) =>
          request.url.startsWith('about:') || request.url.startsWith('data:') || request.url.startsWith('blob:')}
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
