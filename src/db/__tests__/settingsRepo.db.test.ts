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
    await repo.putUiPrefs({ language: 'fr', defaultTheme: 'sepia' });
    expect((await repo.getReaderSettings()).theme).toBe('night');
    expect(await repo.getUiPrefs()).toEqual({ language: 'fr', defaultTheme: 'sepia' });
  });
});
