import type { CoreEvent } from '../api/types.js';
import { arrivedAt } from '../store/events.js';
import { floorLineOf } from './floorLine.js';

/**
 * THE ENGINE'S CHECKS FLOOR IS RUNNING (retime 0.16.11, 2026-10-30): during every floor the run page said "No output for
 * 30 min from Claude Code" and offered "Move it to another helper", while the seat was idle and the engine ran the
 * repository's checks. A floor is the engine's work, not the seat's turn: the page says "Running checks · test · 12 min"
 * and offers no reassign. Pure: the run's event log (which keeps the floor's own lines, `floorLine.ts`) in, the floor
 * running now out.
 *
 * A floor starts at its first line for a unit and ends at its result (`repoChecksEvaluated`) or at anything that means
 * the unit moved on (a new dispatch or turn, the unit's end, the run's end).
 */

export interface RunningFloor {
  ord: number;
  /** The check running now, when the floor's newest line names it. */
  check: string | null;
  /** Whole minutes since the floor started. */
  minutes: number;
  /** When the floor started (unix ms). */
  since: number;
}

type Ev = CoreEvent & Record<string, unknown>;

const UNIT_MOVED_ON: ReadonlySet<string> = new Set(['repoChecksEvaluated', 'unitDispatched', 'powerTurnStarted', 'unitDone', 'unitDenied', 'stepFailed']);
const RUN_ENDED: ReadonlySet<string> = new Set(['sessionCompleted', 'sessionFailed', 'runCancelled']);

const timeOf = (e: Ev): number | null => (typeof e.ts === 'number' ? e.ts : arrivedAt(e));

/** The floor running now (the newest one still open), or null. */
export function runningFloor(events: readonly CoreEvent[] | null | undefined, now: number): RunningFloor | null {
  const open = new Map<number, { since: number; check: string | null; seen: number }>();
  let n = 0;
  for (const e of (events ?? []) as readonly Ev[]) {
    n += 1;
    if (RUN_ENDED.has(e.type)) { open.clear(); continue; }
    if (typeof e.ord !== 'number') continue;
    if (UNIT_MOVED_ON.has(e.type)) { open.delete(e.ord); continue; }
    if (e.type !== 'unitOutputDelta') continue;
    const line = floorLineOf(e.text);
    if (line === null) continue;
    const at = timeOf(e) ?? now;
    const cur = open.get(e.ord);
    if (cur === undefined) open.set(e.ord, { since: at - line.minutes * 60_000, check: line.check, seen: n });
    else { cur.check = line.check; cur.seen = n; }
  }
  let best: { ord: number; since: number; check: string | null; seen: number } | null = null;
  for (const [ord, f] of open) if (best === null || f.seen > best.seen) best = { ord, ...f };
  if (best === null) return null;
  return { ord: best.ord, check: best.check, since: best.since, minutes: Math.max(0, Math.floor((now - best.since) / 60_000)) };
}

/** "Running checks · test · 12 min". */
export function floorWords(f: RunningFloor): string {
  return `Running checks${f.check !== null ? ` · ${f.check}` : ''} · ${f.minutes} min`;
}
