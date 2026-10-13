import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import Constants from 'expo-constants';
import { useServices } from '../../core/services';
import { formatBytes } from '../../core/format';
import type { LanguagePref, ThemeName } from '../../core/types';
import { initI18n } from '../../i18n';
import { themeTokens } from '../../theme/tokens';
import { useUiPrefsStore } from './uiPrefsStore';

const LANGUAGES: { value: LanguagePref; labelKey: string }[] = [
  { value: 'auto', labelKey: 'settings.language.auto' },
  { value: 'fr', labelKey: 'settings.language.fr' },
  { value: 'en', labelKey: 'settings.language.en' },
];

const THEMES: { value: ThemeName; labelKey: string }[] = [
  { value: 'day', labelKey: 'settings.theme.day' },
  { value: 'sepia', labelKey: 'settings.theme.sepia' },
  { value: 'night', labelKey: 'settings.theme.night' },
];

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const services = useServices();
  const { prefs, update } = useUiPrefsStore();
  const lang = i18n.language === 'fr' ? 'fr' : 'en';
  const [storageBytes, setStorageBytes] = useState<number | null>(null);

  useEffect(() => {
    void useUiPrefsStore.getState().hydrate();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void services.fs.directorySize(services.paths.booksDir).then((n) => {
      if (!cancelled) setStorageBytes(n);
    });
    return () => { cancelled = true; };
  }, [services]);

  const version = Constants.nativeApplicationVersion ?? '—';

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: themeTokens('day').background }]}
      contentContainerStyle={styles.content}
    >
      <Text style={styles.title}>{t('settings.title')}</Text>

      {LANGUAGES.map((option) => {
        const active = prefs.language === option.value;
        return (
          <Pressable
            key={option.value}
            style={[styles.row, active && styles.rowActive]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => { void update({ language: option.value }); void initI18n(option.value); }}
          >
            <Text style={[styles.radioGlyph, active && styles.radioGlyphOn]}>{active ? '◉' : '○'}</Text>
            <Text style={styles.rowLabel}>{t(option.labelKey)}</Text>
          </Pressable>
        );
      })}

      <View style={styles.themeRow}>
        {THEMES.map((option) => {
          const active = prefs.defaultTheme === option.value;
          return (
            <Pressable
              key={option.value}
              style={[styles.themeChip, active && styles.themeChipOn]}
              onPress={() => { void update({ defaultTheme: option.value }); }}
            >
              <Text style={[styles.themeChipText, active && styles.themeChipTextOn]}>{t(option.labelKey)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.rowLabel}>{t('settings.storage')}</Text>
        <Text style={styles.infoValue}>{storageBytes === null ? null : formatBytes(storageBytes, lang)}</Text>
      </View>

      <View style={styles.infoRow}>
        <Text style={styles.rowLabel}>{t('settings.about')}</Text>
        <Text style={styles.infoValue}>{version}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingTop: 48, paddingHorizontal: 12, paddingBottom: 24, gap: 8 },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#CCC' },
  rowActive: { backgroundColor: '#DCE7FB', borderColor: '#2D6CDF' },
  radioGlyph: { fontSize: 16, color: '#666' },
  radioGlyphOn: { color: '#2D6CDF' },
  rowLabel: { fontSize: 15 },
  themeRow: { flexDirection: 'row', gap: 8 },
  themeChip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: 1, borderColor: '#2D6CDF' },
  themeChipOn: { backgroundColor: '#2D6CDF' },
  themeChipText: { fontSize: 14, color: '#2D6CDF' },
  themeChipTextOn: { color: '#FFF', fontWeight: '600' },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#CCC' },
  infoValue: { fontSize: 15, fontVariant: ['tabular-nums'] },
});
