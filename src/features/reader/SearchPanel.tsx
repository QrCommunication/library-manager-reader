import React, { useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

// Structural slice of the reader bridge needed here (ReaderBridge satisfies it).
export interface SearchBridge {
  search(query: string): void;
  searchCancel(): void;
  goTo(target: string): void;
  onSearchResult(cb: (r: { cfi: string; excerpt: string; fraction: number }) => void): () => void;
  onSearchDone(cb: (count: number) => void): () => void;
}

// The engine stream carries no id and is capped at 200 results (searchDone's
// count). The panel mirrors that cap defensively and — mandatory ruling —
// resets the list on every new submission: a cancelled search's searchDone is
// token-dropped engine-side, so stale searchResult events can still arrive
// after a newer search began and must never land on top of the old list.
const MAX_RESULTS = 200;

export function SearchPanel({ bridge, onNavigate }: { bridge: SearchBridge; onNavigate(target: string): void }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<{ cfi: string; excerpt: string; fraction: number }[]>([]);
  const [searching, setSearching] = useState(false);
  const offRef = useRef<(() => void)[]>([]);

  useEffect(() => {
    offRef.current = [
      bridge.onSearchResult((r) => setResults((prev) => (prev.length >= MAX_RESULTS ? prev : [...prev, r]))),
      bridge.onSearchDone(() => setSearching(false)),
    ];
    // unmount: no listener leak, and the in-flight engine search is cancelled
    return () => { for (const off of offRef.current) off(); bridge.searchCancel(); };
  }, [bridge]);

  const submit = () => {
    const q = query.trim();
    if (!q) return;
    // reset BEFORE the new stream starts (see ruling above)
    bridge.searchCancel();
    setResults([]);
    setSearching(true);
    bridge.search(q);
  };

  return (
    <View style={styles.root}>
      <TextInput
        style={styles.input}
        placeholder={t('search.placeholder')}
        placeholderTextColor="#00000066"
        value={query}
        onChangeText={setQuery}
        onSubmitEditing={submit}
        autoCorrect={false}
        autoCapitalize="none"
      />
      {searching ? <Text style={styles.state}>{t('search.searching')}</Text> : null}
      {!searching && results.length === 0 ? <Text style={styles.state}>{t('search.empty')}</Text> : null}
      <FlatList
        data={results}
        keyExtractor={(r, i) => `${r.cfi}-${i}`}
        renderItem={({ item }) => (
          <Pressable style={styles.row} onPress={() => onNavigate(item.cfi)}>
            <Text style={styles.excerpt} numberOfLines={2}>{item.excerpt}</Text>
            <Text style={styles.percent}>{`${Math.round(item.fraction * 100)} %`}</Text>
          </Pressable>
        )}
      />
      {results.length > 0 ? <Text style={styles.count}>{t('search.results', { count: results.length })}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  input: {
    margin: 12, borderWidth: 1, borderColor: '#2D6CDF', borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8, fontSize: 14,
  },
  state: { paddingHorizontal: 12, paddingBottom: 6, opacity: 0.7 },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#00000022',
  },
  excerpt: { flex: 1, fontSize: 14 },
  percent: { minWidth: 44, textAlign: 'right', opacity: 0.7 },
  count: { paddingHorizontal: 12, paddingTop: 6, fontSize: 13, opacity: 0.7 },
});
