import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StatusBar, StyleSheet, Text, TextInput, View, useColorScheme } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useServices } from '../../core/services';
import { formatBytes } from '../../core/format';
import type { LanguagePref, ThemeName } from '../../core/types';
import { initI18n } from '../../i18n';
import { themeTokens } from '../../theme/tokens';
import { md5Hex } from '../../core/progress/partialMd5';
import { buildExportEntries, zipEntries } from '../../core/library/exportService';
import { saveBytesToUserDir, EXPORT_MIME } from '../../core/storage/saf';
import { createKoSyncClient, KoSyncError } from '../../core/progress/koreaderSync';
import { isKoSyncConfigured, koSyncClientFromPrefs, KO_SYNC_DEVICE } from '../../core/progress/koSyncAccount';
import { syncLibraryProgress } from '../../core/progress/koreaderSyncService';
import { LmError } from '../../core/remote/lmClient';
import { lmBeginSignIn, lmCompleteSignIn, lmDisconnect, lmIsConnected } from '../../core/remote/lmAccount';
import { createLmAccountDeps } from '../../core/storage/expoSecureStore';
import { LmAuthSheet } from './LmAuthSheet';
import { uuidV7 } from '../../core/uuid';
import { inform } from '../../ui/dialogs';
import { showToast } from '../../ui/toast';
import { useUiPrefsStore } from './uiPrefsStore';
import { useReaderSettingsStore } from './readerSettingsStore';

const LANGUAGES: { value: LanguagePref; labelKey: string }[] = [
  { value: 'auto', labelKey: 'settings.language.auto' },
  { value: 'fr', labelKey: 'settings.language.fr' },
  { value: 'en', labelKey: 'settings.language.en' },
];

const THEMES: { value: ThemeName; labelKey: string }[] = [
  { value: 'day', labelKey: 'settings.theme.day' },
  { value: 'sepia', labelKey: 'settings.theme.sepia' },
  { value: 'night', labelKey: 'settings.theme.night' },
  // 'auto' is stored as-is in both stores; resolution to day/night happens at
  // render time (reader chrome, engine cssFor fallback), never in the stores
  { value: 'auto', labelKey: 'settings.theme.auto' },
];

// LibreTranslate server's supported languages (GET /languages); native names —
// they read the same in every UI locale
const TRANSLATE_TARGETS: { code: string; label: string }[] = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'he', label: 'עברית' },
  { code: 'ar', label: 'العربية' },
];

function SectionLabel({ labelKey }: { labelKey: string }) {
  const { t } = useTranslation();
  const t0 = themeTokens(useColorScheme() === 'dark' ? 'night' : 'day');
  return <Text style={[styles.sectionLabel, { color: t0.muted }]}>{t(labelKey).toUpperCase()}</Text>;
}

function Card({ children }: { children: React.ReactNode }) {
  const t0 = themeTokens(useColorScheme() === 'dark' ? 'night' : 'day');
  return <View style={[styles.card, { backgroundColor: t0.chrome }]}>{children}</View>;
}

export function SettingsScreen() {
  const { t, i18n } = useTranslation();
  const services = useServices();
  const router = useRouter();
  const { prefs, update } = useUiPrefsStore();
  const { update: updateReaderSettings } = useReaderSettingsStore();
  const lang = i18n.language === 'fr' ? 'fr' : 'en';
  // app chrome follows the system light/dark, same as the library
  const dark = useColorScheme() === 'dark';
  const t0 = themeTokens(dark ? 'night' : 'day');
  const insets = useSafeAreaInsets();
  const [storageBytes, setStorageBytes] = useState<number | null>(null);
  // null = untouched field, falls back to the persisted prefs (the userkey is
  // the only stored secret, the raw password is never kept)
  const [koServer, setKoServer] = useState<string | null>(null);
  const [koUsername, setKoUsername] = useState<string | null>(null);
  const [koPassword, setKoPassword] = useState('');
  const [koBusy, setKoBusy] = useState(false);
  const [koSyncing, setKoSyncing] = useState(false);
  const [lmConnected, setLmConnected] = useState(false);
  const [lmBusy, setLmBusy] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [exportingAll, setExportingAll] = useState(false);
  const server = koServer ?? prefs.koreaderServer;
  const username = koUsername ?? prefs.koreaderUsername;
  const koConnected = isKoSyncConfigured(prefs);
  // tokens live in Keychain/Keystore; the prefs only carry the display name
  const lmAccount = useMemo(() => createLmAccountDeps(services.settings), [services]);

  useEffect(() => {
    void useUiPrefsStore.getState().hydrate();
  }, []);

  useEffect(() => {
    void lmIsConnected(lmAccount).then(setLmConnected);
  }, [lmAccount]);

  const koErrorMessage = (err: unknown): string => {
    if (!(err instanceof KoSyncError)) return t('settings.koreader.error');
    if (err.kind === 'network') return t('settings.koreader.network');
    if (err.kind === 'auth') return t('settings.koreader.badCredentials');
    return t('settings.koreader.error');
  };

  const koConnect = async (mode: 'login' | 'create') => {
    const serverTrimmed = server.trim();
    const usernameTrimmed = username.trim();
    if (!serverTrimmed || !usernameTrimmed || !koPassword) {
      void inform(t('settings.koreader.title'), t('settings.koreader.needFields'));
      return;
    }
    setKoBusy(true);
    try {
      const userkey = md5Hex(koPassword);
      const client = createKoSyncClient(
        { baseUrl: serverTrimmed, username: usernameTrimmed, userkey, device: KO_SYNC_DEVICE, deviceId: prefs.koreaderDeviceId || uuidV7() },
        fetch,
      );
      if (mode === 'create') {
        if ((await client.register()) === 'exists') {
          void inform(t('settings.koreader.title'), t('settings.koreader.createExists'));
          return;
        }
      } else if (!(await client.authorize())) {
        void inform(t('settings.koreader.title'), t('settings.koreader.badCredentials'));
        return;
      }
      await update({ koreaderServer: serverTrimmed, koreaderUsername: usernameTrimmed, koreaderUserkey: userkey });
      setKoPassword('');
      showToast(t(mode === 'create' ? 'settings.koreader.createOk' : 'settings.koreader.loginOk'));
    } catch (err) {
      void inform(t('settings.koreader.title'), koErrorMessage(err));
    } finally {
      setKoBusy(false);
    }
  };

  const koSyncLibrary = async () => {
    if (!koConnected) {
      void inform(t('settings.koreader.title'), t('settings.koreader.needAccount'));
      return;
    }
    setKoSyncing(true);
    try {
      const client = await koSyncClientFromPrefs(services.settings);
      const all = await services.books.listBooks({ sort: 'added' });
      const summary = await syncLibraryProgress(
        {
          readAt: (path, offset, length) => services.fs.readRange(path, offset, length),
          getProgress: (id) => services.progress.getProgress(id),
          saveProgress: (p) => services.progress.saveProgress(p),
          client,
        },
        all.map((b) => ({ id: b.id, filePath: services.paths.bookPath(b.id, b.format) })),
      );
      void inform(
        t('settings.koreader.syncTitle'),
        t('settings.koreader.syncSummary', {
          pushed: summary.pushed,
          pulled: summary.pulled,
          inSync: summary.inSync,
          conflicts: summary.conflicts,
          failed: summary.failed,
        }),
      );
    } catch (err) {
      void inform(t('settings.koreader.title'), koErrorMessage(err));
    } finally {
      setKoSyncing(false);
    }
  };

  // one-tap whole-library export: renamed files + KOReader sidecars in a zip,
  // destination chosen in the system folder picker (same flow as the library)
  const exportAll = async () => {
    setExportingAll(true);
    try {
      const all = await services.books.listBooks({ sort: 'added' });
      if (all.length === 0) {
        void inform(t('settings.exportAll'), t('settings.exportAllEmpty'));
        return;
      }
      const zip = zipEntries(await buildExportEntries({
        fs: services.fs,
        paths: services.paths,
        getProgress: (id) => services.progress.getProgress(id),
      }, all));
      const stamp = new Date().toISOString().slice(0, 10);
      const saved = await saveBytesToUserDir(`library-reader-export-${stamp}.zip`, EXPORT_MIME.zip!, zip);
      if (saved) showToast(t('library.export.done'));
    } catch (err) {
      console.warn('[settings] library export failed', err);
      void inform(t('settings.exportAll'), t('library.export.failed'));
    } finally {
      setExportingAll(false);
    }
  };

  const lmErrorMessage = (err: unknown): string => {
    if (err instanceof LmError && err.kind === 'network') return t('settings.lm.network');
    return t('settings.lm.error');
  };

  // PKCE: the authorization runs in an in-app WebView (the server's callback
  // page renders JSON instead of bouncing through verified App Links, so the
  // system-browser session never hands control back). The app only ever sees
  // the callback code; the verifier stays in the secure store.
  const lmConnect = () => {
    void (async () => {
      try {
        setAuthUrl(await lmBeginSignIn(lmAccount));
      } catch (err) {
        void inform(t('settings.lm.title'), lmErrorMessage(err));
      }
    })();
  };

  const lmAuthComplete = (callbackUrl: string) => {
    // diagnostics keep to error codes and the callback path — never query
    // values (code) nor tokens (spec §10)
    console.warn('[lm] callback captured', callbackUrl.split('?')[0]);
    setAuthUrl(null);
    void (async () => {
      setLmBusy(true);
      try {
        await lmCompleteSignIn(lmAccount, callbackUrl);
        setLmConnected(true);
        void useUiPrefsStore.getState().hydrate();
        showToast(t('settings.lm.loginOk'));
      } catch (err) {
        console.warn('[lm] sign-in failed', err instanceof LmError ? `kind=${err.kind} code=${err.code ?? 'none'} msg=${err.message}` : String(err));
        void inform(t('settings.lm.title'), lmErrorMessage(err));
      } finally {
        setLmBusy(false);
      }
    })();
  };

  const lmLogout = async () => {
    setLmBusy(true);
    try {
      await lmDisconnect(lmAccount);
      // account isolation of the cover cache (spec: private, per-account) —
      // remote thumbnails live in their own subtree, local covers are untouched
      await services.fs.remove(`${services.paths.coversDir}/remote`).catch(() => {});
      setLmConnected(false);
    } catch (err) {
      void inform(t('settings.lm.title'), lmErrorMessage(err));
    } finally {
      setLmBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    void services.fs.directorySize(services.paths.booksDir).then((n) => {
      if (!cancelled) setStorageBytes(n);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [services]);

  const version = Constants.expoConfig?.version ?? '—';

  const statusRow = (connected: boolean, label: string) => (
    <View style={styles.statusRow}>
      <Ionicons
        name={connected ? 'checkmark-circle' : 'ellipse-outline'}
        size={16}
        color={connected ? t0.accent : t0.muted}
      />
      <Text style={[styles.statusRowText, { color: connected ? t0.foreground : t0.muted }]}>{label}</Text>
    </View>
  );

  return (
    <View style={[styles.root, { backgroundColor: t0.background }]}>
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} />
      <ScrollView
        contentContainerStyle={[styles.content, styles.contentWide, { paddingTop: insets.top + 8 }]}
      >
        <View style={styles.header}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="button"
            accessibilityLabel={t('settings.back')}
            hitSlop={10}
            style={[styles.backButton, { borderColor: t0.border }]}
          >
            <Ionicons name="arrow-back" size={22} color={t0.foreground} />
          </Pressable>
          <Text style={[styles.title, { color: t0.foreground }]}>{t('settings.title')}</Text>
        </View>

        <SectionLabel labelKey="settings.section.general" />
        <Card>
          {LANGUAGES.map((option) => {
            const active = prefs.language === option.value;
            return (
              <Pressable
                key={option.value}
                style={[styles.row, active && { backgroundColor: t0.background, borderRadius: 10 }]}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                onPress={() => { void update({ language: option.value }); void initI18n(option.value); }}
              >
                <Ionicons
                  name={active ? 'radio-button-on' : 'radio-button-off'}
                  size={18}
                  color={active ? t0.accent : t0.muted}
                />
                <Text style={[styles.rowLabel, { color: t0.foreground }]}>{t(option.labelKey)}</Text>
              </Pressable>
            );
          })}
          <View style={[styles.separator, { backgroundColor: t0.border }]} />
          <Text style={[styles.cardRowLabel, { color: t0.muted }]}>{t('settings.themeLabel')}</Text>
          <View style={styles.themeRow}>
            {THEMES.map((option) => {
              const active = prefs.defaultTheme === option.value;
              return (
                <Pressable
                  key={option.value}
                  style={[styles.themeChip, { borderColor: t0.accent }, active && { backgroundColor: t0.accent }]}
                  onPress={() => {
                    // the default theme IS the (global) reader theme — both stores
                    // are updated so the choice applies immediately
                    void update({ defaultTheme: option.value });
                    void updateReaderSettings({ theme: option.value });
                  }}
                >
                  <Text style={[styles.themeChipText, { color: t0.accent }, active && { color: t0.onAccent, fontWeight: '600' }]}>{t(option.labelKey)}</Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <SectionLabel labelKey="settings.section.reading" />
        <Card>
          <Text style={[styles.cardRowLabel, { color: t0.muted }]}>{t('settings.translateTarget')}</Text>
          <View style={styles.targetRow}>
            {TRANSLATE_TARGETS.map((option) => {
              const active = prefs.translateTarget === option.code;
              return (
                <Pressable
                  key={option.code}
                  style={[styles.targetChip, { borderColor: t0.accent }, active && { backgroundColor: t0.accent }]}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  onPress={() => { void update({ translateTarget: option.code }); }}
                >
                  <Text style={[styles.targetChipText, { color: t0.accent }, active && { color: t0.onAccent, fontWeight: '600' }]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </Card>

        <SectionLabel labelKey="settings.lm.title" />
        <Card>
          <Text style={[styles.sectionHint, { color: t0.muted }]}>{t('settings.lm.hint')}</Text>
          {statusRow(lmConnected, lmConnected ? t('settings.lm.connected', { name: prefs.lmUsername }) : t('settings.lm.disconnected'))}
          <Pressable
            style={[styles.actionButton, { borderColor: t0.accent }, lmBusy && { opacity: 0.4 }]}
            disabled={lmBusy}
            onPress={() => { void (lmConnected ? lmLogout() : lmConnect()); }}
          >
            <Text style={[styles.actionButtonText, { color: t0.accent }]}>
              {lmConnected ? t('settings.lm.logout') : t('settings.lm.login')}
            </Text>
          </Pressable>
        </Card>

        <SectionLabel labelKey="settings.koreader.title" />
        <Card>
          <Text style={[styles.sectionHint, { color: t0.muted }]}>{t('settings.koreader.hint')}</Text>
          {statusRow(koConnected, koConnected ? t('settings.koreader.connected', { name: prefs.koreaderUsername }) : t('settings.koreader.disconnected'))}
          <TextInput
            style={[styles.input, { borderColor: t0.border, color: t0.foreground }]}
            placeholder={t('settings.koreader.server')}
            placeholderTextColor={t0.muted}
            value={server}
            onChangeText={setKoServer}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <TextInput
            style={[styles.input, { borderColor: t0.border, color: t0.foreground }]}
            placeholder={t('settings.koreader.username')}
            placeholderTextColor={t0.muted}
            value={username}
            onChangeText={setKoUsername}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            style={[styles.input, { borderColor: t0.border, color: t0.foreground }]}
            placeholder={t('settings.koreader.password')}
            placeholderTextColor={t0.muted}
            value={koPassword}
            onChangeText={setKoPassword}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
          <View style={styles.buttonRow}>
            <Pressable
              style={[styles.actionButton, { borderColor: t0.accent }, koBusy && { opacity: 0.4 }]}
              disabled={koBusy}
              onPress={() => { void koConnect('login'); }}
            >
              <Text style={[styles.actionButtonText, { color: t0.accent }]}>{t('settings.koreader.login')}</Text>
            </Pressable>
            <Pressable
              style={[styles.actionButton, { borderColor: t0.accent }, koBusy && { opacity: 0.4 }]}
              disabled={koBusy}
              onPress={() => { void koConnect('create'); }}
            >
              <Text style={[styles.actionButtonText, { color: t0.accent }]}>{t('settings.koreader.create')}</Text>
            </Pressable>
          </View>
          <Pressable
            style={[styles.syncButton, { backgroundColor: t0.accent }, (koSyncing || koBusy) && { opacity: 0.4 }]}
            disabled={koSyncing || koBusy}
            onPress={() => { void koSyncLibrary(); }}
          >
            <Text style={[styles.syncButtonText, { color: t0.onAccent }]}>
              {koSyncing ? t('settings.koreader.syncing') : t('settings.koreader.sync')}
            </Text>
          </Pressable>
        </Card>

        <SectionLabel labelKey="settings.section.data" />
        <Card>
          <Text style={[styles.sectionHint, { color: t0.muted }]}>{t('settings.exportAllHint')}</Text>
          <Pressable
            style={[styles.syncButton, { backgroundColor: t0.accent }, exportingAll && { opacity: 0.4 }]}
            disabled={exportingAll}
            onPress={() => { void exportAll(); }}
            accessibilityRole="button"
            accessibilityLabel={t('settings.exportAll')}
          >
            {exportingAll ? (
              <ActivityIndicator size="small" color={t0.onAccent} />
            ) : (
              <Text style={[styles.syncButtonText, { color: t0.onAccent }]}>{t('settings.exportAllAction')}</Text>
            )}
          </Pressable>
          <View style={[styles.separator, { backgroundColor: t0.border }]} />
          <View style={styles.infoRow}>
            <Text style={[styles.rowLabel, { color: t0.foreground }]}>{t('settings.storage')}</Text>
            <Text style={[styles.infoValue, { color: t0.muted }]}>{storageBytes === null ? null : formatBytes(storageBytes, lang)}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={[styles.rowLabel, { color: t0.foreground }]}>{t('settings.about')}</Text>
            <Text style={[styles.infoValue, { color: t0.muted }]}>{version}</Text>
          </View>
        </Card>

        <LmAuthSheet
          visible={authUrl !== null}
          url={authUrl ?? ''}
          onClose={() => setAuthUrl(null)}
          onComplete={lmAuthComplete}
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  content: { paddingHorizontal: 16, paddingBottom: 32, gap: 8 },
  // centered column on Fold inner display / tablets — form controls keep a
  // comfortable width instead of stretching across a 800+ dp window
  contentWide: { width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 12 },
  backButton: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 26, fontWeight: '800', letterSpacing: -0.4 },
  sectionLabel: { fontSize: 12, fontWeight: '800', letterSpacing: 1.2, marginTop: 14, marginBottom: 6, paddingHorizontal: 4 },
  card: { borderRadius: 16, padding: 12, gap: 10 },
  separator: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  cardRowLabel: { fontSize: 13, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10 },
  rowLabel: { fontSize: 15 },
  themeRow: { flexDirection: 'row', gap: 8 },
  themeChip: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 10, borderWidth: 1 },
  themeChipText: { fontSize: 14 },
  targetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  targetChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  targetChipText: { fontSize: 14 },
  infoRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  infoValue: { fontSize: 15, fontVariant: ['tabular-nums'] },
  sectionHint: { fontSize: 13, lineHeight: 18 },
  input: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  buttonRow: { flexDirection: 'row', gap: 8 },
  actionButton: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 12, borderWidth: 1 },
  actionButtonText: { fontSize: 14, fontWeight: '600' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  statusRowText: { fontSize: 14 },
  syncButton: { alignItems: 'center', paddingVertical: 13, borderRadius: 12 },
  syncButtonText: { fontSize: 14, fontWeight: '700' },
});
