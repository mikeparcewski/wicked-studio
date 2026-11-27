import type { CoreEvent, SessionView } from '../api/types.js';
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

/** Frames that end a unit's attempt (its turn or command is over). */
const UNIT_ENDED: ReadonlySet<string> = new Set(['unitDone', 'stepFailed', 'unitDenied', 'unitOutputCaptured']);
const RUN_ENDED: ReadonlySet<string> = new Set(['sessionCompleted', 'sessionFailed', 'runCancelled']);

/** The unit the run is on: the cursor (`unit_ix`, an index into the units in order), else the first handed out and not
 *  finished. The same pick as {@link silentStep}'s. */
function runningUnit(view: SessionView): SessionView['units'][number] | null {
  const ix = (view.session as unknown as { unit_ix?: unknown }).unit_ix;
  const ordered = [...view.units].sort((a, b) => a.ord - b.ord);
  return (typeof ix === 'number' ? ordered[ix] : undefined) ?? ordered.find((u) => u.status === 'distributed') ?? null;
}

/** The scripted step running now, or null: the run is not executing, its running step is a seat's (no `tool_cmd`), or
 *  the log shows that step's newest attempt over or another step dispatched after it (the view lags the log). */
export function scriptedStep(view: SessionView, events: readonly CoreEvent[] | null | undefined, now: number): ScriptedStep | null {
  if (view.session.status !== 'executing') return null;
  const unit = runningUnit(view);
  if (unit === null || unit.status !== 'distributed' || !Array.isArray(unit.tool_cmd) || unit.tool_cmd.length === 0) return null;
  let dispatchedAt: number | null = null;
  if (events != null) {
    // The newest dispatch in the log, of any step, and this step's newest attempt: whether it is still open.
    let newestOrd: number | null = null;
    let attempt = -1;
    let open = false;
    for (const e of events as readonly Ev[]) {
      if (RUN_ENDED.has(e.type)) return null;
      if (e.ord !== unit.ord) {
        if (e.type === 'unitDispatched' && typeof e.ord === 'number') newestOrd = e.ord;
        continue;
      }
      if (e.type === 'unitDispatched') {
        newestOrd = unit.ord;
        attempt = typeof e.attempt === 'number' ? e.attempt : attempt + 1;
        open = true;
        dispatchedAt = typeof e.ts === 'number' ? e.ts : null;
      } else if (UNIT_ENDED.has(e.type) && (typeof e.attempt !== 'number' || e.attempt >= attempt)) {
        // A late frame from an attempt the engine moved past never closes the newest one.
        open = false;
      }
    }
    if (newestOrd !== null && newestOrd !== unit.ord) return null;
    if (attempt >= 0 && !open) return null;
  }
  // The chain's own step word, as the run page names the working step (`run:domain-run` → "Domain run").
  const label = stepLabelOf(phaseLabel(view.session.id, view.units, unit.ord));
  return { ord: unit.ord, label, minutes: dispatchedAt === null ? null : Math.max(0, Math.floor((now - dispatchedAt) / 60_000)) };
}

/** The header's and the Now panel's words: "Domain run is working · 31 min". */
export function scriptedWords(s: ScriptedStep): string {
  return s.minutes === null ? `${s.label} is working` : `${s.label} is working · ${s.minutes} min`;
}

/** The run's running step is scripted, by its view alone (a surface with crew's liveness but no event log): crew's
 *  quiet verdict is then not a silent seat. */
export function runsScript(view: SessionView | undefined): boolean {
  return view !== undefined && scriptedStep(view, null, 0) !== null;
}
