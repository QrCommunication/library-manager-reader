// Reader side of the Library Manager reading sync (mobile API §8):
//  - a conflict parked by the journal (409 / replay window) or found at open
//    is presented as an explicit choice once the book is displayed;
//  - back in the foreground the server is re-read: a fast-forward moves the
//    page (with a notice), a divergence asks.
// Opening itself already reconciled (useReaderSession's progress read).

import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import i18next from 'i18next';
import type { AppServices } from '../../core/services';
import { onProgressConflict } from '../../core/remote/liveSync';
import { hasReadingConflict, reconcileReadingPosition } from '../../core/remote/readingSync';
import { promptReadingConflict } from '../sync/conflictPrompt';
import { showToast } from '../../ui/toast';
import type { BridgeLike } from './useReaderSession';

export function useReadingSync(
  services: AppServices | null,
  bookId: string,
  bridge: Pick<BridgeLike, 'goToPosition'> | null,
  ready: boolean,
  title: string | null,
): void {
  const prompting = useRef(false);

  const prompt = useCallback(async () => {
    if (!services || !bridge || prompting.current) return;
    prompting.current = true;
    try {
      const result = await promptReadingConflict(services, bookId, title ?? '');
      if (result.kind === 'server') {
        bridge.goToPosition({ xpointer: result.progress.xpointer ?? null, fraction: result.progress.fraction });
      }
    } finally {
      prompting.current = false;
    }
  }, [services, bridge, bookId, title]);

  useEffect(() => {
    if (!ready || !services || !bridge) return;
    let alive = true;
    void hasReadingConflict(services, bookId).then((c) => { if (c && alive) void prompt(); }).catch(() => {});
    const off = onProgressConflict((b) => { if (b === bookId) void prompt(); });
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      void reconcileReadingPosition(services, bookId).then((r) => {
        if (!alive) return;
        if (r.kind === 'pulled') {
          bridge.goToPosition({ xpointer: r.progress.xpointer ?? null, fraction: r.progress.fraction });
          showToast(i18next.t('reader.syncPulled'), 'info');
        } else if (r.kind === 'conflict') {
          void prompt();
        }
      });
    });
    return () => { alive = false; off(); sub.remove(); };
  }, [ready, services, bridge, bookId, prompt]);
}
