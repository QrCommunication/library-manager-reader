import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildEngineHtml } from '../../engine/engineHtml';
import { bridgeTarget } from './useReaderSession';
import type { ReaderBridge } from '../../core/reader/bridge';

export function EngineWebView({ bridge, onFatal, onReload }: { bridge: ReaderBridge; onFatal(): void; onReload(): void }) {
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
    <View style={StyleSheet.absoluteFill}>
      <WebView
        ref={ref}
        source={{ html: buildEngineHtml() }}
        originWhitelist={['*']}
        javaScriptEnabled
        setSupportMultipleWindows={false}
        onMessage={onMessage}
        onRenderProcessGone={onGone}
        onError={onGone}
        // only the engine document may load: the html has no base URL (about:blank)
        // and engine-internal content uses data:/blob: URIs — anything else is a
        // book link trying to navigate the webview away
        onShouldStartLoadWithRequest={(request) =>
          request.url.startsWith('about:') || request.url.startsWith('data:') || request.url.startsWith('blob:')}
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
