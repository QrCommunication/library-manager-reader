// Autocomplete select for the remote series filter: a closed-looking field
// that opens a filterable dropdown ("Toutes les séries" clears). Not a chip
// row — one control, keyboard-friendly, scales with long series names.

import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from 'react-native';
import { themeTokens } from '../../theme/tokens';

export function SeriesSelect({ value, options, onChange }: {
  value: string | null;
  options: string[];
  onChange(series: string | null): void;
}) {
  const { t } = useTranslation();
  const t0 = themeTokens(useColorScheme() === 'dark' ? 'night' : 'day');
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = options
    .filter((s) => s.toLowerCase().includes(query.trim().toLowerCase()))
    .slice(0, 30);
  const pick = (series: string | null) => {
    onChange(series);
    setOpen(false);
    setQuery('');
  };
  return (
    <View style={styles.root}>
      <Pressable
        style={[styles.field, { borderColor: t0.border, backgroundColor: t0.chrome }]}
        onPress={() => setOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={t('library.remote.seriesFilter')}
      >
        <Ionicons name="albums-outline" size={16} color={t0.muted} />
        <Text numberOfLines={1} style={[styles.value, { color: value ? t0.foreground : t0.muted }]}>
          {value ?? t('library.remote.seriesAll')}
        </Text>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={16} color={t0.muted} />
      </Pressable>
      {open ? (
        <View style={[styles.dropdown, { backgroundColor: t0.chrome, borderColor: t0.border }]}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('library.remote.seriesFilterHint')}
            placeholderTextColor={t0.muted}
            style={[styles.search, { borderColor: t0.border, color: t0.foreground }]}
            autoCorrect={false}
          />
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            <Pressable style={styles.option} onPress={() => pick(null)}>
              <Text style={[styles.optionText, { color: value ? t0.foreground : t0.accent, fontWeight: value ? '400' : '700' }]}>
                {t('library.remote.seriesAll')}
              </Text>
            </Pressable>
            {filtered.map((s) => (
              <Pressable key={s} style={styles.option} onPress={() => pick(s)}>
                <Text
                  numberOfLines={1}
                  style={[styles.optionText, { color: value === s ? t0.accent : t0.foreground, fontWeight: value === s ? '700' : '400' }]}
                >
                  {s}
                </Text>
              </Pressable>
            ))}
            {filtered.length === 0 ? (
              <Text style={[styles.empty, { color: t0.muted }]}>{t('library.remote.seriesEmpty')}</Text>
            ) : null}
          </ScrollView>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'relative', zIndex: 20 },
  field: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, height: 42,
  },
  value: { flex: 1, fontSize: 14 },
  dropdown: {
    position: 'absolute', top: 48, left: 0, right: 0,
    borderRadius: 12, borderWidth: 1, overflow: 'hidden', elevation: 6,
    shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
  },
  search: { borderWidth: 1, borderRadius: 10, margin: 8, paddingHorizontal: 10, height: 38, fontSize: 14 },
  list: { maxHeight: 220 },
  option: { paddingHorizontal: 14, paddingVertical: 11 },
  optionText: { fontSize: 14 },
  empty: { paddingHorizontal: 14, paddingVertical: 11, fontSize: 13, fontStyle: 'italic' },
});
