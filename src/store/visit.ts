import { create } from 'zustand';
import { arriveState, NO_VISIT, type VisitState } from '../board/handover.js';

/**
 * The operator's visit clock (studio wave 2b, "handover on arrival"): when they were
 * last here, and the absence that earned a handover they have not dismissed yet.
 *
 * Browser-local on purpose — "when did THIS person last look" is a per-browser fact,
 * not daemon state — and persisted in localStorage under `studio.visit`, so a reload
 * neither loses the pending handover nor re-opens a dismissed one. The rules live in
 * `board/handover.ts` (`arriveState`); this store only applies and persists them.
 */

export const VISIT_KEY = 'studio.visit';

function read(): VisitState {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(VISIT_KEY) ?? 'null');
    if (raw === null || typeof raw !== 'object') return NO_VISIT;
    const o = raw as Record<string, unknown>;
    const h = o.handover as Record<string, unknown> | null | undefined;
    return {
      lastSeenAt: typeof o.lastSeenAt === 'number' ? o.lastSeenAt : null,
      handover:
        h != null && typeof h.since === 'number' && typeof h.at === 'number'
          ? { since: h.since, at: h.at }
          : null,
    };
  } catch {
    return NO_VISIT;
  }
}

function write(v: VisitState): void {
  try {
    window.localStorage.setItem(VISIT_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable (private mode, quota) — the visit clock is best-effort */
  }
}

interface VisitStore extends VisitState {
  /** The operator arrived (boot, or the tab became visible again). */
  arrive: (now: number, thresholdMs: number) => void;
  /** Still here — move the clock. A gap of at least `thresholdMs` since the last beat is
   *  an absence the tab saw itself (the machine slept with the tab visible, no hidden
   *  event): it is judged as an arrival first, so the handover is not overwritten. */
  heartbeat: (now: number, thresholdMs: number) => void;
  /** Dismiss the handover: it does not return until the next absence. */
  dismiss: () => void;
}

export const useVisitStore = create<VisitStore>((set, get) => ({
  ...NO_VISIT,

  arrive: (now, thresholdMs) => {
    // Re-read: another tab may have moved the clock since this one loaded.
    const next = arriveState(read(), now, thresholdMs);
    write(next);
    set(next);
  },

  heartbeat: (now, thresholdMs) => {
    const prev = read();
    const next: VisitState = prev.lastSeenAt !== null && now - prev.lastSeenAt >= thresholdMs
      ? arriveState(prev, now, thresholdMs)
      : { ...prev, lastSeenAt: now };
    write(next);
    set(next);
  },

  dismiss: () => {
    const next: VisitState = { ...read(), handover: null, lastSeenAt: get().lastSeenAt ?? Date.now() };
    write(next);
    set({ handover: null });
  },
}));
