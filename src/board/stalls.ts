import type { CoreEvent, SessionView } from '../api/types.js';
import { useRunEventStore } from '../store/events.js';
import { useRuntimeStore } from '../store/runtime.js';
import { useSystemStore } from '../store/systemSnapshot.js';
import { CREW_FRESH_MS, lastLoggedActivity } from './silentStep.js';
import { isStalled } from './boardAttention.js';
import { scriptedStep } from './scriptedStep.js';

/** Statuses that mean the run is moving under its own power (the board model's `ACTIVE`). */
const ACTIVE: ReadonlySet<string> = new Set(['planning', 'distributing', 'executing']);

/** This page's newest live evidence for a run (unix ms): a logged frame that is activity (the log holds no heartbeat,
 *  studio#1368; the daemon's stall talk is skipped) or streamed output. Read NON-reactively off the runtime store. */
export function liveEvidenceAt(runId: string): number | null {
  const s = useRuntimeStore.getState();
  const at = Math.max(lastLoggedActivity(s.logs[runId]) ?? 0, s.deltaAt[runId] ?? 0);
  return at === 0 ? null : at;
}

/** Crew's own evidence for a run from a fresh `/system` answer (unix ms): its last event, or its busy processes, which
 *  no heartbeat moves (crew#1501). Read NON-reactively. */
function crewEvidenceAt(runId: string, now: number): number | null {
  const s = useSystemStore.getState();
  if (s.mode !== 'system' || s.snapshotAt === null || now - s.snapshotAt > CREW_FRESH_MS) return null;
  const run = s.snapshot?.runs.find((r) => r.runId === runId);
  return run === undefined || run.quietForMs === null ? null : s.snapshotAt - run.quietForMs;
}

/**
 * The freshest activity evidence for a run: its newest streamed frame or output (read NON-reactively off the runtime
 * store — callers recompute on their own tick), its durable tail, or crew's own evidence, whichever is later. Shared
 * by the board model and the app-level needs-you fold (`useNeedsRows`), so the queue's stall verdict never forks from
 * the board's.
 */
export function activityEvidence(lastEventAt: Record<string, number>): (id: string) => number | undefined {
  return (id) => {
    const at = Math.max(liveEvidenceAt(id) ?? 0, lastEventAt[id] ?? 0, crewEvidenceAt(id, Date.now()) ?? 0);
    return at === 0 ? undefined : at;
  };
}

/** A run's log as this page holds it (every live frame since load, and the durable trail once a surface read it), read
 *  NON-reactively, as the evidence is. */
export function runLogOf(runId: string): readonly CoreEvent[] | undefined {
  return useRunEventStore.getState().byRun[runId];
}

/** Live runs gone silent past the stall threshold: run id → the last activity evidence. */
export function stalledRuns(
  runs: readonly SessionView[],
  evidenceAt: (id: string) => number | undefined,
  now: number,
  logOf: (id: string) => readonly CoreEvent[] | undefined = runLogOf,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const v of runs) {
    if (!ACTIVE.has(v.session.status)) continue;
    // studio#1499: a scripted (Tool) step is quiet until it ends: not a wedge, and not a need (`scriptedStep.ts`).
    // The run's log (every live frame since load, plus the trail of a run opened) says when the view lags it.
    if (scriptedStep(v, logOf(v.session.id), now) !== null) continue;
    const ev = evidenceAt(v.session.id);
    if (isStalled(ev, now)) out[v.session.id] = ev!;
  }
  return out;
}
