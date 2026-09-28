import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';
import type { StallEscalationLite } from '../board/needsYou.js';

/**
 * The stall watchdog's escalations that NEED A HUMAN, keyed by run id (studio wave 2b —
 * the needs-you queue's `stall-escalated` rows).
 *
 * Event-sourced off `/ws`: `workerStallEscalated` with `needsYou: true` opens (or
 * refreshes) the run's record; the same frame with `needsYou` false (a later recovery
 * worked), fresh unit progress, or a terminal frame retires it.
 *
 * Reload-safe (studio#284): crew serves the watchdog's frames in `GET /runs/:id/events`
 * (`api/stall-frame-index.ts`, `daemon: true`, capture-time `ts`), so when a run's log is
 * hydrated the store {@link StallEscalationStore.replay}s it through {@link needsYouOf} — the
 * same fold the run page's needs-you card reads.
 */

/** Frames that mean the run moved again or ended — the escalation no longer stands. */
const RETIRES: ReadonlySet<string> = new Set([
  'unitExecuting', 'unitDone', 'unitOutputCaptured', 'resumed',
  'sessionCompleted', 'sessionFailed', 'runCancelled', 'sessionCancelled',
]);

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** One automatic recovery the watchdog made (`action: 'reassign'`, `outcome: 'ok'`). */
export interface StallRecovery {
  previousCli: string | null;
  cli: string | null;
}

/** A run's standing "needs you" state, folded from its event log. */
export interface NeedsYouState extends StallEscalationLite {
  /** The cursor unit the watchdog escalated, when the frame names it. */
  ord: number | null;
  /** Every automatic recovery made on this run so far, oldest first. */
  recoveries: StallRecovery[];
}

/**
 * The run's standing needs-you escalation, or null: the LATEST `workerStallEscalated` with
 * `needsYou: true` that no later frame retired (progress, a terminal frame, or a watchdog frame
 * saying it recovered). Pure over the run's ordered log — live frames and the reload's
 * `GET /runs/:id/events` answer fold the same way.
 */
export function needsYouOf(events: readonly CoreEvent[]): NeedsYouState | null {
  let state: NeedsYouState | null = null;
  const recoveries: StallRecovery[] = [];
  for (const event of events) {
    const bag = event as unknown as Record<string, unknown>;
    if (event.type === 'workerStallEscalated') {
      if (bag['action'] === 'reassign' && bag['outcome'] === 'ok') {
        recoveries.push({ previousCli: str(bag['previousCli']), cli: str(bag['cli']) });
      }
      if (bag['needsYou'] === true) {
        state = {
          at: num(bag['ts']) ?? Date.now(),
          ord: num(bag['ord']),
          quietForMs: num(bag['quietForMs']),
          action: str(bag['action']),
          outcome: str(bag['outcome']),
          cli: str(bag['cli']),
          previousCli: str(bag['previousCli']),
          recoveries: [],
        };
      } else {
        state = null;
      }
      continue;
    }
    if (RETIRES.has(event.type)) state = null;
  }
  return state === null ? null : { ...state, recoveries };
}

interface StallEscalationStore {
  escalations: Record<string, StallEscalationLite>;
  ingest: (event: CoreEvent) => void;
  /** Re-derive a run's record from its whole ordered log (the reload path). */
  replay: (runId: string, events: readonly CoreEvent[]) => void;
}

export const useStallEscalationStore = create<StallEscalationStore>((set) => ({
  escalations: {},

  replay: (runId, events) => {
    const state = needsYouOf(events);
    set((s) => {
      if (state === null) {
        if (!(runId in s.escalations)) return s;
        const next = { ...s.escalations };
        delete next[runId];
        return { escalations: next };
      }
      const { at, quietForMs, action, outcome, cli, previousCli } = state;
      return { escalations: { ...s.escalations, [runId]: { at, quietForMs, action, outcome, cli, previousCli } } };
    });
  },

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
