import { create } from 'zustand';
import type { CoreEvent } from '../api/types.js';

/**
 * The raw per-run append log the {@link import('../hooks/useRunModel.js').useRunModel}
 * merge folds over. Distinct from the runtime store (which owns high-volume output text +
 * a summarized event log): this keeps the *structured* frames the insight merge needs —
 * lifecycle + the Phase-B insight events — so the merge stays a pure function of them.
 *
 * `cliOutputDelta` (streamed by the runtime store into `outputs`) and heartbeats are
 * dropped here — they carry no structured insight and would flood the buffer.
 */

/**
 * Ring-buffer cap per run (keep the most recent). Set well above any realistic run's STRUCTURED-frame
 * count: the high-volume `cliOutputDelta` + `heartbeat` are excluded (see `IGNORED`), so what remains is
 * lifecycle + the low-volume insight events (tens per unit). The cap is only a pathological-spam backstop;
 * a normal run never approaches it, so the burn/data totals (which fold these frames) never silently lose
 * an early `cliUsage`/`dataUsed` to eviction. If a run ever DID exceed this, only the oldest lifecycle
 * frames drop first (appended-newest), and Burn already captions totals "(partial)" for any non-terminal
 * or pending/no-adapter seat.
 */
const CAP = 50000;

const IGNORED: ReadonlySet<string> = new Set(['cliOutputDelta', 'heartbeat']);

interface RunEventStore {
  /** Ordered, capped structured frames keyed by run id. */
  byRun: Record<string, CoreEvent[]>;
  /** Fold one CoreEvent (drops output deltas / heartbeats / run-less frames). */
  ingest: (event: CoreEvent) => void;
  /** Drop a run's log. */
  clear: (runId: string) => void;
}

export const useRunEventStore = create<RunEventStore>((set) => ({
  byRun: {},

  ingest: (event) => {
    const session = typeof event.session === 'string' ? event.session : undefined;
    if (session === undefined) return;
    if (IGNORED.has(event.type)) return;
    set((s) => {
      const prev = s.byRun[session] ?? [];
      const next = [...prev, event];
      if (next.length > CAP) next.splice(0, next.length - CAP);
      return { byRun: { ...s.byRun, [session]: next } };
    });
  },

  clear: (runId) =>
    set((s) => {
      if (!(runId in s.byRun)) return s;
      const byRun = { ...s.byRun };
      delete byRun[runId];
      return { byRun };
    }),
}));
