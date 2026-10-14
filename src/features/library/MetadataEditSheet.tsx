import React, { useEffect, useState } from 'react';
import { KeyboardTypeOptions, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useServices } from '../../core/services';
import type { Book } from '../../core/types';
import { writeMetaToStoredFile } from '../../core/library/fileMeta';
import { themeTokens } from '../../theme/tokens';
import { useKeyboardHeight } from './useKeyboardHeight';

type Tokens = ReturnType<typeof themeTokens>;

function Field({ label, value, onChange, tokens, keyboard }: {
  label: string;
  value: string;
  onChange(v: string): void;
  tokens: Tokens;
  keyboard?: KeyboardTypeOptions;
}) {
  return (
    <View style={styles.field}>
      <Text style={[styles.label, { color: tokens.muted }]}>{label}</Text>
      <TextInput
        style={[styles.input, { color: tokens.foreground, borderColor: tokens.border }]}
        value={value}
        onChangeText={onChange}
        accessibilityLabel={label}
        keyboardType={keyboard}
        autoCorrect={false}
        autoCapitalize="none"
      />
    </View>
  );
}

// Bottom sheet editing a book's metadata. The edit lands in SQLite and is
// mirrored into the stored file (EPUB OPF / CBZ ComicInfo — MOBI/AZW3 stay
// read-only), so a bulk refresh or an export keeps the fixed values.
export function MetadataEditSheet({ book, onClose, onSaved }: {
  book: Book;
  onClose(): void;
  onSaved(): void;
}) {
  const { t } = useTranslation();
  const { books, fs, paths } = useServices();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  const kb = useKeyboardHeight();
  const t0 = themeTokens(useColorScheme() === 'dark' ? 'night' : 'day');
  const [title, setTitle] = useState(book.title);
  const [author, setAuthor] = useState(book.author ?? '');
  const [series, setSeries] = useState(book.series ?? '');
  const [tome, setTome] = useState(book.seriesIndex == null ? '' : String(book.seriesIndex));
  const [allSeries, setAllSeries] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void books.listSeries().then((rows) => setAllSeries(rows.map((r) => r.name)));
    // series names are static for the sheet's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const q = series.trim().toLowerCase();
  const suggestions = q.length === 0
    ? []
    : allSeries.filter((s) => s.toLowerCase().includes(q) && s.toLowerCase() !== q).slice(0, 6);

  const canSave = title.trim().length > 0 && !saving;

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    const parsedTome = Number.parseFloat(tome.trim().replace(',', '.'));
    const seriesIndex = tome.trim() !== '' && Number.isFinite(parsedTome) ? parsedTome : null;
    const meta = { title: title.trim(), author: author.trim() || null, series: series.trim() || null, seriesIndex };
    await books.updateMetadata(book.id, meta);
    // best-effort mirror into the stored file; the row is already saved
    try {
      await writeMetaToStoredFile(fs, paths, book, meta);
    } catch (err) {
      console.warn('metadata file write failed', err);
    }
    onSaved();
  };

  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.cancel')}>
        <Pressable
          style={[styles.sheet, {
            backgroundColor: t0.chrome,
            paddingBottom: 16 + insets.bottom,
            marginBottom: kb,
            maxHeight: kb > 0 ? win.height - kb : undefined,
          }]}
          testID="metadata-edit-sheet"
          onPress={(e) => e.stopPropagation()}
        >
          <Text style={[styles.title, { color: t0.foreground }]}>{t('library.editTitle')}</Text>
          <ScrollView keyboardShouldPersistTaps="handled" style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Field label={t('library.fieldTitle')} value={title} onChange={setTitle} tokens={t0} />
            <Field label={t('library.fieldAuthor')} value={author} onChange={setAuthor} tokens={t0} />
            <Field label={t('library.fieldSeries')} value={series} onChange={setSeries} tokens={t0} />
            {suggestions.length > 0 ? (
              <View style={styles.chips}>
                {suggestions.map((s) => (
                  <Pressable
                    key={s}
                    onPress={() => setSeries(s)}
                    style={[styles.chip, { borderColor: t0.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={s}
                  >
                    <Text style={[styles.chipText, { color: t0.foreground }]}>{s}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <Field label={t('library.fieldTome')} value={tome} onChange={setTome} tokens={t0} keyboard="decimal-pad" />
          </ScrollView>
          <View style={styles.footer}>
            <Pressable style={[styles.btn, { borderColor: t0.border }]} onPress={onClose} accessibilityRole="button" accessibilityLabel={t('common.cancel')}>
              <Text style={[styles.btnText, { color: t0.foreground }]}>{t('common.cancel')}</Text>
            </Pressable>
            <Pressable
              style={[styles.btn, { backgroundColor: t0.accent, opacity: canSave ? 1 : 0.4 }]}
              onPress={() => void save()}
              disabled={!canSave}
              accessibilityRole="button"
              accessibilityLabel={t('common.save')}
            >
              <Text style={[styles.btnText, { color: t0.onAccent }]}>{t('common.save')}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 16, gap: 12,
  },
  title: { fontSize: 16, fontWeight: '700' },
  body: { flexGrow: 0, flexShrink: 1 },
  bodyContent: { gap: 12, paddingTop: 12 },
  field: { gap: 4 },
  label: { fontSize: 13, fontWeight: '600' },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, height: 42, fontSize: 15 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: -6 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1 },
  chipText: { fontSize: 13, fontWeight: '600' },
  footer: { flexDirection: 'row', gap: 12, marginTop: 12 },
  btn: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 8, borderWidth: 1 },
  btnText: { fontSize: 15, fontWeight: '600' },
});
