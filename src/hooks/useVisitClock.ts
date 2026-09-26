import { useEffect } from 'react';
import { api } from '../api/client.js';
import { sanitizeAwayMinutes } from '../board/handover.js';
import { useVisitStore } from '../store/visit.js';

/** The settings-store key for the handover's away threshold (`{ awayMinutes }`). */
export const HANDOVER_PREFS_KEY = 'studio.handover';

/** How often a visible tab moves the visit clock. */
const HEARTBEAT_MS = 60_000;

/**
 * Keeps the visit clock (studio wave 2b). Mounted once, by App:
 *
 *  - boot: read the away threshold (`studio.handover.awayMinutes` in crew's settings
 *    store, default 30), then ARRIVE — an absence at least that long opens a handover;
 *  - while the tab is visible: a heartbeat every minute;
 *  - tab hidden / page hidden: a last heartbeat (the moment the operator left);
 *  - tab visible again: arrive — a long-hidden tab earns a handover too.
 *
 * Presence is a VISIBLE tab: a background tab left open all afternoon is an absence.
 */
export function useVisitClock(): void {
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    let thresholdMs = 0;
    const visible = (): boolean => document.visibilityState !== 'hidden';
    const onVisibility = (): void => {
      const { arrive, heartbeat } = useVisitStore.getState();
      if (visible()) arrive(Date.now(), thresholdMs);
      else heartbeat(Date.now());
    };
    const onPageHide = (): void => useVisitStore.getState().heartbeat(Date.now());

    void (async () => {
      let minutes = sanitizeAwayMinutes(undefined);
      try {
        const { settings } = await api.getAppearanceSettings();
        minutes = sanitizeAwayMinutes((settings as Record<string, unknown>)[HANDOVER_PREFS_KEY]);
      } catch {
        /* no settings surface — the default threshold stands */
      }
      if (cancelled) return;
      thresholdMs = minutes * 60_000;
      if (visible()) useVisitStore.getState().arrive(Date.now(), thresholdMs);
      timer = setInterval(() => {
        if (visible()) useVisitStore.getState().heartbeat(Date.now());
      }, HEARTBEAT_MS);
      document.addEventListener('visibilitychange', onVisibility);
      window.addEventListener('pagehide', onPageHide);
    })();

    return () => {
      cancelled = true;
      if (timer !== null) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, []);
}
