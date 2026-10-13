import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useServices } from '../../core/services';
import type { Annotation, HighlightColor } from '../../core/types';
import { HIGHLIGHT_HEX } from './SelectionPopover';
import { useReaderTheme } from '../../theme/context';

// Structural slice of the reader bridge needed here (ReaderBridge satisfies it).
export interface HighlightBridge {
  addHighlight(id: string, cfi: string, color: HighlightColor): void;
  removeHighlight(id: string): void;
}

const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'red'];

// Sub-row shown when a row's pastille is pressed: the four engine colors.
// Kept as a sibling component so the compiler lint keeps classifying the pick
// callback as an event handler (it loses that context through a nested map).
function ColorRow({ annotation, onPick }: {
  annotation: Annotation;
  onPick(annotation: Annotation, color: HighlightColor): void;
}) {
  const th = useReaderTheme();
  return (
    <View style={styles.colorRow}>
      {HIGHLIGHT_COLORS.map((color) => (
        <Pressable
          key={color}
          testID={`annotation-color-${color}`}
          style={[styles.swatch, { backgroundColor: HIGHLIGHT_HEX[color], borderColor: th.border }]}
          onPress={() => onPick(annotation, color)}
        />
      ))}
    </View>
  );
}

// List of persisted highlights: tap the excerpt to jump there, the pencil to
// edit the note inline, the pastille to recolor (engine overlay is updated via
// the bridge), ✕ to delete (tombstone + bridge removal).
export function AnnotationsPanel({ bookId, bridge, onNavigate }: {
  bookId: string;
  bridge: HighlightBridge;
  onNavigate(target: string): void;
}) {
  const { t } = useTranslation();
  const th = useReaderTheme();
  const { annotations } = useServices();
  const [items, setItems] = useState<Annotation[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [colorRow, setColorRow] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setItems(await annotations.listByBook(bookId));
  }, [annotations, bookId]);

  useEffect(() => {
    // async IIFE: keeps the initial load on the same `reload` used by the
    // mutations, without a synchronous setState inside the effect body
    void (async () => { await reload(); })();
  }, [reload]);

  const changeColor = async (a: Annotation, color: HighlightColor) => {
    await annotations.setColor(a.id, color, Date.now());
    bridge.removeHighlight(a.id);
    bridge.addHighlight(a.id, a.cfi, color);
    setColorRow(null);
    await reload();
  };

  const remove = async (a: Annotation) => {
    await annotations.markDeleted(a.id, Date.now()).catch(() => {});
    bridge.removeHighlight(a.id);
    await reload();
  };

  const openNote = (a: Annotation) => {
    setNoteDraft(a.note ?? '');
    setEditing(a.id);
  };

  const saveNote = async (a: Annotation) => {
    await annotations.setNote(a.id, noteDraft.trim() || null, Date.now());
    setEditing(null);
    await reload();
  };

  if (items.length === 0) {
    return (
      <View style={styles.root}>
        <Text style={[styles.empty, { color: th.foreground }]}>{t('annotations.empty')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <ScrollView>
        {items.map((a) => (
          <View key={a.id} style={[styles.block, { borderBottomColor: th.border }]}>
            <View style={styles.row}>
              <Pressable
                style={[styles.swatch, { backgroundColor: HIGHLIGHT_HEX[a.color], borderColor: th.border }]}
                onPress={() => setColorRow((id) => (id === a.id ? null : a.id))}
                accessibilityLabel={t('annotations.color')}
              />
              <Pressable style={styles.rowMain} onPress={() => onNavigate(a.cfi)}>
                <Text style={[styles.excerpt, { color: th.foreground }]} numberOfLines={3}>{a.excerpt}</Text>
                {a.note ? <Text style={[styles.note, { color: th.muted }]} numberOfLines={2}>{a.note}</Text> : null}
              </Pressable>
              {editing === a.id ? null : (
                <Pressable hitSlop={8} onPress={() => openNote(a)} accessibilityLabel={t('annotations.note')}>
                  <Text style={[styles.noteGlyph, { color: th.muted }]}>{'✎'}</Text>
                </Pressable>
              )}
              <Pressable hitSlop={8} onPress={() => void remove(a)} accessibilityLabel={t('annotations.remove')}>
                <Text style={[styles.remove, { color: th.danger }]}>✕</Text>
              </Pressable>
            </View>
            {colorRow === a.id ? (
              <ColorRow annotation={a} onPick={(target, color) => void changeColor(target, color)} />
            ) : null}
            {editing === a.id ? (
              <View style={styles.noteEditor}>
                <TextInput
                  style={[styles.noteInput, { borderColor: th.accent, color: th.foreground }]}
                  value={noteDraft}
                  onChangeText={setNoteDraft}
                  placeholder={t('annotations.noteHint')}
                  placeholderTextColor={th.muted}
                  multiline
                />
                <Pressable style={[styles.saveButton, { borderColor: th.accent }]} onPress={() => void saveNote(a)}>
                  <Text style={[styles.saveText, { color: th.accent }]}>{t('annotations.save')}</Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  empty: { padding: 24, textAlign: 'center' },
  block: {
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 8 },
  swatch: { width: 24, height: 24, borderRadius: 12, borderWidth: 1 },
  rowMain: { flex: 1, paddingRight: 4 },
  excerpt: { fontSize: 14 },
  note: { fontSize: 13, fontStyle: 'italic', marginTop: 2 },
  noteGlyph: { fontSize: 16, paddingHorizontal: 4 },
  remove: { fontSize: 16, paddingHorizontal: 6 },
  colorRow: { flexDirection: 'row', gap: 12, paddingBottom: 10, paddingLeft: 32 },
  noteEditor: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 10 },
  noteInput: {
    flex: 1, borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, fontSize: 14, minHeight: 36,
  },
  saveButton: {
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 8,
  },
  saveText: { fontWeight: '600' },
});
