import { create } from 'zustand';

/**
 * Per-session view state that must survive switching sessions and coming back (R4): the
 * composer's unsent draft and the thread's scroll position. In memory for the tab's life — a
 * reload starts clean, like every other composer in studio.
 */
interface SessionDraftsStore {
  drafts: Record<string, string>;
  scroll: Record<string, number>;
  setDraft: (sessionId: string, text: string) => void;
  setScroll: (sessionId: string, top: number) => void;
}

export const useSessionDrafts = create<SessionDraftsStore>((set) => ({
  drafts: {},
  scroll: {},
  setDraft: (sessionId, text) => set((s) => ({ drafts: { ...s.drafts, [sessionId]: text } })),
  setScroll: (sessionId, top) => set((s) => ({ scroll: { ...s.scroll, [sessionId]: top } })),
}));

/** When the operator last opened each session (R2's "since you left"), across reloads. */
export const SESSION_VISITS_KEY = 'studio.sessionVisits';

export function readSessionVisit(sessionId: string): number | null {
  try {
    const raw = window.localStorage.getItem(SESSION_VISITS_KEY);
    const all = raw === null ? {} : (JSON.parse(raw) as Record<string, unknown>);
    const v = all[sessionId];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** Stamp a visit; keeps the newest 200 sessions so the key never grows without bound. */
export function writeSessionVisit(sessionId: string, at: number): void {
  try {
    const raw = window.localStorage.getItem(SESSION_VISITS_KEY);
    const all = raw === null ? {} : (JSON.parse(raw) as Record<string, number>);
    all[sessionId] = at;
    const kept = Object.entries(all)
      .filter(([, v]) => typeof v === 'number')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 200);
    window.localStorage.setItem(SESSION_VISITS_KEY, JSON.stringify(Object.fromEntries(kept)));
  } catch {
    /* storage unavailable: no since-you-left card, never an error */
  }
}
