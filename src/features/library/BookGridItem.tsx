import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { Book } from '../../core/types';
import { themeTokens } from '../../theme/tokens';

// fixed colors: the band sits on a dark scrim whatever the app theme
const FILL_COLOR = '#4C8DFF';
const DONE_COLOR = '#3CC47C';

export function BookGridItem({ book, coverUri, onPress, onLongPress, selectionMode = false, selected = false, progress }: {
  book: Book;
  coverUri: string;
  onPress(): void;
  onLongPress(): void;
  selectionMode?: boolean;
  selected?: boolean;
  /** 0..1 reading fraction, undefined when the book was never opened */
  progress?: number;
}) {
  const t = themeTokens(useColorScheme() === 'dark' ? 'night' : 'day');
  const [coverFailed, setCoverFailed] = useState(false);
  // initials placeholder: first letters of the two title words, or the single
  // word — covers missing/corrupt images without a blank cell
  const initials = book.title
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const percent = progress != null && Number.isFinite(progress)
    ? Math.round(Math.min(1, Math.max(0, progress)) * 100)
    : null;
  return (
    <Pressable style={s.cell} onPress={onPress} onLongPress={onLongPress}>
      <View style={[s.cover, { backgroundColor: t.chrome }]}>
        <Image
          source={{ uri: coverUri }}
          style={s.image}
          resizeMode="cover"
          onError={() => setCoverFailed(true)}
        />
        {coverFailed ? <Text style={[s.initials, { color: t.muted }]}>{initials}</Text> : null}
        {book.seriesIndex != null ? (
          <View style={s.tomeBadge}>
            <Text style={s.tomeText}>{`T${book.seriesIndex}`}</Text>
          </View>
        ) : null}
        {selectionMode ? (
          <View style={s.checkWrap}>
            <Ionicons name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={selected ? '#4C8DFF' : '#FFFFFF'} />
          </View>
        ) : null}
        {percent != null ? (
          // reading-progress band pinned to the bottom of the cover: a dark
          // scrim keeps the bar and the % legible over any cover art
          <View
            style={s.progressBand}
            accessibilityRole="progressbar"
            accessibilityLabel={`${percent} %`}
            accessibilityValue={{ min: 0, max: 100, now: percent }}
            testID="book-progress"
          >
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${percent}%`, backgroundColor: percent >= 100 ? DONE_COLOR : FILL_COLOR }]} />
            </View>
            <Text style={s.progressLabel}>{`${percent} %`}</Text>
          </View>
        ) : null}
      </View>
      <Text numberOfLines={2} style={[s.title, { color: t.foreground }]}>{book.title}</Text>
      {book.author ? <Text numberOfLines={1} style={[s.author, { color: t.muted }]}>{book.author}</Text> : null}
      {book.series && book.series !== book.title ? (
        <Text numberOfLines={1} style={[s.series, { color: t.muted }]}>{book.series}</Text>
      ) : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  cell: { flex: 1, margin: 6, alignItems: 'center' },
  cover: { width: '100%', aspectRatio: 0.7, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  initials: { fontSize: 32, fontWeight: '800', letterSpacing: 1 },
  tomeBadge: {
    position: 'absolute', top: 6, right: 6,
    backgroundColor: '#000000B3', borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2,
  },
  tomeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '800' },
  checkWrap: { position: 'absolute', top: 6, left: 6 },
  progressBand: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 6, paddingVertical: 4, backgroundColor: '#000000A6',
  },
  progressTrack: { flex: 1, height: 4, borderRadius: 2, overflow: 'hidden', backgroundColor: '#FFFFFF40' },
  progressFill: { height: 4, borderRadius: 2 },
  progressLabel: { color: '#FFFFFF', fontSize: 10, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 30, textAlign: 'right' },
  title: { marginTop: 6, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  author: { marginTop: 2, fontSize: 12, textAlign: 'center' },
  series: { marginTop: 1, fontSize: 11, fontStyle: 'italic', textAlign: 'center' },
});
