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

  it('merges new libreTranslate defaults into a stored pre-v1.x prefs row', async () => {
    const db = createNodeSqliteDriver(new DatabaseSync(':memory:'));
    await migrate(db);
    await db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', ['uiPrefs', JSON.stringify({ language: 'fr' }), 1]);
    const repo = createSettingsRepo(db);
    const prefs = await repo.getUiPrefs();
    expect(prefs.language).toBe('fr');
    // shipped translation endpoint: the shared community server, key included —
    // translation works out of the box, a stored custom URL still wins
    expect(prefs.libreTranslateUrl).toBe('https://translate.rlconseil.net');
    expect(prefs.libreTranslateApiKey).toBe('73d6bbf4-eaba-4bbf-ad82-d58f9ccba23d');
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
