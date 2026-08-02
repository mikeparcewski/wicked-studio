import type { AgentSession, SessionView, WorkUnit } from './types.js';

/**
 * Which unit of a run is actually executing (FINDING-052).
 *
 * `UnitStatus` has no executing state — it is `pending | distributed | done | rejected`. The whole
 * plan is routed up front (`wicked-core/src/pipeline.rs`, the distribution loop sets
 * `UnitStatus::Distributed` on every unit before any of them runs), so `distributed` means "routed
 * to a CLI", never "running". Reading it as "running" made a run parked at a human gate render five
 * unstarted units as `Working…` and report them as in-flight.
 *
 * The cursor is the missing signal, and it is already on the DTO. `session.unit_ix` is a 0-based
 * index into the ord-ordered units (`actor.rs`: `units.get(session.unit_ix)`), and it advances only
 * once a unit returns output. So at most ONE unit per run is executing — the one under the cursor —
 * and only while the run is `executing`. Every other `distributed` unit is queued, whatever the run
 * is doing.
 *
 * `awaiting_human` deserves the explicit note because it is the case that was wrong: core defines it
 * as "Paused BEFORE a not-yet-done unit", so on a paused run even the cursor unit has not started.
 * It is excluded by the same rule as `planning` and `distributing` — not a special case.
 *
 * Takes `session` + `units` rather than a `SessionView` so callers that hold them separately (the
 * run page) don't have to allocate a wrapper on every render.
 */

/** The `ord` of the unit currently executing in this run, or `null` when nothing is. */
export function executingOrd(session: AgentSession, units: WorkUnit[]): number | null {
  if (session.status !== 'executing') return null;
  // Sort by ord to match core's ordering, which is what `unit_ix` indexes into.
  const ordered = [...units].sort((a, b) => a.ord - b.ord);
  const cursor = ordered[session.unit_ix];
  if (cursor === undefined) return null;
  // A cursor sitting on a finished unit means the run is between steps, not inside one.
  if (cursor.status === 'done' || cursor.status === 'rejected') return null;
  return cursor.ord;
}

/**
 * Units executing across a set of runs. At most one per run, so this is also the busy-run count.
 *
 * One `executingOrd` per run, not per unit. There is deliberately no `isUnitExecuting(unit)` helper:
 * the obvious way to use one is from inside a render loop, which re-sorts the plan for every unit it
 * draws. Callers hoist the ord once and compare against it.
 */
export function unitsInFlight(views: SessionView[]): number {
  return views.reduce((sum, v) => sum + (executingOrd(v.session, v.units) === null ? 0 : 1), 0);
}
