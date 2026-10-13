import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { Book } from '../../core/types';
import { themeTokens } from '../../theme/tokens';

export function BookGridItem({ book, coverUri, onPress, onLongPress }: {
  book: Book;
  coverUri: string;
  onPress(): void;
  onLongPress(): void;
}) {
  const t = themeTokens('day');
  return (
    <Pressable style={s.cell} onPress={onPress} onLongPress={onLongPress}>
      <View style={[s.cover, { backgroundColor: t.chrome }]}>
        <Image source={{ uri: coverUri }} style={s.image} resizeMode="cover" />
      </View>
      <Text numberOfLines={2} style={[s.title, { color: t.foreground }]}>{book.title}</Text>
      {book.author ? <Text numberOfLines={1} style={[s.author, { color: t.foreground }]}>{book.author}</Text> : null}
    </Pressable>
  );
}

const s = StyleSheet.create({
  cell: { flex: 1, margin: 6, alignItems: 'center' },
  cover: { width: '100%', aspectRatio: 0.7, borderRadius: 8, overflow: 'hidden' },
  image: { width: '100%', height: '100%' },
  title: { marginTop: 6, fontSize: 14, fontWeight: '600', textAlign: 'center' },
  author: { marginTop: 2, fontSize: 12, opacity: 0.7, textAlign: 'center' },
});
