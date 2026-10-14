// Remote tile in the server-books grid: same visual language as the library
// grid, minus the local cover (the mobile API exposes no cover endpoint) —
// initials on the chrome background. The badge marks books already matched in
// the local library; the long-press transfers the others.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from 'react-native';
import type { LmBook } from '../../core/remote/lmClient';
import { themeTokens } from '../../theme/tokens';

export function RemoteBookGridItem({ book, inLibrary, onLongPress }: {
  book: LmBook;
  inLibrary: boolean;
  onLongPress(): void;
}) {
  const { t } = useTranslation();
  const t0 = themeTokens(useColorScheme() === 'dark' ? 'night' : 'day');
  const initials = book.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <Pressable
      style={s.cell}
      onLongPress={inLibrary ? undefined : onLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${book.title}${book.author ? ` — ${book.author}` : ''}${inLibrary ? ` — ${t('library.remote.inLibrary')}` : ''}`}
    >
      <View style={[s.cover, { backgroundColor: t0.chrome }]}>
        <Text style={[s.initials, { color: t0.muted }]}>{initials}</Text>
        {inLibrary ? (
          <View style={s.badge}>
            <Ionicons name="checkmark-circle" size={22} color={t0.accent} />
          </View>
        ) : null}
        {book.seriesIndex != null ? (
          <View style={s.tomeBadge}>
            <Text style={s.tomeText}>{`T${book.seriesIndex}`}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={[s.title, { color: t0.foreground }]}>{book.title}</Text>
      {book.author ? <Text numberOfLines={1} style={[s.author, { color: t0.muted }]}>{book.author}</Text> : null}
      {book.series && book.series !== book.title ? (
        <Text numberOfLines={1} style={[s.series, { color: t0.muted }]}>{book.series}</Text>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  cell: { flex: 1, margin: 6, alignItems: 'center' },
  cover: { width: '100%', aspectRatio: 0.7, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  initials: { fontSize: 32, fontWeight: '800', letterSpacing: 1 },
  badge: { position: 'absolute', top: 6, left: 6 },
  tomeBadge: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: '#000000B3', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2,
  },
  tomeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  title: { marginTop: 6, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  author: { marginTop: 2, fontSize: 12, textAlign: 'center' },
  series: { marginTop: 1, fontSize: 11, fontStyle: 'italic', textAlign: 'center' },
});
