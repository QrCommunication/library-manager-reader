import { DatabaseSync } from 'node:sqlite';
import { createNodeSqliteDriver } from '../nodeSqliteDriver';
import { migrate } from '../migrate';
import { createSettingsRepo } from '../settingsRepo';
import { DEFAULT_READER_SETTINGS, DEFAULT_UI_PREFS } from '../../core/types';

const setup = async () => {
  const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
  await migrate(db);
  return createSettingsRepo(db);
};

describe('settingsRepo', () => {
  it('returns defaults when nothing stored', async () => {
    const repo = await setup();
    expect(await repo.getReaderSettings()).toEqual(DEFAULT_READER_SETTINGS);
    expect(await repo.getUiPrefs()).toEqual(DEFAULT_UI_PREFS);
  });

  it('persists and re-reads reader settings and ui prefs', async () => {
    const repo = await setup();
    await repo.putReaderSettings({ ...DEFAULT_READER_SETTINGS, theme: 'night', fontSize: 22 });
    await repo.putUiPrefs({ ...DEFAULT_UI_PREFS, language: 'fr', defaultTheme: 'sepia' });
    expect((await repo.getReaderSettings()).theme).toBe('night');
    expect(await repo.getUiPrefs()).toEqual({ ...DEFAULT_UI_PREFS, language: 'fr', defaultTheme: 'sepia' });
  });

  it('never lets a stored row override the shipped LibreTranslate server', async () => {
    // every pre-#17 build persisted libreTranslateUrl 'https://libretranslate.com'
    // with an empty key whenever the user saved any pref (theme, language…);
    // the Réglages inputs are gone, so those stale values must not shadow the
    // shipped shared server (they made every translation 401 → "service a échoué")
    const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
    await migrate(db);
    await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [
      'uiPrefs',
      JSON.stringify({ language: 'fr', defaultTheme: 'sepia', libreTranslateUrl: 'https://libretranslate.com', libreTranslateApiKey: '' }),
      1,
    ]);
    const repo = createSettingsRepo(db);
    const prefs = await repo.getUiPrefs();
    expect(prefs.defaultTheme).toBe('sepia');
    expect(prefs.libreTranslateUrl).toBe('https://translate.rlconseil.net');
    expect(prefs.libreTranslateApiKey).toBe('73d6bbf4-eaba-4bbf-ad82-d58f9ccba23d');
  });

  it('merges the translateTarget default into a stored pre-field prefs row', async () => {
    const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
    await migrate(db);
    await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', ['uiPrefs', JSON.stringify({ language: 'fr' }), 1]);
    const repo = createSettingsRepo(db);
    const prefs = await repo.getUiPrefs();
    expect(prefs.translateTarget).toBe('fr');
  });

  it('merges new ttsRate/brightness defaults into a stored pre-tts readerSettings row', async () => {
    const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
    await migrate(db);
    await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', ['readerSettings', JSON.stringify({ fontFamily: 'serif', fontSize: 18 }), 1]);
    const repo = createSettingsRepo(db);
    const settings = await repo.getReaderSettings();
    expect(settings.ttsRate).toBe(1);
    expect(settings.brightness).toBe(0);
    expect(settings.fontSize).toBe(18);
  });

  it('returns full defaults when a stored row is corrupted instead of crashing', async () => {
    const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
    await migrate(db);
    await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', ['readerSettings', '{not json', 1]);
    await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', ['uiPrefs', '"notanobject', 1]);
    const repo = createSettingsRepo(db);
    expect(await repo.getReaderSettings()).toEqual(DEFAULT_READER_SETTINGS);
    expect(await repo.getUiPrefs()).toEqual(DEFAULT_UI_PREFS);
  });
});
