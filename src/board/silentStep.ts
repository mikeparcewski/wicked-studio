import { isPowerPaused } from './heldRuns.js';
import type { CoreEvent, SessionView } from '../api/types.js';

/**
 * THE RUN PAGE SAYS WHEN A STEP HAS GONE SILENT (J4 0.16.6: the run page said "Working" through a 25-30 min silent worker
 * turn while Nerve Center said stalled). Pure: the run, its event log and the newest live frame's arrival time in, the
 * silence out. Crew calls a run quiet after 5 min without an event and stalled after 15 (`/system` runs' `quietAfterMs`
 * / `stallAfterMs`); the page says "No output for N min" from the quiet mark on, so it never reads "Working" over a step
 * that has said nothing.
 */

/** Crew's quiet mark (`quietAfterMs`, 5 min): past it the page says how long the step has been silent. */
export const SILENT_AFTER_MS = 5 * 60_000;

/** Frames that are the daemon talking ABOUT the silence, not the step working: they never reset the clock. */
const NOT_ACTIVITY: ReadonlySet<string> = new Set(['workerStalled', 'workerStallEscalated', 'workerStallRecovered']);

export interface SilentStep {
  /** Whole minutes since the step last said anything (≥ 5). */
  minutes: number;
  /** The step that is running, when the run names one. */
  ord: number | null;
  /** The seat running it, when the run names one. */
  cli: string | null;
}

/** The newest activity time in a run's log (unix ms), or null when no frame carries a time. */
export function lastActivityAt(events: readonly CoreEvent[]): number | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (NOT_ACTIVITY.has(e.type)) continue;
    if (typeof e.ts === 'number') return e.ts;
  }
  return null;
}

/** How long the run's running step has been silent, or null when it is not executing, waits on a question, or spoke in
 *  the last {@link SILENT_AFTER_MS}. `liveAt`: the newest live frame's arrival time (live frames carry no `ts`). */
export function silentStep(view: SessionView, events: readonly CoreEvent[] | null | undefined, now: number, opts: { gateOpen?: boolean; liveAt?: number | null } = {}): SilentStep | null {
  // A power run paused at a checkpoint waits on you: its quiet is the pause, not a silent step.
  if (view.session.status !== 'executing' || opts.gateOpen === true || isPowerPaused(view.session)) return null;
  const logged = lastActivityAt(events ?? []);
  const at = Math.max(logged ?? 0, opts.liveAt ?? 0);
  if (at === 0) return null;
  const quiet = now - at;
  if (quiet < SILENT_AFTER_MS) return null;
  // The cursor unit (`unit_ix`, an index into the units in order: run 115fabdb's 5 is ord 6), else the first one handed out and not finished.
  const ix = (view.session as unknown as { unit_ix?: unknown }).unit_ix;
  const ordered = [...view.units].sort((a, b) => a.ord - b.ord);
  const unit = (typeof ix === 'number' ? ordered[ix] : undefined) ?? ordered.find((u) => u.status === 'distributed') ?? null;
  const cli = typeof unit?.assigned_cli === 'string' && unit.assigned_cli !== '' ? unit.assigned_cli : null;
  return { minutes: Math.floor(quiet / 60_000), ord: unit?.ord ?? null, cli };
}

/** The header's and the thread's words: "No output for 21 min". */
export function silentWords(s: SilentStep): string {
  return `No output for ${s.minutes} min`;
}
