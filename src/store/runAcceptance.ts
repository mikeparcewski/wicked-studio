import { create } from 'zustand';
import { api } from '../api/client.js';
import type { RunAcceptanceView } from '../api/types.js';

/**
 * The acceptance view of the runs a session shows (WT-U2): `GET /runs/:id/acceptance`, read for ONE
 * run at a time when its block mounts with a walkthrough step or a deliver gate, and again when the
 * run moves (its status or unit changes) — the per-step `checkState` and the deliver card's line are
 * computed by crew at every read, never stored, so a step that was just proved reads "checked" on
 * the next move. One read per run at a time; an ask that arrives while a read is in flight re-reads
 * once it lands. `null` = the read failed (an unknown run, a refused read): nothing is drawn — the
 * chain keeps "done", the card keeps its own sentence; neither is a plausible verdict.
 *
 * Distinct from `store/acceptance.ts` (the scoreboard's verdict chips, loaded behind one explicit
 * gesture, cached for good): this one follows the open session and refreshes.
 */

interface RunAcceptanceStore {
  byRun: Record<string, RunAcceptanceView | null>;
  read: (runId: string) => Promise<void>;
}

const inflight = new Map<string, { p: Promise<void>; again: boolean }>();

export const useRunAcceptanceStore = create<RunAcceptanceStore>((set) => {
  const once = (runId: string): Promise<void> => api.getRunAcceptance(runId)
    .then((v) => { set((s) => ({ byRun: { ...s.byRun, [runId]: v } })); })
    .catch(() => { set((s) => ({ byRun: { ...s.byRun, [runId]: null } })); });
  return {
    byRun: {},
    read: (runId) => {
      const running = inflight.get(runId);
      if (running !== undefined) { running.again = true; return running.p; }
      const entry = { p: Promise.resolve(), again: false };
      entry.p = (async () => {
        do {
          entry.again = false;
          await once(runId);
        } while (entry.again);
        inflight.delete(runId);
      })();
      inflight.set(runId, entry);
      return entry.p;
    },
  };
});

/** Tests: start from nothing. */
export function resetRunAcceptanceForTest(): void {
  inflight.clear();
  useRunAcceptanceStore.setState({ byRun: {} });
}
