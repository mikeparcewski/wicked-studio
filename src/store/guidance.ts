import { create } from 'zustand';
import { api } from '../api/client.js';

/**
 * The durable-guidance layer (DES-UX-002 §8.1 slice BE): CREW-UX-7 adoption
 * (crew#312 — the doc's "CREW-UX-4", renamed; see api/guidance.ts). Two jobs:
 *
 * 1. `saved` — the client's mirror of the run's durable note between a
 *    successful PUT and the next `/runs` refetch, so the widget shows the
 *    saved truth immediately. `''` here means CLEARED (the DTO drops the
 *    field after a clear, so the mirror must out-vote a stale DTO echo);
 *    `undefined` means "no local write — trust the DTO".
 * 2. `saveState` — per-run point-of-action feedback for the save gesture
 *    (EC37): saving → saved / a named error, rendered beside the button that
 *    fired it, never a global toast.
 */

export type SavePhase =
  | { phase: 'saving' }
  | { phase: 'saved'; at: number }
  | { phase: 'error'; detail: string };

interface GuidanceStore {
  /** Durable-note mirror by run id — see the module doc for the '' contract. */
  saved: Record<string, string>;
  /** The save gesture's point-of-action state, by run id. */
  saveState: Record<string, SavePhase>;
  /** PUT the note (upsert; `''` clears). Resolves the stores; never throws. */
  save: (runId: string, text: string) => Promise<void>;
}

export const useGuidanceStore = create<GuidanceStore>((set) => ({
  saved: {},
  saveState: {},

  save: async (runId, text) => {
    set((s) => ({ saveState: { ...s.saveState, [runId]: { phase: 'saving' } } }));
    try {
      // The daemon echoes what it stored ('' after a clear) — mirror THAT,
      // not what we sent, so the mirror is the wire's word.
      const { guidance } = await api.putGuidance(runId, text);
      set((s) => ({
        saved: { ...s.saved, [runId]: guidance },
        saveState: { ...s.saveState, [runId]: { phase: 'saved', at: Date.now() } },
      }));
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      set((s) => ({ saveState: { ...s.saveState, [runId]: { phase: 'error', detail } } }));
    }
  },
}));

/**
 * The run's durable note as this client currently knows it: the local mirror
 * out-votes the DTO echo (it is newer), the DTO answers otherwise. `''` and
 * `undefined` both mean "no note" to a reader; they differ only in provenance.
 */
export function durableGuidance(
  runId: string,
  dtoGuidance: string | undefined,
  mirror: Record<string, string>,
): string | undefined {
  const local = mirror[runId];
  return local !== undefined ? local : dtoGuidance;
}
