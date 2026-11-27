import { create } from 'zustand';
import { deskSnoozeApi, type DeskSnooze } from '../api/deskSnooze-wire.js';
import { ApiError, apiStatus, isRouteUnsupported } from '../api/errors.js';

/**
 * The Needs-you snoozes in force (crew#1124), read once when the inbox opens and again after each change. A daemon
 * from before the snooze route answers an unknown-route 404: `phase: 'unsupported'`, and the inbox offers no snooze. A read that fails
 * otherwise, the first or a later one, hides nothing (every row shows) and offers no snooze until a read succeeds; the
 * inbox tries again on its next minute.
 */

type Phase = 'idle' | 'loading' | 'ready' | 'unsupported' | 'failed';

interface State {
  phase: Phase;
  byKey: Record<string, DeskSnooze>;
  /** (studio#1430) When this page last woke each key, on this browser's clock: a crew hold with that key is trusted only
   *  from a /system read asked after it. */
  wokeAt: Readonly<Record<string, number>>;
  load: () => Promise<void>;
  /** Snooze one item; resolves with null when done, else the words saying why not. */
  snooze: (key: string, until: string, severity: number) => Promise<string | null>;
  /** End a snooze now; resolves with null when done, else the words saying why not. */
  wake: (key: string) => Promise<string | null>;
}

let readSeq = 0;

function refusal(e: unknown, doing: 'snooze' | 'wake'): string {
  const code = e instanceof ApiError && typeof e.body === 'object' && e.body !== null ? (e.body as { code?: unknown }).code : undefined;
  if (code === 'human_operator_only' || apiStatus(e) === 403) return 'Only a person can snooze or wake an item; an agent cannot.';
  if (code === 'desk_snooze_invalid') return 'That end time was refused: a snooze ends in the future, at most a week ahead.';
  return doing === 'snooze' ? 'Couldn’t snooze it just now. Nothing changed.' : 'Couldn’t wake it just now. Nothing changed.';
}

export const useDeskSnoozes = create<State>((set, get) => ({
  phase: 'idle',
  byKey: {},
  wokeAt: {},
  load: async () => {
    const mine = ++readSeq;
    if (get().phase === 'idle') set({ phase: 'loading' });
    try {
      const { snoozes } = await deskSnoozeApi.list();
      if (mine !== readSeq) return;
      set({ phase: 'ready', byKey: Object.fromEntries((Array.isArray(snoozes) ? snoozes : []).map((s) => [s.key, s])) });
    } catch (e) {
      if (mine !== readSeq) return;
      if (isRouteUnsupported(e)) set({ phase: 'unsupported', byKey: {} });
      else set({ phase: 'failed', byKey: {} });
    }
  },
  snooze: async (key, until, severity) => {
    try {
      const s = await deskSnoozeApi.snooze(key, { until, severity });
      set((st) => ({ byKey: { ...st.byKey, [s.key]: s } }));
      void get().load(); // starts a new read, so one already in flight is dropped when it answers
      return null;
    } catch (e) {
      return refusal(e, 'snooze');
    }
  },
  wake: async (key) => {
    try {
      await deskSnoozeApi.wake(key);
      set((st) => { const byKey = { ...st.byKey }; delete byKey[key]; return { byKey, wokeAt: { ...st.wokeAt, [key]: Date.now() } }; });
      void get().load();
      return null;
    } catch (e) {
      return refusal(e, 'wake');
    }
  },
}));

/** Test seam. */
export function resetDeskSnoozes(): void {
  readSeq += 1;
  useDeskSnoozes.setState({ phase: 'idle', byKey: {}, wokeAt: {} });
}
