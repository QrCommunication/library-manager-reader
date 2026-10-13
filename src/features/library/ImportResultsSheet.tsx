import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import type { ImportOutcome } from '../../core/import/importService';
import { themeTokens } from '../../theme/tokens';
import { useWindowLayout } from '../../ui/windowClasses';

export type { ImportOutcome };

export function ImportResultsSheet({ outcomes, onClose }: { outcomes: ImportOutcome[]; onClose(): void }) {
  const { t } = useTranslation();
  const side = useWindowLayout().panel === 'side';
  const t0 = themeTokens(useColorScheme() === 'dark' ? 'night' : 'day');
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={[s.backdrop, side && s.backdropSide]} onPress={onClose}>
        <View style={[s.sheet, { backgroundColor: t0.chrome }, side ? s.sheetSide : s.sheetBottom]}>
          <Text style={[s.title, { color: t0.foreground }]}>{t('import.results.title')}</Text>
          {outcomes.map((o, index) => (
            // picked duplicates share the same uri — index keeps the keys unique
            <View key={`${o.uri}-${index}`} style={s.row}>
              <View style={s.rowHead}>
                <Ionicons
                  name={o.ok ? 'checkmark-circle' : 'close-circle'}
                  size={18}
                  color={o.ok ? t0.accent : t0.danger}
                />
                <Text numberOfLines={1} style={{ flex: 1, color: t0.foreground }}>
                  {o.uri.split('/').pop() ?? o.uri} — {o.ok ? '✓' : t(`import.failed.${o.reason === 'io_error' || o.reason === 'parse_failed' ? 'parse' : o.reason}`)}
                </Text>
              </View>
              {!o.ok && o.detail ? <Text numberOfLines={3} style={[s.detail, { color: t0.muted }]}>{o.detail}</Text> : null}
            </View>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  backdropSide: { flexDirection: 'row', justifyContent: 'flex-end' },
  sheet: { padding: 20, gap: 10 },
  sheetBottom: { borderTopLeftRadius: 16, borderTopRightRadius: 16 },
  sheetSide: { width: 400, maxWidth: '85%', height: '100%', borderTopLeftRadius: 16, borderBottomLeftRadius: 16 },
  title: { fontWeight: '700', fontSize: 16 },
  row: { gap: 2 },
  rowHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detail: { fontSize: 12, paddingLeft: 26, fontFamily: 'monospace' },
});
