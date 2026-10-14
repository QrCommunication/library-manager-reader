import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDialogStore, type DialogButton } from './dialogs';
import { themeTokens } from '../theme/tokens';

export function DialogHost() {
  const request = useDialogStore((s) => s.request);
  const t0 = themeTokens(useColorScheme() === 'dark' ? 'night' : 'day');
  const insets = useSafeAreaInsets();
  if (!request) return null;
  const close = (button?: DialogButton) => {
    useDialogStore.getState().clear();
    button?.onPress?.();
  };
  const cancel = request.buttons.find((b) => b.style === 'cancel');
  return (
    <Modal transparent animationType="fade" onRequestClose={() => close(cancel)}>
      <Pressable style={[styles.backdrop, { paddingTop: insets.top, paddingBottom: insets.bottom }]} onPress={() => close(cancel)}>
        <Pressable style={[styles.card, { backgroundColor: t0.chrome }]} onPress={() => { /* swallow: only the backdrop dismisses */ }}>
          {request.title ? <Text style={[styles.title, { color: t0.foreground }]}>{request.title}</Text> : null}
          {request.message ? <Text style={[styles.message, { color: t0.muted }]}>{request.message}</Text> : null}
          <View style={styles.buttons}>
            {request.buttons.map((button) => (
              <Pressable
                key={button.text}
                style={[styles.button, { borderColor: t0.border }, button.style === 'destructive' && { borderColor: t0.danger }]}
                onPress={() => close(button)}
                accessibilityRole="button"
                accessibilityLabel={button.text}
              >
                <Text
                  style={[
                    styles.buttonText,
                    { color: button.style === 'destructive' ? t0.danger : t0.accent },
                    button.style === 'cancel' && { color: t0.muted },
                  ]}
                >
                  {button.text}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000099', alignItems: 'center', justifyContent: 'center', padding: 32 },
  card: { width: '100%', maxWidth: 420, borderRadius: 18, paddingHorizontal: 20, paddingTop: 20, paddingBottom: 16, gap: 10 },
  title: { fontSize: 18, fontWeight: '700' },
  message: { fontSize: 15, lineHeight: 21 },
  buttons: { marginTop: 8, gap: 8 },
  button: { borderWidth: 1, borderRadius: 12, alignItems: 'center', paddingVertical: 12 },
  buttonText: { fontSize: 15, fontWeight: '600' },
});
