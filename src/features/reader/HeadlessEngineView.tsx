import React, { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { buildEngineHtml } from '../../engine/engineHtml';
import { handleHeadlessRaw, registerHeadlessSender } from '../../core/reader/headlessEngine';

// Invisible WebView hosting the extraction engine (metadata + CBZ conversion).
// Mounted once at the root layout; communicates via the headlessEngine singleton.
// Hosted in a 1x1 opacity-0 view: a full-screen absoluteFill native view mounted
// before expo-router's screens container displaces the Stack on Android devices.
const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: 1,
    height: 1,
    opacity: 0,
    overflow: 'hidden',
  },
});

export function HeadlessEngineView() {
  const ref = useRef<WebView>(null);

  useEffect(() => {
    registerHeadlessSender((raw) => ref.current?.postMessage(raw));
    return () => { registerHeadlessSender(null); };
  }, []);

  const onMessage = (e: WebViewMessageEvent) => handleHeadlessRaw(e.nativeEvent.data);

  return (
    <View style={styles.host}>
      <WebView
        ref={ref}
        source={{ html: buildEngineHtml() }}
        originWhitelist={['*']}
        javaScriptEnabled
        setSupportMultipleWindows={false}
        onMessage={onMessage}
        pointerEvents="none"
        style={{ backgroundColor: 'transparent' }}
      />
    </View>
  );
}
