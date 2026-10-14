// Remote tile in the server-books grid: same visual language as the library
// grid. Cover comes from the on-disk cache via loadCover (the mobile API has
// no cover URLs to hotlink); initials cover the loading/missing state. Books
// already matched in the local library wear an opaque badge and are not
// tappable; the others transfer on tap or long-press, and join the bulk
// selection when the sheet is in selection mode.

import React, { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { useColorScheme } from 'react-native';
import type { LmBook } from '../../core/remote/lmClient';
import { themeTokens } from '../../theme/tokens';

export function RemoteBookGridItem({ book, inLibrary, onLongPress, onPress, onInfo, loadCover, selectionMode = false, selected = false }: {
  book: LmBook;
  inLibrary: boolean;
  onLongPress(): void;
  onPress?(): void;
  /** opens the server-side details sheet (title, author, series, summary) */
  onInfo?(): void;
  /** resolves to a local file path once the cover is cached, null when there is none */
  loadCover?: () => Promise<string | null>;
  selectionMode?: boolean;
  selected?: boolean;
}) {
  const { t } = useTranslation();
  const t0 = themeTokens(useColorScheme() === 'dark' ? 'night' : 'day');
  const [coverUri, setCoverUri] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadCover?.()
      .then((uri) => { if (alive && uri) setCoverUri(uri); })
      .catch(() => { /* keep the initials */ });
    return () => { alive = false; };
    // the load is bound to the tile's mount, not to a changing closure
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const initials = book.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  return (
    <Pressable
      style={s.cell}
      // already-local books are display-only: no tap, no long-press action
      onPress={inLibrary ? undefined : onPress}
      onLongPress={inLibrary ? undefined : onLongPress}
      disabled={inLibrary}
      accessibilityRole="button"
      accessibilityLabel={`${book.title}${book.author ? ` — ${book.author}` : ''}${inLibrary ? ` — ${t('library.remote.inLibrary')}` : ''}`}
    >
      <View style={[s.cover, { backgroundColor: t0.chrome }]}>
        {coverUri ? (
          <Image source={{ uri: coverUri }} style={s.image} resizeMode="cover" onError={() => setCoverUri(null)} />
        ) : (
          <Text style={[s.initials, { color: t0.muted }]}>{initials}</Text>
        )}
        {selectionMode ? (
          <View style={s.checkBadge}>
            <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={selected ? '#4C8DFF' : '#FFFFFF'} />
          </View>
        ) : inLibrary ? (
          <View style={s.localBadge}>
            <Ionicons name="checkmark-circle" size={14} color="#7FD8A4" />
            <Text style={s.localBadgeText}>{t('library.remote.inLibrary')}</Text>
          </View>
        ) : null}
        {onInfo && !selectionMode ? (
          <Pressable
            style={s.infoBadge}
            hitSlop={6}
            onPress={onInfo}
            accessibilityRole="button"
            accessibilityLabel={`${t('library.remote.info')} ${book.title}`}
          >
            <Ionicons name="information-circle" size={20} color="#FFFFFF" />
          </Pressable>
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
  image: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  initials: { fontSize: 32, fontWeight: '800', letterSpacing: 1 },
  checkBadge: { position: 'absolute', top: 6, left: 6 },
  infoBadge: {
    position: 'absolute', top: 6, left: 6,
    backgroundColor: '#000000B3', borderRadius: 12, width: 26, height: 26, alignItems: 'center', justifyContent: 'center',
  },
  localBadge: {
    position: 'absolute', bottom: 6, left: 6, right: 6,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    backgroundColor: '#000000B3', borderRadius: 9, paddingVertical: 3, paddingHorizontal: 6,
  },
  localBadgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  tomeBadge: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: '#000000B3', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2,
  },
  tomeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  title: { marginTop: 6, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  author: { marginTop: 2, fontSize: 12, textAlign: 'center' },
  series: { marginTop: 1, fontSize: 11, fontStyle: 'italic', textAlign: 'center' },
});
