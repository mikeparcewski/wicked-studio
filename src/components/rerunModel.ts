import type { CoreEvent, GateDecision, WorkUnit } from '../api/types.js';
import { phaseLabel } from './gateVerdictModel.js';

/**
 * "Rerun from here" on the run's phase breadcrumb (brainstorm-actionable idea 6). Pure: the run's
 * units, its open gate and its event log in, one offer (or none) out — zero requests.
 *
 * The mechanism is the engine's own, reached through the route every gate answer takes
 * (`POST /runs/:id/gate {approve:false, action:'request_changes', ord}`): wicked-core's
 * `rewind_to_creator` rewinds a PAUSED run to the gated unit when it is a creator, else to the most
 * recent creator before it, and re-arms every unit from there on. That is exactly one phase per
 * open gate, so the breadcrumb offers it on exactly that phase — never on a phase the engine would
 * not rewind to, and never on a finished run (the engine has no rewind for a terminal run; a
 * terminal run's lever stays the retry launch).
 *
 * The consequence is shown before the move: what is kept (the phases before the target), what is
 * redone (the target through the last phase) and roughly how long that took last time, from the
 * run's own recorded event times.
 */

export interface RerunOffer {
  /** The unit the run rewinds to: the phase the breadcrumb offers "Rerun from here" on. */
  ord: number;
  phase: string;
  /** Phases whose output is kept, in order (consecutive repeats folded). */
  kept: string[];
  /** Phases that run again, target first. */
  redone: string[];
  /** Minutes the redone phases took last time, rounded up; `null` when none of them was timed. */
  minutes: number | null;
  /** Redone phases with no recorded duration (not run yet, or no event times). */
  untimed: string[];
  /** The consequence line, shown before the move. */
  consequence: string;
  /** The body the move sends on `POST /runs/:id/gate`. */
  decision: GateDecision;
}

export interface RerunInput {
  runId: string;
  status: string;
  units: readonly WorkUnit[];
  /** The open gate's ord (the gate store's record); `undefined` = no gate known. */
  gateOrd: number | undefined;
  /** The open gate's prompt, when known. */
  prompt?: string | undefined;
  /** The engine's gate kind (the live frame's, else the log's `awaitingHuman`), when known. */
  gateKind?: string | null | undefined;
  events: readonly CoreEvent[];
}

/** Gate kinds whose `request_changes` is not a rewind of the work (or is refused outright). */
const NOT_A_REWIND: ReadonlySet<string> = new Set(['plan_approval', 'team_dispute', 'team_transport']);
/** Unit statuses of a unit that has not run: there is nothing of it to rerun. */
const NOT_RUN: ReadonlySet<string> = new Set(['pending', 'distributed']);
/** The events that end a unit's work, its check run included: the output, the floor's record (the repository's own checks
 *  run AFTER the output is captured, and on a red base they are most of the time), the verdict and the escalation.
 *  `unitDone` counts only when none of those came: it can land after the operator's answer, which is not the step's time. */
const WORK_ENDS: ReadonlySet<string> = new Set(['unitOutputCaptured', 'repoChecksEvaluated', 'gateEvaluated', 'gateEscalated', 'unitDenied', 'stepFailed']);

/** The gate kind the log's newest `awaitingHuman` for `ord` names, else `null`. */
export function gateKindFromLog(events: readonly CoreEvent[], ord: number | undefined): string | null {
  if (ord === undefined) return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]! as CoreEvent & { gateKind?: unknown };
    if (e.type === 'awaitingHuman' && e.ord === ord) return typeof e.gateKind === 'string' ? e.gateKind : null;
  }
  return null;
}

/**
 * The unit a `request_changes` at this gate rewinds to — wicked-core's own rule: the gated unit
 * when it is a creator, else the newest creator before it. `null` when there is none.
 */
export function rewindTarget(units: readonly WorkUnit[], gateOrd: number): WorkUnit | null {
  const cursor = units.find((u) => u.ord === gateOrd);
  if (cursor === undefined) return null;
  if (cursor.role === 'creator') return cursor;
  const before = units.filter((u) => u.ord < gateOrd && u.role === 'creator').sort((a, b) => b.ord - a.ord);
  return before[0] ?? null;
}

/**
 * How long each unit took, in ms, from the run's own recorded event times (J4 0.16.6: "Redo from the fix step · about
 * 6 min" for a step whose check run took 40). Each attempt runs from its `unitDispatched` to the last event that ends its
 * work ({@link WORK_ENDS}: the check run included, the operator's wait not); a unit's time is its LONGEST finished attempt
 * (a no-change retry that re-ran nothing is not what a redo costs). Live frames carry no `ts`, so a unit whose events
 * were not replayed from the log is simply absent.
 */
export function unitDurations(events: readonly CoreEvent[]): Map<number, number> {
  const out = new Map<number, number>();
  const open = new Map<number, { t0: number; end: number | null; done: number | null }>();
  const close = (ord: number): void => {
    const a = open.get(ord);
    if (a === undefined) return;
    const end = a.end ?? a.done;
    if (end !== null && end >= a.t0) out.set(ord, Math.max(out.get(ord) ?? 0, end - a.t0));
    open.delete(ord);
  };
  for (const e of events) {
    if (typeof e.ord !== 'number' || typeof e.ts !== 'number') continue;
    if (e.type === 'unitDispatched') {
      close(e.ord);
      open.set(e.ord, { t0: e.ts, end: null, done: null });
      continue;
    }
    const a = open.get(e.ord);
    if (a === undefined) continue;
    if (WORK_ENDS.has(e.type)) a.end = e.ts;
    else if (e.type === 'unitDone' && a.end === null) a.done = e.ts;
    // The operator's answer ends the attempt: whatever follows is the next attempt's (or the operator's wait).
    if (e.type === 'awaitingHuman' || e.type === 'gateDecided') { if (a.end === null && e.type === 'awaitingHuman') a.end = e.ts; close(e.ord); }
  }
  for (const ord of [...open.keys()]) close(ord);
  return out;
}

function fold(names: readonly string[]): string[] {
  return names.filter((n, i) => i === 0 || names[i - 1] !== n);
}

/** The "Rerun from here" offer for the run's open gate, or `null` when the engine has none. */
export function rerunOffer(input: RerunInput): RerunOffer | null {
  const { runId, status, units, gateOrd, prompt, events } = input;
  if (status !== 'awaiting_human' || gateOrd === undefined) return null;
  const kind = input.gateKind ?? gateKindFromLog(events, gateOrd);
  if (kind !== null && NOT_A_REWIND.has(kind)) return null;
  if (prompt !== undefined && /^\s*Approve plan rev\b/i.test(prompt)) return null;

  const cursor = units.find((u) => u.ord === gateOrd);
  const target = rewindTarget(units, gateOrd);
  if (cursor === undefined || target === null || NOT_RUN.has(target.status)) return null;
  // A failed deliver (a push or a lift conflict) is not fixed by redoing the work; the gate card's
  // own remedy governs it. The gate BEFORE deliver runs is fine: the work is what gets redone.
  if (phaseLabel(runId, units, cursor.ord) === 'deliver' && !NOT_RUN.has(cursor.status)) return null;

  const ordered = [...units].sort((a, b) => a.ord - b.ord);
  const name = (u: WorkUnit) => phaseLabel(runId, units, u.ord);
  const keptUnits = ordered.filter((u) => u.ord < target.ord);
  const redoneUnits = ordered.filter((u) => u.ord >= target.ord);
  const kept = fold(keptUnits.map(name));
  const redone = fold(redoneUnits.map(name));

  const took = unitDurations(events);
  let ms = 0;
  let timed = 0;
  const untimed: string[] = [];
  for (const u of redoneUnits) {
    const d = took.get(u.ord);
    if (d === undefined) {
      if (!untimed.includes(name(u))) untimed.push(name(u));
    } else {
      ms += d;
      timed += 1;
    }
  }
  const minutes = timed === 0 ? null : Math.max(1, Math.ceil(ms / 60000));

  const keeps = kept.length > 0 ? `Keeps ${kept.join(', ')}` : 'Keeps nothing';
  const redoes = `redoes ${redone.join(' → ')}`;
  const time = minutes === null
    ? 'no past durations to estimate from'
    : `~${minutes} min from past durations${untimed.length > 0 ? ` (${untimed.join(', ')} not timed yet)` : ''}`;
  return {
    ord: target.ord,
    phase: name(target),
    kept,
    redone,
    minutes,
    untimed,
    consequence: `${keeps}, ${redoes}, ${time}`,
    decision: { approve: false, action: 'request_changes' },
  };
}
