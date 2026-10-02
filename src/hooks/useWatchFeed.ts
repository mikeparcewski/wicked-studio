import { useEffect } from 'react';
import { api } from '../api/client.js';
import type { WatchKind } from '../api/watch-wire.js';
import { useConnectionStore } from '../store/connection.js';
import { useWatchStore, watchFeed, type WatchRow } from '../store/watch.js';

/**
 * The Watchtower's late join (DES-TRIGGER-REGISTRY-001 §4.10, TR-W8): ONE `GET /watch` page when the
 * socket connects, and again after each reconnect (`/ws` replays nothing), folded into
 * `store/watch.ts` beside what App folds live. Mounted once, by App. A daemon before the registry
 * answers 404: the fold is then what studio folds itself (watchdog, team findings, finished and
 * delivered runs).
 */
export function useWatchHydrate(): void {
  const connected = useConnectionStore((s) => s.status === 'connected');
  useEffect(() => {
    if (!connected) return;
    let cancelled = false;
    api.getWatch({ limit: 200 })
      .then((resp) => { if (!cancelled) useWatchStore.getState().hydrate(resp); })
      .catch(() => { /* no registry on this daemon: the feed is studio's own fold */ });
    return () => { cancelled = true; };
  }, [connected]);
}

/** The Watchtower's rows, newest first, filtered by project and kind (S14 renders them). */
export function useWatchFeed(filter: { project?: string | null; kind?: WatchKind | null } = {}): WatchRow[] {
  const fold = useWatchStore((s) => s.fold);
  return watchFeed(fold, filter);
}
