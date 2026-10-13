import React from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { HighlightColor, SelectionRect } from '../../core/types';

export interface SelectionState {
  text: string;
  rect: SelectionRect;
  cfi: string | null;
  lang: string | null;
}

// Engine-side palette (engine.ts HIGHLIGHT_COLORS): the pastilles must offer
// exactly the colors the webview actually paints.
export const HIGHLIGHT_HEX: Record<HighlightColor, string> = {
  yellow: '#F7D354',
  green: '#7DCEA0',
  blue: '#85C1E9',
  red: '#EC7063',
};

const HIGHLIGHT_COLORS: HighlightColor[] = ['yellow', 'green', 'blue', 'red'];

// Anchored bubble over the reader selection. Positioning only: the owner
// decides what Définir/Traduire/Copier/Surligner do (Traduire always opens the
// sheet; Surligner swaps the actions for the four color pastilles).
export function SelectionPopover({ selection, highlightMode = false, onHighlightPress, onHighlight, onDefine, onTranslate, onCopy, onDismiss }: {
  selection: SelectionState;
  highlightMode?: boolean;
  onHighlightPress?(): void;
  onHighlight?(color: HighlightColor): void;
  onDefine(): void;
  onTranslate(): void;
  onCopy(): void;
  onDismiss(): void;
}) {
  const { t } = useTranslation();
  const screenW = useWindowDimensions().width;
  const POPOVER_WIDTH = 280;
  const left = Math.max(8, Math.min(selection.rect.x, screenW - POPOVER_WIDTH - 8));
  const above = selection.rect.y >= 64;
  const top = above ? selection.rect.y - 56 : selection.rect.y + selection.rect.height + 8;
  return (
    <View style={[styles.root, { left, top, width: POPOVER_WIDTH }]} testID="selection-popover">
      <View style={styles.header}>
        <Text style={styles.text} numberOfLines={2}>{selection.text}</Text>
        <Pressable onPress={onDismiss} hitSlop={8} accessibilityLabel={t('common.cancel')}>
          <Text style={styles.close}>{'✕'}</Text>
        </Pressable>
      </View>
      {highlightMode ? (
        <View style={styles.actions}>
          {HIGHLIGHT_COLORS.map((color) => (
            <Pressable
              key={color}
              testID={`highlight-${color}`}
              style={[styles.swatch, { backgroundColor: HIGHLIGHT_HEX[color] }]}
              onPress={() => onHighlight?.(color)}
            />
          ))}
        </View>
      ) : (
        <View style={styles.actions}>
          <Pressable style={styles.action} onPress={onDefine}>
            <Text style={styles.actionText}>{t('lookup.define')}</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={onTranslate}>
            <Text style={styles.actionText}>{t('lookup.translate')}</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={onCopy}>
            <Text style={styles.actionText}>{t('lookup.copy')}</Text>
          </Pressable>
          <Pressable style={styles.action} onPress={onHighlightPress}>
            <Text style={styles.actionText}>{t('lookup.highlight')}</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    gap: 8,
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 4,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  text: { flex: 1, fontSize: 15, fontWeight: '600' },
  close: { fontSize: 14, lineHeight: 18, opacity: 0.6 },
  actions: { flexDirection: 'row', gap: 12 },
  action: { paddingVertical: 4 },
  actionText: { color: '#2D6CDF', fontWeight: '600' },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 1, borderColor: '#00000033' },
});
