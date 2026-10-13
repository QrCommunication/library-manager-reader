import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { FontFamilyOption, ReaderSettings, ThemeName } from '../../core/types';
import { useReaderTheme } from '../../theme/context';

// Fully controlled: no store, no bridge — the owner persists/applies via onSettingsChange.
export function TypographyPanel({ settings, onSettingsChange }: {
  settings: ReaderSettings;
  onSettingsChange(next: ReaderSettings): void;
}) {
  const { t } = useTranslation();
  const th = useReaderTheme();
  const patch = (p: Partial<ReaderSettings>) => onSettingsChange({ ...settings, ...p });

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={[styles.sectionLabel, { color: th.muted }]}>{t('reader.font')}</Text>
      <View style={styles.segmentRow}>
        {FONT_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            style={[styles.segment, { borderColor: th.accent }, settings.fontFamily === option.value && { backgroundColor: th.accent }]}
            onPress={() => patch({ fontFamily: option.value })}
          >
            <Text style={[styles.segmentText, { color: th.accent }, settings.fontFamily === option.value && { color: th.onAccent, fontWeight: '600' }]}>
              {t(option.labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>

      <Stepper
        label={t('reader.size')}
        value={settings.fontSize}
        min={12} max={32} step={1} decimals={0}
        onChange={(v) => patch({ fontSize: v })}
      />
      <Stepper
        label={t('reader.lineHeight')}
        value={settings.lineHeight}
        min={1.2} max={2.2} step={0.1} decimals={1}
        onChange={(v) => patch({ lineHeight: v })}
      />
      <Stepper
        label={t('reader.margins')}
        value={settings.margin}
        min={0} max={64} step={4} decimals={0}
        onChange={(v) => patch({ margin: v })}
      />
      <Stepper
        label={t('reader.brightness')}
        value={settings.brightness}
        min={0} max={70} step={5} decimals={0}
        accessibilityLabel="brightness"
        onChange={(v) => patch({ brightness: v })}
      />

      <View style={styles.segmentRow}>
        {THEME_OPTIONS.map((option) => (
          <Pressable
            key={option.value}
            style={[styles.segment, { borderColor: th.accent }, settings.theme === option.value && { backgroundColor: th.accent }]}
            onPress={() => patch({ theme: option.value })}
          >
            <Text style={[styles.segmentText, { color: th.accent }, settings.theme === option.value && { color: th.onAccent, fontWeight: '600' }]}>
              {t(option.labelKey)}
            </Text>
          </Pressable>
        ))}
      </View>
    </ScrollView>
  );
}

const FONT_OPTIONS: { value: FontFamilyOption; labelKey: string }[] = [
  { value: 'serif', labelKey: 'reader.fontSerif' },
  { value: 'sans', labelKey: 'reader.fontSans' },
  { value: 'literata', labelKey: 'reader.fontLiterata' },
];

const THEME_OPTIONS: { value: ThemeName; labelKey: string }[] = [
  { value: 'day', labelKey: 'settings.theme.day' },
  { value: 'sepia', labelKey: 'settings.theme.sepia' },
  { value: 'night', labelKey: 'settings.theme.night' },
  { value: 'auto', labelKey: 'settings.theme.auto' },
];

function Stepper({ label, value, min, max, step, decimals, accessibilityLabel, onChange }: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  // stable ids for the +/- buttons (screen readers, tests); derived from the
  // visible label when omitted
  accessibilityLabel?: string;
  onChange(v: number): void;
}) {
  const th = useReaderTheme();
  // round to `decimals` to avoid float drift on repeated +/- taps
  const clamp = (v: number) => Math.min(max, Math.max(min, Number(v.toFixed(decimals))));
  const atMin = value <= min;
  const atMax = value >= max;
  return (
    <View style={styles.stepperRow}>
      <Text style={[styles.stepperLabel, { color: th.foreground }]}>{label}</Text>
      <Pressable
        style={[styles.stepButton, { borderColor: th.accent }, atMin && styles.buttonDisabled]}
        disabled={atMin}
        hitSlop={8}
        accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}-` : undefined}
        onPress={() => onChange(clamp(value - step))}
      >
        <Text style={[styles.stepSymbol, { color: th.accent }]}>{'−'}</Text>
      </Pressable>
      <Text style={[styles.stepValue, { color: th.foreground }]}>{value.toFixed(decimals)}</Text>
      <Pressable
        style={[styles.stepButton, { borderColor: th.accent }, atMax && styles.buttonDisabled]}
        disabled={atMax}
        hitSlop={8}
        accessibilityLabel={accessibilityLabel ? `${accessibilityLabel}+` : undefined}
        onPress={() => onChange(clamp(value + step))}
      >
        <Text style={[styles.stepSymbol, { color: th.accent }]}>{'+'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { padding: 12, gap: 12 },
  sectionLabel: { fontSize: 13, fontWeight: '700' },
  segmentRow: { flexDirection: 'row', gap: 8 },
  segment: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    borderRadius: 8, borderWidth: 1,
  },
  segmentText: { fontSize: 14 },
  stepperRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  stepperLabel: { flex: 1, fontSize: 15 },
  stepButton: {
    width: 40, height: 40, borderRadius: 8, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  buttonDisabled: { opacity: 0.4 },
  stepSymbol: { fontSize: 20, lineHeight: 24 },
  stepValue: { minWidth: 44, textAlign: 'center', fontSize: 15, fontVariant: ['tabular-nums'] },
});
