import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useServices } from '../../core/services';
import { LookupError, type DefinitionSense, type LookupErrorKind } from '../../core/lookup/lookupService';

export type LookupMode = 'define' | 'translate';

const errorKey = (kind: LookupErrorKind): string => (
  kind === 'offline' ? 'lookup.offline' : kind === 'not_found' ? 'lookup.notFound' : 'lookup.serviceError'
);

// Bottom sheet for word lookup: Wiktionary definitions or a LibreTranslate
// translation (translation always opens the full sheet — no inline bubble).
export function DefinitionSheet({ word, lang, initialMode, onClose }: {
  word: string;
  lang: string | null;
  initialMode: LookupMode;
  onClose(): void;
}) {
  const { t, i18n } = useTranslation();
  const { lookup } = useServices();
  const [mode, setMode] = useState<LookupMode>(initialMode);
  const [senses, setSenses] = useState<DefinitionSense[] | null>(null);
  const [translation, setTranslation] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<LookupErrorKind | null>(null);
  const target = i18n.language === 'fr' ? 'fr' : 'en';
  const [nonce, setNonce] = useState(0);

  // every setState happens after an await (mirrors useReaderSession's effect)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (mode === 'define') {
          const found = await lookup.define(word, lang);
          if (!cancelled) setSenses(found);
        } else {
          const translated = await lookup.translate(word, lang ?? 'en', target);
          if (!cancelled) setTranslation(translated);
        }
      } catch (e) {
        if (!cancelled) setErrorKind(e instanceof LookupError ? e.kind : 'service_error');
      }
    })();
    return () => { cancelled = true; };
  }, [mode, word, lang, target, lookup, nonce]);

  // clear previous results before a new lookup (mode switch or retry)
  const reset = () => { setSenses(null); setTranslation(null); setErrorKind(null); };
  const openMode = (next: LookupMode) => { if (next !== mode) reset(); setMode(next); };

  const busy = senses === null && translation === null && errorKind === null;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.cancel')} />
      <View style={styles.sheet}>
        <Text style={styles.word} numberOfLines={2}>{word}</Text>
        {senses !== null ? (
          senses.length === 0
            ? <Text style={styles.state}>{t('lookup.notFound')}</Text>
            : (
              <ScrollView style={styles.scroll}>
                {senses.map((s, i) => (
                  <View key={i} style={styles.sense}>
                    {s.pos ? <Text style={styles.pos}>{s.pos}</Text> : null}
                    {s.glosses.map((g, j) => (
                      <View key={j} style={styles.glossRow}>
                        <Text style={styles.bullet}>{'•'}</Text>
                        <Text style={styles.gloss}>{g}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </ScrollView>
            )
        ) : null}
        {translation !== null ? (
          <ScrollView style={styles.scroll}>
            <Text style={styles.gloss}>{translation}</Text>
          </ScrollView>
        ) : null}
        {errorKind ? <Text style={styles.state}>{t(errorKey(errorKind))}</Text> : null}
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator />
            <Text style={styles.state}>{t(mode === 'define' ? 'lookup.loading' : 'lookup.translating')}</Text>
          </View>
        ) : null}
        {errorKind ? (
          <Pressable style={styles.retry} onPress={() => { reset(); setNonce((n) => n + 1); }}>
            <Text style={styles.retryText}>{t('common.retry')}</Text>
          </Pressable>
        ) : null}
        <View style={styles.footer}>
          <Pressable
            style={[styles.footerBtn, mode === 'translate' && styles.footerBtnOn]}
            onPress={() => openMode('translate')}
          >
            <Text style={[styles.footerText, mode === 'translate' && styles.footerTextOn]}>
              {t('lookup.translate')}
            </Text>
          </Pressable>
          <Pressable style={styles.footerBtn} onPress={onClose}>
            <Text style={styles.footerText}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055' },
  sheet: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16, paddingBottom: 16,
    maxHeight: '70%',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingHorizontal: 16, gap: 12,
  },
  word: { fontSize: 18, fontWeight: '700' },
  scroll: { flexGrow: 0 },
  sense: { gap: 4, marginBottom: 12 },
  pos: { fontSize: 13, fontWeight: '700', opacity: 0.7, fontStyle: 'italic' },
  glossRow: { flexDirection: 'row', gap: 8 },
  bullet: { fontSize: 15, lineHeight: 21 },
  gloss: { fontSize: 15, lineHeight: 21, flexShrink: 1 },
  state: { fontSize: 15, opacity: 0.8 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  retry: {
    alignSelf: 'flex-start', borderWidth: 1, borderColor: '#2D6CDF',
    borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8,
  },
  retryText: { color: '#2D6CDF', fontWeight: '600' },
  footer: { flexDirection: 'row', gap: 12 },
  footerBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    borderRadius: 8, borderWidth: 1, borderColor: '#2D6CDF',
  },
  footerBtnOn: { backgroundColor: '#2D6CDF' },
  footerText: { fontSize: 15, color: '#2D6CDF', fontWeight: '600' },
  footerTextOn: { color: '#FFFFFF' },
});
