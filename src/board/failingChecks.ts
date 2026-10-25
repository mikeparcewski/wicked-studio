import type { CoreEvent, SessionView } from '../api/types.js';
import { checkOutcome, floorOf, type GateFloorCheck, type GateFloorView } from '../components/gateVerdictModel.js';
import { durableFloorOverrides, type AssuranceReceipt } from './assuranceModel.js';

/**
 * What failed, on the card's face (rig 0.15.8, 2026-10-25): a failed repository-checks floor named only
 * "test: exit 1" on the card, and the failing tests sat under Technical details. And once the operator
 * overrode such a floor, the hand-over still read green "Accepted: the checks this run had to pass have
 * passed" above the list that said test failed. Both read the engine's own floor record
 * (`repoChecksEvaluated`); nothing here is inferred from prose.
 */

/** How many failing tests the face names before "+N more". */
export const FACE_MAX = 5;

/** The classifications that say the check failed on the run's base as well (wicked-core#469 and on). */
const ON_BASE = new Set(['pre_existing_in_sandbox', 'floor_env_mismatch', 'base_red_unseparated', 'unclassified_red_base']);

/** A failure id as the runner printed it, without its status word or pytest's trailing message:
 *  `FAILED tests/a.py::t - AssertionError` → `tests/a.py::t`. Only a pytest id (`path::test`) has its
 *  ` - <message>` cut: a ` - ` inside another runner's test name is part of the name. */
export function failureName(id: string): string {
  const bare = id.trim().replace(/^(?:FAILED|FAIL|ERROR|✗|×)\s+/, '');
  return bare.replace(/^(\S*::.*?)\s+-\s+.*$/, '$1').trim();
}

export interface FailingOnFace {
  /** Up to {@link FACE_MAX} names: failing tests where the runner's output named them, else the check. */
  names: string[];
  /** How many more failed beyond `names`. */
  more: number;
}

/** The failing checks of a floor, the ones the floor counts as failed (a pre-existing failure the engine
 *  separated from the change is not one). */
export function failedChecks(floor: GateFloorView | null | undefined): GateFloorCheck[] {
  return floor === null || floor === undefined ? [] : floor.checks.filter((c) => !checkOutcome(c).ok);
}

/** The face's failing list for a floor: each failed check's tests (`failureIds`), or the check's own name
 *  when the runner's output named none. `null` when nothing failed. */
export function failingOnFace(floor: GateFloorView | null | undefined, max = FACE_MAX): FailingOnFace | null {
  const all: string[] = [];
  for (const c of failedChecks(floor)) {
    const ids = [...new Set((c.failureIds ?? []).map(failureName).filter((x) => x !== ''))];
    if (ids.length > 0) all.push(...ids);
    else all.push(`the ${c.name} check`);
  }
  if (all.length === 0) return null;
  return { names: all.slice(0, max), more: Math.max(0, all.length - max) };
}

/** The face's line: "Failing: a, b, c +2 more". */
export function failingLine(f: FailingOnFace): string {
  return `Failing: ${f.names.join(', ')}${f.more > 0 ? ` +${f.more} more` : ''}`;
}

/** Whether a failed check failed on the base too (the engine compared, or ran the base and it failed). */
export function failedOnBase(c: GateFloorCheck): boolean {
  return (c.classification !== null && ON_BASE.has(c.classification)) || c.preExisting.length > 0 || c.baseFailed === true;
}

/** The floor record of one unit attempt (`repoChecksEvaluated` for that ord and attempt), newest first. */
function floorAt(events: readonly CoreEvent[], ord: number, attempt: number | null): GateFloorView | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== 'repoChecksEvaluated' || e.ord !== ord) continue;
    const f = floorOf(e);
    if (attempt === null || f.attempt === null || f.attempt === attempt) return f;
  }
  return null;
}

export interface OverriddenFloors {
  /** The checks that failed where the operator overrode the floor, in first-seen order. */
  checks: string[];
  /** Every one of them failed on the run's base as well. */
  onBase: boolean;
}

/**
 * The floors the operator overrode on the way to this hand-over (`operatorJudges[].floorOverride`, read off
 * the delivery's receipt, and the run's durable record of them), with the checks that failed there — from that unit attempt's own floor record.
 * `null` when no floor was overridden.
 */
export function overriddenFloorsOf(
  receipt: AssuranceReceipt | null | undefined,
  events: readonly CoreEvent[] | null | undefined,
  /** The run: its durable record (`session.assurance.floorOverrides`) counts even when no gate receipt is in hand. */
  view?: SessionView | null,
): OverriddenFloors | null {
  const overrides = (receipt?.operatorJudges ?? []).filter((j) => j.floorOverride !== undefined);
  for (const d of durableFloorOverrides(view)) {
    if (!overrides.some((o) => o.floorOverride!.resultId !== '' && o.floorOverride!.resultId === d.floorOverride!.resultId)) overrides.push(d);
  }
  if (overrides.length === 0) return null;
  const checks: string[] = [];
  let onBase = true;
  for (const o of overrides) {
    const at = o.floorOverride!;
    const floor = at.ord === null ? null : floorAt(events ?? [], at.ord, at.attempt);
    const failed = failedChecks(floor);
    if (failed.length === 0) {
      // No floor record in hand: nothing says the base failed too, so nothing claims it.
      onBase = false;
      continue;
    }
    for (const c of failed) {
      if (!checks.includes(c.name)) checks.push(c.name);
      if (!failedOnBase(c)) onBase = false;
    }
  }
  return { checks, onBase };
}

function andList(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/** "Overridden by you: test failed on this change and its base." — the one sentence every surface says
 *  for a hand-over whose failed floor the operator overrode. */
export function overriddenLine(o: OverriddenFloors): string {
  const what = o.checks.length === 0 ? 'the repository checks' : andList(o.checks);
  return `Overridden by you: ${what} failed on this change${o.onBase ? ' and its base' : ''}.`;
}
