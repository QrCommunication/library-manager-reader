import React, { useEffect } from 'react';
import { StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore } from './toast';
import { themeTokens } from '../theme/tokens';

const TOAST_MS = 3000;

export function ToastHost() {
  const toast = useToastStore((s) => s.toast);
  const t0 = themeTokens(useColorScheme() === 'dark' ? 'night' : 'day');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => useToastStore.getState().clear(), TOAST_MS);
    return () => clearTimeout(timer);
  }, [toast?.id]);

  if (!toast) return null;
  const icon = toast.kind === 'success' ? 'checkmark-circle' : toast.kind === 'error' ? 'warning' : 'information-circle';
  const color = toast.kind === 'success' ? t0.accent : toast.kind === 'error' ? t0.danger : t0.foreground;
  return (
    <View pointerEvents="none" style={[styles.wrap, { bottom: 32 + insets.bottom }]}>
      <View style={[styles.pill, { backgroundColor: t0.chrome, borderColor: t0.border }]}>
        <Ionicons name={icon} size={18} color={color} />
        <Text numberOfLines={2} style={[styles.text, { color: t0.foreground }]}>{toast.message}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 24, right: 24, alignItems: 'center' },
  pill: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12,
    shadowColor: '#000000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 2 }, elevation: 4,
  },
  text: { flex: 1, fontSize: 14, fontWeight: '600' },
});
