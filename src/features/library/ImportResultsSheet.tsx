import React from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { ImportOutcome } from '../../core/import/importService';

export type { ImportOutcome };

export function ImportResultsSheet({ outcomes, onClose }: { outcomes: ImportOutcome[]; onClose(): void }) {
  const { t } = useTranslation();
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <View style={s.sheet}>
          <Text style={s.title}>{t('import.results.title')}</Text>
          {outcomes.map((o, index) => (
            // picked duplicates share the same uri — index keeps the keys unique
            <Text key={`${o.uri}-${index}`} numberOfLines={1}>
              {o.uri.split('/').pop() ?? o.uri} — {o.ok ? '✓' : t(`import.failed.${o.reason === 'io_error' || o.reason === 'parse_failed' ? 'parse' : o.reason}`)}
            </Text>
          ))}
        </View>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#FFF', padding: 20, gap: 8 },
  title: { fontWeight: '700', fontSize: 16 },
});
