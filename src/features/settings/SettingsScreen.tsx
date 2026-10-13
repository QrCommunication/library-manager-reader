import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useServices } from '../../core/services';
import { formatBytes } from '../../core/format';
import type { LanguagePref, ThemeName } from '../../core/types';
import { initI18n } from '../../i18n';
import { themeTokens } from '../../theme/tokens';
import { useUiPrefsStore } from './uiPrefsStore';
import { useReaderSettingsStore } from './readerSettingsStore';

const LANGUAGES: { value: LanguagePref; labelKey: string }[] = [
  { value: 'auto', labelKey: 'settings.language.auto' },
  { value: 'fr', labelKey: 'settings.language.fr' },
  { value: 'en', labelKey: 'settings.language.en' },
];

const THEMES: { value: ThemeName; labelKey: string }[] = [
  { value: 'day', labelKey: 'settings.theme.day' },
  { value: 'sepia', labelKey: 'settings.theme.sepia' },
  { value: 'night', labelKey: 'settings.theme.night' },
  // 'auto' is stored as-is in both stores; resolution to day/night happens at
  // render time (reader chrome, engine cssFor fallback), never in the stores
  { value: 'auto', labelKey: 'settings.theme.auto' },
];

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const services = useServices();
  const { prefs, update } = useUiPrefsStore();
  const { update: updateReaderSettings } = useReaderSettingsStore();
  const lang = i18n.language === 'fr' ? 'fr' : 'en';
  // app chrome follows the system light/dark, same as the library
  const dark = useColorScheme() === 'dark';
  const t0 = themeTokens(dark ? 'night' : 'day');
  const insets = useSafeAreaInsets();
  const [storageBytes, setStorageBytes] = useState<number | null>(null);

  useEffect(() => {
    void useUiPrefsStore.getState().hydrate();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void services.fs.directorySize(services.paths.booksDir).then((n) => {
      if (!cancelled) setStorageBytes(n);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [services]);

  const version = Constants.expoConfig?.version ?? '—';

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: t0.background }]}
      contentContainerStyle={[styles.content, styles.contentWide, { paddingTop: insets.top + 24 }]}
    >
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <Text style={[styles.title, { color: t0.foreground }]}>{t('settings.title')}</Text>

      {LANGUAGES.map((option) => {
        const active = prefs.language === option.value;
        return (
          <Pressable
            key={option.value}
            style={[styles.row, { borderColor: t0.border }, active && { backgroundColor: t0.chrome, borderColor: t0.accent }]}
            accessibilityRole="radio"
            accessibilityState={{ selected: active }}
            onPress={() => { void update({ language: option.value }); void initI18n(option.value); }}
          >
            <Ionicons
              name={active ? 'radio-button-on' : 'radio-button-off'}
              size={18}
              color={active ? t0.accent : t0.muted}
            />
            <Text style={[styles.rowLabel, { color: t0.foreground }]}>{t(option.labelKey)}</Text>
          </Pressable>
        );
      })}

      <View style={styles.themeRow}>
        {THEMES.map((option) => {
          const active = prefs.defaultTheme === option.value;
          return (
            <Pressable
              key={option.value}
              style={[styles.themeChip, { borderColor: t0.accent }, active && { backgroundColor: t0.accent }]}
              onPress={() => {
                // the default theme IS the (global) reader theme — both stores
                // are updated so the choice applies immediately
                void update({ defaultTheme: option.value });
                void updateReaderSettings({ theme: option.value });
              }}
            >
              <Text style={[styles.themeChipText, { color: t0.accent }, active && { color: t0.onAccent, fontWeight: '600' }]}>{t(option.labelKey)}</Text>
            </Pressable>
          );
        })}
      </View>

      <View style={[styles.infoRow, { borderColor: t0.border }]}>
        <Text style={[styles.rowLabel, { color: t0.foreground }]}>{t('settings.libreTranslateUrl')}</Text>
        <TextInput
          style={[styles.textInput, { borderColor: t0.border, color: t0.foreground }]}
          value={prefs.libreTranslateUrl}
          onChangeText={(v) => { void update({ libreTranslateUrl: v }); }}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          numberOfLines={1}
          placeholderTextColor={t0.muted}
        />
      </View>
      <View style={[styles.infoRow, { borderColor: t0.border }]}>
        <Text style={[styles.rowLabel, { color: t0.foreground }]}>{t('settings.libreTranslateApiKey')}</Text>
        <TextInput
          style={[styles.textInput, { borderColor: t0.border, color: t0.foreground }]}
          value={prefs.libreTranslateApiKey}
          onChangeText={(v) => { void update({ libreTranslateApiKey: v }); }}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          numberOfLines={1}
          placeholderTextColor={t0.muted}
        />
      </View>

      <View style={[styles.infoRow, { borderColor: t0.border }]}>
        <Text style={[styles.rowLabel, { color: t0.foreground }]}>{t('settings.storage')}</Text>
        <Text style={[styles.infoValue, { color: t0.muted }]}>{storageBytes === null ? null : formatBytes(storageBytes, lang)}</Text>
      </View>

      <View style={[styles.infoRow, { borderColor: t0.border }]}>
        <Text style={[styles.rowLabel, { color: t0.foreground }]}>{t('settings.about')}</Text>
        <Text style={[styles.infoValue, { color: t0.muted }]}>{version}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 12, paddingBottom: 24, gap: 8 },
  // centered column on Fold inner display / tablets — form controls keep a
  // comfortable width instead of stretching across a 800+ dp window
  contentWide: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  title: { fontSize: 28, fontWeight: '700', marginBottom: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  rowLabel: { fontSize: 15 },
  themeRow: { flexDirection: 'row', gap: 8 },
  themeChip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  themeChipText: { fontSize: 14 },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1 },
  infoValue: { fontSize: 15, fontVariant: ['tabular-nums'] },
  // flex:1 fills the row next to the label
  textInput: { flex: 1, marginLeft: 12, borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, height: 40 },
});
