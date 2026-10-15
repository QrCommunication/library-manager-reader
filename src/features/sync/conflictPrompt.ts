// Explicit reading-position conflict choice (mobile API §8): both positions
// with their version and date, re-read from the server each time. Choosing
// the local side sends a NEW operation against the re-read revision; when
// that write conflicts again the question is asked again — never a silent
// overwrite of the other device, never a clock or max-percentage rule.

import i18next from 'i18next';
import type { AppServices } from '../../core/services';
import {
  describeReadingConflict, hasReadingConflict, resolveReadingConflict,
} from '../../core/remote/readingSync';
import type { ConflictView } from '../../core/remote/progressReconcile';
import type { ReadingProgress } from '../../core/types';
import { alert as dialogAlert } from '../../ui/dialogs';

const dateLabel = (ms: number): string =>
  ms > 0 ? new Date(ms).toLocaleString(i18next.language || undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—';
const versionLabel = (id: string | undefined): string => (id ? id.slice(0, 8) : '—');
const pct = (f: number | undefined): number => Math.round((f ?? 0) * 100);

export function conflictMessage(title: string, view: ConflictView): string {
  return i18next.t('library.remote.conflictBody', {
    title,
    server: pct(view.server?.percentage),
    serverDate: dateLabel(view.server?.updatedAtMs ?? 0),
    serverVersion: versionLabel(view.server?.versionId || view.versionId),
    local: pct(view.local?.fraction),
    localDate: dateLabel(view.local?.updatedAt ?? 0),
    localVersion: versionLabel(view.versionId),
  });
}

const ask = (title: string, view: ConflictView): Promise<'server' | 'local' | null> =>
  new Promise((resolve) => {
    dialogAlert(i18next.t('library.remote.conflictTitle'), conflictMessage(title, view), [
      { text: i18next.t('library.remote.conflictServer'), onPress: () => resolve('server') },
      { text: i18next.t('library.remote.conflictLocal'), onPress: () => resolve('local') },
      // postponed: the book's sync stays paused until the next prompt
      { text: i18next.t('library.remote.conflictLater'), style: 'cancel', onPress: () => resolve(null) },
    ]);
  });

export type ConflictPromptResult =
  | { kind: 'server'; progress: ReadingProgress }
  | { kind: 'local' }
  | { kind: 'postponed' };

/** asks until the user picks a side that sticks, or postpones */
export async function promptReadingConflict(services: AppServices, bookId: string, title: string): Promise<ConflictPromptResult> {
  for (let round = 0; round < 10; round++) {
    const view = await describeReadingConflict(services, bookId).catch(() => null);
    if (!view) return { kind: 'postponed' };
    const choice = await ask(title, view);
    if (choice === null) return { kind: 'postponed' };
    try {
      const applied = await resolveReadingConflict(services, bookId, choice);
      if (choice === 'server' && applied) return { kind: 'server', progress: applied };
      if (!(await hasReadingConflict(services, bookId))) return { kind: 'local' };
      // the new write met yet another device: ask again with fresh data
    } catch (err) {
      console.warn('[sync] conflict resolution failed', err);
      return { kind: 'postponed' };
    }
  }
  return { kind: 'postponed' };
}
