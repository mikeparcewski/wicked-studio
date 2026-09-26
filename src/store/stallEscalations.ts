import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';
import type { StallEscalationLite } from '../board/needsYou.js';

/**
 * The stall watchdog's escalations that NEED A HUMAN, keyed by run id (studio wave 2b —
 * the needs-you queue's `stall-escalated` rows).
 *
 * Event-sourced off `/ws`: `workerStallEscalated` with `needsYou: true` opens (or
 * refreshes) the run's record; the same frame with `needsYou` false (a later recovery
 * worked), fresh unit progress, or a terminal frame retires it. Live-only, like the frame
 * itself — crew does not append these frames to the run log, so a reload cannot replay
 * them (narrator.ts, `workerStallEscalated`); the board's own stalled-run verdict still
 * covers a silent run after a reload.
 */

/** Frames that mean the run moved again or ended — the escalation no longer stands. */
const RETIRES: ReadonlySet<string> = new Set([
  'unitExecuting', 'unitDone', 'unitOutputCaptured', 'resumed',
  'sessionCompleted', 'sessionFailed', 'runCancelled', 'sessionCancelled',
]);

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

interface StallEscalationStore {
  escalations: Record<string, StallEscalationLite>;
  ingest: (event: CoreEvent) => void;
}

export const useStallEscalationStore = create<StallEscalationStore>((set) => ({
  escalations: {},

  ingest: (event) => {
    const runId = typeof event.session === 'string' ? event.session : undefined;
    if (runId === undefined) return;
    const bag = event as unknown as Record<string, unknown>;
    if (event.type === 'workerStallEscalated' && bag['needsYou'] === true) {
      const quiet = bag['quietForMs'];
      set((s) => ({
        escalations: {
          ...s.escalations,
          [runId]: {
            at: Date.now(),
            quietForMs: typeof quiet === 'number' ? quiet : null,
            action: str(bag['action']),
            outcome: str(bag['outcome']),
            cli: str(bag['cli']),
            previousCli: str(bag['previousCli']),
          },
        },
      }));
      return;
    }
    const retires = RETIRES.has(event.type) || event.type === 'workerStallEscalated';
    if (!retires) return;
    set((s) => {
      if (!(runId in s.escalations)) return s;
      const next = { ...s.escalations };
      delete next[runId];
      return { escalations: next };
    });
  },
}));
