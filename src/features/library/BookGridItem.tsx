import React, { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View, useColorScheme } from 'react-native';
import type { Book } from '../../core/types';
import { themeTokens } from '../../theme/tokens';

export function BookGridItem({ book, coverUri, onPress, onLongPress }: {
  book: Book;
  coverUri: string;
  onPress(): void;
  onLongPress(): void;
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
  return (
    <Pressable style={s.cell} onPress={onPress} onLongPress={onLongPress}>
      <View style={[s.cover, { backgroundColor: t.chrome }]}>
        {coverFailed ? (
          <Text style={[s.initials, { color: t.muted }]}>{initials}</Text>
        ) : (
          <Image
            source={{ uri: coverUri }}
            style={s.image}
            resizeMode="cover"
            onError={() => setCoverFailed(true)}
          />
        )}
      </View>
      <Text numberOfLines={2} style={[s.title, { color: t.foreground }]}>{book.title}</Text>
      {book.author ? <Text numberOfLines={1} style={[s.author, { color: t.muted }]}>{book.author}</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  cell: { flex: 1, margin: 6, alignItems: 'center' },
  cover: { width: '100%', aspectRatio: 0.7, borderRadius: 8, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  image: { width: '100%', height: '100%' },
  initials: { fontSize: 32, fontWeight: '800', letterSpacing: 1 },
  title: { marginTop: 6, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  author: { marginTop: 2, fontSize: 12, textAlign: 'center' },
});
