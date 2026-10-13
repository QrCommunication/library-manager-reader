import React, { useEffect, useRef } from 'react';
import { StyleSheet } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildEngineHtml } from '../../engine/engineHtml';
import { handleHeadlessRaw, registerHeadlessSender } from '../../core/reader/headlessEngine';

// Invisible WebView hosting the extraction engine (metadata + CBZ conversion).
// Mounted once at the root layout; communicates via the headlessEngine singleton.
export function HeadlessEngineView() {
  const ref = useRef<WebView>(null);

  useEffect(() => {
    registerHeadlessSender((raw) => ref.current?.postMessage(raw));
    return () => { registerHeadlessSender(null); };
  }, []);

  const onMessage = (e: WebViewMessageEvent) => handleHeadlessRaw(e.nativeEvent.data);

  return (
    <WebView
      ref={ref}
      source={{ html: buildEngineHtml() }}
      originWhitelist={['*']}
      javaScriptEnabled
      setSupportMultipleWindows={false}
      onMessage={onMessage}
      pointerEvents="none"
      style={[StyleSheet.absoluteFill, { backgroundColor: 'transparent' }]}
    />
  );
}
