import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useServices } from '../../core/services';
import { LookupError, type DefinitionSense, type LookupErrorKind } from '../../core/lookup/lookupService';
import { useReaderTheme } from '../../theme/context';

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
  const th = useReaderTheme();
  const { lookup, settings: settingsService } = useServices();
  const [mode, setMode] = useState<LookupMode>(initialMode);
  const [senses, setSenses] = useState<DefinitionSense[] | null>(null);
  const [translation, setTranslation] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<LookupErrorKind | null>(null);
  const [nonce, setNonce] = useState(0);

  // every setState happens after an await (mirrors useReaderSession's effect)
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        if (mode === 'define') {
          const found = await lookup.define(word, lang, i18n.language);
          if (!cancelled) setSenses(found);
        } else {
          // 'auto' lets the server detect the source language when the book
          // carries none, instead of silently assuming English; the target is
          // the user's Réglages choice, falling back to the UI language
          const prefs = await settingsService.getUiPrefs();
          const target = prefs.translateTarget || (i18n.language === 'fr' ? 'fr' : 'en');
          const translated = await lookup.translate(word, lang ?? 'auto', target);
          if (!cancelled) setTranslation(translated);
        }
      } catch (e) {
        if (!cancelled) setErrorKind(e instanceof LookupError ? e.kind : 'service_error');
      }
    })();
    return () => { cancelled = true; };
  }, [mode, word, lang, lookup, nonce, settingsService, i18n.language]);

  // clear previous results before a new lookup (mode switch or retry)
  const reset = () => { setSenses(null); setTranslation(null); setErrorKind(null); };
  const openMode = (next: LookupMode) => { if (next !== mode) reset(); setMode(next); };

  const busy = senses === null && translation === null && errorKind === null;

  return (
    <Modal transparent visible animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel={t('common.cancel')} />
      <View style={[styles.sheet, { backgroundColor: th.chrome }]}>
        <Text style={[styles.word, { color: th.foreground }]} numberOfLines={2}>{word}</Text>
        {senses !== null ? (
          senses.length === 0
            ? <Text style={[styles.state, { color: th.muted }]}>{t('lookup.notFound')}</Text>
            : (
              <ScrollView style={styles.scroll}>
                {senses.map((s, i) => (
                  <View key={i} style={styles.sense}>
                    {s.pos ? <Text style={[styles.pos, { color: th.muted }]}>{s.pos}</Text> : null}
                    {s.glosses.map((g, j) => (
                      <View key={j} style={styles.glossRow}>
                        <Text style={[styles.bullet, { color: th.muted }]}>{'•'}</Text>
                        <Text style={[styles.gloss, { color: th.foreground }]}>{g}</Text>
                      </View>
                    ))}
                  </View>
                ))}
              </ScrollView>
            )
        ) : null}
        {translation !== null ? (
          <ScrollView style={styles.scroll}>
            <Text style={[styles.gloss, { color: th.foreground }]}>{translation}</Text>
          </ScrollView>
        ) : null}
        {errorKind ? <Text style={[styles.state, { color: th.muted }]}>{t(errorKey(errorKind))}</Text> : null}
        {busy ? (
          <View style={styles.busyRow}>
            <ActivityIndicator color={th.accent} />
            <Text style={[styles.state, { color: th.muted }]}>{t(mode === 'define' ? 'lookup.loading' : 'lookup.translating')}</Text>
          </View>
        ) : null}
        {errorKind ? (
          <Pressable style={[styles.retry, { borderColor: th.accent }]} onPress={() => { reset(); setNonce((n) => n + 1); }}>
            <Text style={[styles.retryText, { color: th.accent }]}>{t('common.retry')}</Text>
          </Pressable>
        ) : null}
        <View style={styles.footer}>
          <Pressable
            style={[styles.footerBtn, { borderColor: th.accent }, mode === 'translate' && { backgroundColor: th.accent }]}
            onPress={() => openMode('translate')}
          >
            <Text style={[styles.footerText, { color: th.accent }, mode === 'translate' && { color: th.onAccent }]}>
              {t('lookup.translate')}
            </Text>
          </Pressable>
          <Pressable style={[styles.footerBtn, { borderColor: th.accent }]} onPress={onClose}>
            <Text style={[styles.footerText, { color: th.accent }]}>{t('common.cancel')}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#00000055' },
  sheet: {
    paddingTop: 16, paddingBottom: 16,
    maxHeight: '70%',
    borderTopLeftRadius: 16, borderTopRightRadius: 16,
    paddingHorizontal: 16, gap: 12,
  },
  word: { fontSize: 18, fontWeight: '700' },
  scroll: { flexGrow: 0 },
  sense: { gap: 4, marginBottom: 12 },
  pos: { fontSize: 13, fontWeight: '700', fontStyle: 'italic' },
  glossRow: { flexDirection: 'row', gap: 8 },
  bullet: { fontSize: 15, lineHeight: 21 },
  gloss: { fontSize: 15, lineHeight: 21, flexShrink: 1 },
  state: { fontSize: 15 },
  busyRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  retry: {
    alignSelf: 'flex-start', borderWidth: 1,
    borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8,
  },
  retryText: { fontWeight: '600' },
  footer: { flexDirection: 'row', gap: 12 },
  footerBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 10,
    borderRadius: 8, borderWidth: 1,
  },
  footerText: { fontSize: 15, fontWeight: '600' },
});
