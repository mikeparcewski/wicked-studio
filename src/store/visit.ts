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

/**
 * The handover's PROGRESS — what it has listed and what the operator has acted on, for the absence
 * being handed over (`since`). Kept beside the visit clock, not in it: the arrival rules stay as
 * they were, and a progress record for an older absence is simply ignored. Persisted under
 * `studio.handover.progress` so a reload (or a round trip to a run's page) keeps what was done.
 * `board/handover.ts` (`handoverSettled`) decides when that clears the handover.
 */
export const PROGRESS_KEY = 'studio.handover.progress';

export interface HandoverProgress {
  since: number | null;
  /** Every item key the handover has listed for this absence. */
  listed: string[];
  /** Every item key the operator acted on. */
  acted: string[];
}

const NO_PROGRESS: HandoverProgress = { since: null, listed: [], acted: [] };

function readProgress(): HandoverProgress {
  try {
    const raw: unknown = JSON.parse(window.localStorage.getItem(PROGRESS_KEY) ?? 'null');
    if (raw === null || typeof raw !== 'object') return NO_PROGRESS;
    const o = raw as Record<string, unknown>;
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    return { since: typeof o.since === 'number' ? o.since : null, listed: strings(o.listed), acted: strings(o.acted) };
  } catch {
    return NO_PROGRESS;
  }
}

function writeProgress(p: HandoverProgress): void {
  try {
    window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch {
    /* best-effort, like the visit clock */
  }
}

interface ProgressStore extends HandoverProgress {
  /** Note the keys the handover lists now (a union — a resolved item stays "was listed"). */
  noteListed: (since: number, keys: readonly string[]) => void;
  /** The operator pressed a verb on this item. A no-op when no handover is open. */
  markActed: (key: string) => void;
}

/** The progress for `since`: the stored record when it is for this absence, else a fresh one. */
function forSince(since: number): HandoverProgress {
  const p = readProgress();
  return p.since === since ? p : { since, listed: [], acted: [] };
}

export const useHandoverProgress = create<ProgressStore>((set) => ({
  ...readProgress(),

  noteListed: (since, keys) => {
    const p = forSince(since);
    const fresh = keys.filter((k) => !p.listed.includes(k));
    if (fresh.length === 0 && readProgress().since === since) {
      set(p);
      return;
    }
    const next = { ...p, listed: [...p.listed, ...fresh] };
    writeProgress(next);
    set(next);
  },

  markActed: (key) => {
    const since = useVisitStore.getState().handover?.since ?? null;
    if (since === null) return;
    const p = forSince(since);
    if (p.acted.includes(key)) return;
    const next = { ...p, acted: [...p.acted, key] };
    writeProgress(next);
    set(next);
  },
}));
