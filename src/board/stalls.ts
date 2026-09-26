import type { SessionView } from '../api/types.js';
import { useRuntimeStore } from '../store/runtime.js';
import { isStalled } from './boardAttention.js';

/** Statuses that mean the run is moving under its own power (the board model's `ACTIVE`). */
const ACTIVE: ReadonlySet<string> = new Set(['planning', 'distributing', 'executing']);

/**
 * The freshest activity evidence for a run: its newest streamed frame (read NON-reactively off
 * the runtime store — callers recompute on their own tick) or its durable tail, whichever is
 * later. Shared by the board model and the app-level needs-you fold (`useNeedsRows`), so the queue's
 * stall verdict never forks from the board's.
 */
export function activityEvidence(lastEventAt: Record<string, number>): (id: string) => number | undefined {
  return (id) => {
    const log = useRuntimeStore.getState().logs[id];
    const frame = log !== undefined && log.length > 0 ? log[log.length - 1]?.ts : undefined;
    const tail = lastEventAt[id];
    if (frame === undefined) return tail;
    return tail === undefined ? frame : Math.max(frame, tail);
  };
}

/** Live runs gone silent past the stall threshold: run id → the last activity evidence. */
export function stalledRuns(
  runs: readonly SessionView[],
  evidenceAt: (id: string) => number | undefined,
  now: number,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of runs) {
    if (!ACTIVE.has(v.session.status)) continue;
    const ev = evidenceAt(v.session.id);
    if (isStalled(ev, now)) out[v.session.id] = ev!;
  }
  return out;
}
