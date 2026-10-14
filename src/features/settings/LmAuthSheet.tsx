// In-app authorization sheet for library-manager.com. The server's callback
// page renders JSON instead of bouncing through verified App Links, so the
// system-browser session never hands control back — a WebView we own watches
// the navigation and intercepts the callback URL (code+state ride the query,
// the PKCE verifier never leaves the secure store).

import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import WebView from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { LM_REDIRECT_URI } from '../../core/remote/lmPkce';
import { themeTokens } from '../../theme/tokens';

interface Props {
  visible: boolean;
  url: string;
  onClose(): void;
  onComplete(callbackUrl: string): void;
}

export function LmAuthSheet({ visible, url, onClose, onComplete }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const t0 = themeTokens('day');

  if (!visible) return null;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={[styles.root, { backgroundColor: t0.background, paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Pressable onPress={onClose} accessibilityLabel={t('settings.lm.close')} hitSlop={10}>
            <Ionicons name="close" size={24} color={t0.foreground} />
          </Pressable>
          <Text numberOfLines={1} style={[styles.title, { color: t0.foreground }]}>{t('settings.lm.title')}</Text>
          <View style={styles.spacer} />
        </View>
        <WebView
          source={{ uri: url }}
          onShouldStartLoadWithRequest={(req) => {
            if (req.url.startsWith(LM_REDIRECT_URI)) {
              onComplete(req.url);
              return false;
            }
            return true;
          }}
          style={{ backgroundColor: t0.background }}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  title: { flex: 1, fontSize: 16, fontWeight: '700' },
  spacer: { width: 24 },
});
