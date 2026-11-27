import type { CoreEvent, SessionView, WorkUnit } from '../api/types.js';
import { arrivedAt } from '../store/events.js';
import { phaseLabel } from '../components/gateVerdictModel.js';
import { stepLabelOf } from './chainModel.js';

/**
 * A SCRIPTED STEP IS WORKING, NOT SILENT (studio#1499; J6 v3 Run B, train 18): a Tool-executor step (a unit with a
 * `tool_cmd`, which the engine runs as a command, not a seat's turn) writes its output only when it ends. A healthy
 * 35-min domain run was called "No output for 7 min", offered "Move it to another helper", and listed in Needs you as
 * "the run may be wedged". There is no helper to ask or move, and quiet is that step's normal state: the page says
 * "Domain run is working · 31 min" instead, keeps it out of Needs you, and leaves Stop as the one lever.
 *
 * The engine bounds no Tool step except an estate index (wicked-core#2034), so a script that really hangs is not
 * flagged here; that bound belongs to the engine.
 *
 * Pure: the run view (and its event log when the caller holds one) in, the scripted step running now out.
 */

export interface ScriptedStep {
  ord: number;
  /** The step's name, from its unit key (`run:domain-run` → "Domain run"): never the command or its output. */
  label: string;
  /** Whole minutes since the step's newest attempt was dispatched, or null when no log names that dispatch. */
  minutes: number | null;
}

type Ev = CoreEvent & Record<string, unknown>;

/** A run's newest live output delta: the step it came from and when it arrived (the runtime store's delta clock). */
export interface StepDelta { ord: number; at: number }

/** Frames that end a unit's attempt (its turn or command is over). */
const UNIT_ENDED: ReadonlySet<string> = new Set(['unitDone', 'stepFailed', 'unitDenied', 'unitOutputCaptured']);
const RUN_ENDED: ReadonlySet<string> = new Set(['sessionCompleted', 'sessionFailed', 'runCancelled']);
/** Frames that mean a step is being worked (a gate's frames for an earlier step are not): the newest one names the step
 *  the run is on, whatever window of the log this page holds (coord ruling on the #1499 DES). */
const UNIT_ACTIVE: ReadonlySet<string> = new Set(['unitDispatched', 'unitExecuting', 'toolExecutorDispatched', 'unitOutputDelta', 'unitOutputCaptured', 'powerTurnStarted']);

/** The unit the run is on: the cursor (`unit_ix`, an index into the units in order), else the first handed out and not
 *  finished. The same pick as {@link silentStep}'s. */
function runningUnit(view: SessionView): WorkUnit | null {
  const ix = (view.session as unknown as { unit_ix?: unknown }).unit_ix;
  const ordered = [...view.units].sort((a, b) => a.ord - b.ord);
  return (typeof ix === 'number' ? ordered[ix] : undefined) ?? ordered.find((u) => u.status === 'distributed') ?? null;
}

/** The Tool unit under the run's cursor, read against the log when the caller holds one: null when the run is not
 *  executing, the cursor's unit is a seat's (no `tool_cmd`), the log's newest step activity is another step's (the view
 *  lags the log), or the log's newest word is the run's end. `ended`: the log shows that unit's newest attempt over (a
 *  closing frame, even with no dispatch in the log's window). */
function toolCursor(view: SessionView, events: readonly CoreEvent[] | null | undefined, delta: StepDelta | null = null): { unit: WorkUnit; dispatchedAt: number | null; ended: boolean } | null {
  if (view.session.status !== 'executing') return null;
  const unit = runningUnit(view);
  if (unit === null || unit.status !== 'distributed' || !Array.isArray(unit.tool_cmd) || unit.tool_cmd.length === 0) return null;
  let dispatchedAt: number | null = null;
  let ended = false;
  let attempt = -1;
  let activeOrd: number | null = null;
  let runEnded = false;
  let ownAt: number | null = null;
  for (const e of (events ?? []) as readonly Ev[]) {
    // A run's end closes the claim; a later dispatch (a resumed run) opens it again.
    if (RUN_ENDED.has(e.type)) { runEnded = true; continue; }
    if (typeof e.ord !== 'number') continue;
    if (e.type === 'unitDispatched') runEnded = false;
    if (UNIT_ACTIVE.has(e.type)) activeOrd = e.ord;
    if (e.ord !== unit.ord) continue;
    ownAt = typeof e.ts === 'number' ? e.ts : arrivedAt(e) ?? ownAt;
    if (e.type === 'unitDispatched') {
      attempt = typeof e.attempt === 'number' ? e.attempt : attempt + 1;
      ended = false;
      dispatchedAt = typeof e.ts === 'number' ? e.ts : arrivedAt(e);
    } else if (UNIT_ENDED.has(e.type) && (typeof e.attempt !== 'number' || e.attempt >= attempt)) {
      // A late frame from an attempt the engine moved past never closes the newest one.
      ended = true;
    }
  }
  if (runEnded || (activeOrd !== null && activeOrd !== unit.ord)) return null;
  // studio#1507: another step's live output (never logged) newer than anything the log holds for this one: that step is
  // working, whatever the view's cursor says.
  if (delta !== null && delta.ord !== unit.ord && (ownAt === null || delta.at >= ownAt)) return null;
  return { unit, dispatchedAt, ended };
}

/** The scripted step running now, or null: no Tool unit under the cursor ({@link toolCursor}), or the log shows its
 *  newest attempt over. */
export function scriptedStep(view: SessionView, events: readonly CoreEvent[] | null | undefined, now: number, delta: StepDelta | null = null): ScriptedStep | null {
  const c = toolCursor(view, events, delta);
  if (c === null || c.ended) return null;
  // The chain's own step word, as the run page names the working step (`run:domain-run` → "Domain run").
  const label = stepLabelOf(phaseLabel(view.session.id, view.units, c.unit.ord));
  return { ord: c.unit.ord, label, minutes: c.dispatchedAt === null ? null : Math.max(0, Math.floor((now - c.dispatchedAt) / 60_000)) };
}

/** The cursor's step is a Tool unit, working or just over (its output captured, its gate running): no seat runs it,
 *  so a seat's levers ("Ask", "Move it to another helper") never apply. */
export function toolStepOnCursor(view: SessionView, events: readonly CoreEvent[] | null | undefined): boolean {
  return toolCursor(view, events) !== null;
}

/** The header's and the Now panel's words: "Domain run is working · 31 min". */
export function scriptedWords(s: ScriptedStep): string {
  return s.minutes === null ? `${s.label} is working` : `${s.label} is working · ${s.minutes} min`;
}

/** The run's running step is scripted, by its view and the run's log (a surface with crew's liveness verdict): crew's
 *  quiet verdict is then not a silent seat. */
export function runsScript(view: SessionView | undefined, events: readonly CoreEvent[] | null | undefined, delta: StepDelta | null = null): boolean {
  return view !== undefined && scriptedStep(view, events, 0, delta) !== null;
}
