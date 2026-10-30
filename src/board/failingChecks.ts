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
  // cargo prints `test <path>` (`test deliver_lift::tests::a_case`): the word is the runner's, not the name.
  // vitest prints a whole file that failed to load as `FAIL tests/a.test.ts [ tests/a.test.ts ]`: the file.
  const bare = id.trim().replace(/^(?:FAILED|FAIL|ERROR|✗|×)\s+/, '').replace(/^test\s+(?=[\w:]+$)/, '').replace(/^(\S+)\s+\[\s*\1\s*\]$/, '$1');
  return bare.replace(/^(\S*::.*?)\s+-\s+.*$/, '$1').trim();
}

export interface FailingOnFace {
  /** Up to {@link FACE_MAX} names: failing tests where the runner's output named them, else the check. */
  names: string[];
  /** How many more failed beyond `names`. */
  more: number;
  /** (mockup ui-v2-gate) Where the engine told the failures apart per test: the ones new with this change, and the
   *  ones that fail on the base too. Absent when it did not. */
  split?: FailingSplit;
}

/** A floor's failures told apart: new with this change (`fresh`) and failing on the base too (`onBase`). `baseCount`
 *  is there only when the engine counted base failures it did not name (its words carry a count, not the tests). */
export interface FailingSplit {
  fresh: string[];
  onBase: string[];
  baseCount?: number;
}

/** How many failures fail on the base too, named or only counted. */
export function baseCountOf(split: FailingSplit): number {
  return split.baseCount ?? split.onBase.length;
}

const names = (xs: readonly string[] | null | undefined): string[] => [...new Set((xs ?? []).map(failureName).filter((x) => x !== ''))];

/**
 * The engine's per-test split of a floor's failures (J4 0.16.6: the face listed the base's failures and hid the one only
 * this change has). In order of what the engine said:
 *  1. its per-test lists (`regressions` / `preExisting`);
 *  2. its structured comparison: the failing tests of the check and its re-runs against the failing tests of the same
 *     check on the run base (`base.run.failureIds`) — what it records when it could not separate them in its lists
 *     (`base_red_unseparated`); a base run that passed makes every failure the change's;
 *  3. when no floor record is in hand, its own words (`said`: the gate's summary or prompt): "HEAD-ONLY failures … :
 *     `a`, `b` (4 more fail on the base too …)" or "Every failing test also fails on the run base … (5 shared)".
 * `null` when none of them tells the failures apart.
 */
export function failingSplit(floor: GateFloorView | null | undefined, said?: string | null): FailingSplit | null {
  const fresh: string[] = [];
  const onBase: string[] = [];
  let told = false;
  for (const c of failedChecks(floor)) {
    const pre = names(c.preExisting);
    const reg = names(c.regressions);
    const ids = names(c.failureIds);
    if (pre.length > 0 || reg.length > 0) {
      told = true;
      onBase.push(...pre);
      fresh.push(...(reg.length > 0 ? reg : ids.filter((x) => !pre.includes(x))));
      continue;
    }
    // A failure that reproduces on the re-run is the change's too (the engine's WICKED-RETRY rule).
    const head = [...new Set([...ids, ...names(c.rerunFailureIds)])];
    const base = c.baseFailureIds === null || c.baseFailureIds === undefined ? null : names(c.baseFailureIds);
    if (base !== null && head.length > 0) {
      told = true;
      fresh.push(...head.filter((x) => !base.includes(x)));
      onBase.push(...head.filter((x) => base.includes(x)));
      continue;
    }
    if (c.baseFailed === false) told = true;
    fresh.push(...(head.length > 0 ? head : [`the ${c.name} check`]));
  }
  if (told) {
    const f = [...new Set(fresh)];
    return { fresh: f, onBase: [...new Set(onBase)].filter((x) => !f.includes(x)) };
  }
  return failedChecks(floor).length === 0 && typeof said === 'string' ? splitFromWords(said) : null;
}

/** The engine's words for a floor's split (wicked-core `failure_split`), when no floor record is in hand. */
export function splitFromWords(said: string): FailingSplit | null {
  const head = /HEAD-ONLY failures\b[^:]*:\s*((?:`[^`]+`(?:,\s*)?)+)/.exec(said);
  if (head !== null) {
    const fresh = [...head[1]!.matchAll(/`([^`]+)`/g)].map((m) => failureName(m[1]!.replace(/^[\w.-]+:\s+/, '')));
    const more = /\((\d+) more fail on the base too\b/.exec(said.slice(head.index));
    return { fresh: [...new Set(fresh)], onBase: [], ...(more !== null ? { baseCount: Number(more[1]) } : {}) };
  }
  const shared = /Every failing test also fails on the run base\b[^(]*\((\d+) shared\)/.exec(said);
  return shared !== null ? { fresh: [], onBase: [], baseCount: Number(shared[1]) } : null;
}

/** The floor a gate stands on: the gate's own verdict's, else — when the engine kept "this unit's last floor result on
 *  this tree" (a no-change answer re-runs nothing) — that unit's newest floor record. */
export function standingFloor(events: readonly CoreEvent[], ord: number, own: GateFloorView | null | undefined): GateFloorView | null {
  if (own !== null && own !== undefined) return own;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'repoChecksEvaluated' && e.ord === ord) return floorOf(e);
  }
  return null;
}

/** Where a failing test lives, short, for the face's tag: a vitest / jest file's name (`mcp-policies.test.ts`), a pytest
 *  file's, a Rust test's module (`deliver_lift::tests`); `null` when the id names no place. */
export function testPlace(id: string): string | null {
  if (/\s>\s/.test(id)) return id.split(/\s>\s/)[0]!.trim().split('/').pop() || null;
  const parts = id.split('::');
  if (parts.length < 2) return null;
  const head = parts.slice(0, -1).join('::');
  return /[\\/]/.test(head) ? head.split(/[\\/]/).pop() || null : head;
}

/** A test id in words for the face: `tests/a.py::test_walkthrough_runs_in_a_jail` → "Walkthrough runs in a jail"
 *  (the id itself stays beside it, muted). An id that is not a test name is kept as it is. */
export function testWords(id: string): string {
  // A vitest / jest id ("src/a.test.ts > GateRow > names tests") already ends in words.
  if (/\s>\s/.test(id)) return id.split(/\s>\s/).pop()!.trim() || id;
  const leaf = id.split('::').pop()?.replace(/\[.*\]$/, '').trim() ?? id;
  // A file path (a whole test file that failed) is said as the path: never "S/delivery-assurance.test.ts" from
  // stripping a leading "test" off "tests/…".
  if (/[\\/]/.test(leaf) || /\.(?:[cm]?[jt]sx?|py|rs|go|rb)$/.test(leaf)) return leaf;
  const bare = leaf.replace(/^test_?/i, '').replace(/_+/g, ' ').trim();
  // A snake_case leaf is a sentence too (Rust: `a_passing_check_that_mutates_source_is_caught`).
  const snake = /^[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+){2,}$/.test(leaf);
  if (bare === '' || (bare === leaf && !/^test/i.test(leaf) && !snake)) return id;
  return bare.charAt(0).toUpperCase() + bare.slice(1);
}

/** Where a failing test lives: its file (vitest/jest `file > suite > name`, a whole file that failed, pytest
 *  `file::name`) or its module (Rust `mod::tests::name`); the id itself when nothing names one. */
export function testFile(id: string): string {
  const name = failureName(id);
  if (/\s>\s/.test(name)) return name.split(/\s>\s/)[0]!.trim();
  const parts = name.split('::');
  if (parts.length >= 2) return parts.slice(0, -1).join('::');
  return name;
}

/** Failing tests grouped by where they live, the biggest group first (ties keep their order). */
export function groupByFile(ids: readonly string[]): Array<{ file: string; tests: string[] }> {
  const groups = new Map<string, string[]>();
  for (const id of ids) {
    const f = testFile(id);
    const g = groups.get(f) ?? [];
    g.push(id);
    groups.set(f, g);
  }
  return [...groups.entries()].map(([file, tests]) => ({ file, tests })).sort((a, b) => b.tests.length - a.tests.length);
}

/** The failing checks of a floor, the ones the floor counts as failed (a pre-existing failure the engine
 *  separated from the change is not one). */
export function failedChecks(floor: GateFloorView | null | undefined): GateFloorCheck[] {
  return floor === null || floor === undefined ? [] : floor.checks.filter((c) => !checkOutcome(c).ok);
}

/** The face's failing list for a floor: each failed check's tests (`failureIds`), or the check's own name
 *  when the runner's output named none. `null` when nothing failed. */
export function failingOnFace(floor: GateFloorView | null | undefined, max = FACE_MAX, said?: string | null): FailingOnFace | null {
  const all: string[] = [];
  for (const c of failedChecks(floor)) {
    const ids = [...new Set((c.failureIds ?? []).map(failureName).filter((x) => x !== ''))];
    if (ids.length > 0) all.push(...ids);
    else all.push(`the ${c.name} check`);
  }
  const split = failingSplit(floor, said);
  if (all.length === 0) {
    // No floor record in hand: the engine's words still name the new failures (or count the base's).
    if (split === null) return null;
    return { names: split.fresh.slice(0, max), more: Math.max(0, split.fresh.length - max), split };
  }
  return { names: all.slice(0, max), more: Math.max(0, all.length - max), ...(split !== null ? { split } : {}) };
}

/** The face's line: "Failing: a, b, c +2 more". */
export function failingLine(f: FailingOnFace): string {
  return `Failing: ${f.names.join(', ')}${f.more > 0 ? ` +${f.more} more` : ''}`;
}

/** Whether a failed check failed on the base too (the engine compared, or ran the base and it failed). */
export function failedOnBase(c: GateFloorCheck): boolean {
  return (c.classification !== null && ON_BASE.has(c.classification)) || c.preExisting.length > 0 || c.baseFailed === true;
}

/** The floor record of one unit attempt (`repoChecksEvaluated` for that ord and attempt), newest first. An attempt
 *  with no record of its own (a rework that left the tree unchanged: "this unit's last floor result on this tree
 *  stands") is judged on the newest earlier record for that unit. */
function floorAt(events: readonly CoreEvent[], ord: number, attempt: number | null): GateFloorView | null {
  let earlier: GateFloorView | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type !== 'repoChecksEvaluated' || e.ord !== ord) continue;
    const f = floorOf(e);
    if (attempt === null || f.attempt === null || f.attempt === attempt) return f;
    if (earlier === null && f.attempt < attempt) earlier = f;
  }
  return earlier;
}

export interface OverriddenFloors {
  /** The checks that failed where the operator overrode the floor, in first-seen order. */
  checks: string[];
  /** Every one of them failed on the run's base as well. */
  onBase: boolean;
  /** The distinct failing tests the runner named in those checks (0 when it named none). */
  failures?: number;
  /** The engine could not tell the change's failures from the base's (the base is red too). */
  unseparated?: boolean;
  /** Of the named failing tests: those the base fails too, and those that fail only with this change (where the
   *  engine separated them). */
  shared?: number;
  fresh?: number;
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
  const failing = new Set<string>();
  const shared = new Set<string>();
  const fresh = new Set<string>();
  let unseparated = false;
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
      const onBaseIds = new Set([...c.preExisting, ...(c.baseFailureIds ?? [])].map(failureName));
      const newIds = new Set(c.regressions.map(failureName));
      for (const id of c.failureIds ?? []) {
        const n = failureName(id);
        if (n === '') continue;
        failing.add(n);
        if (newIds.has(n)) fresh.add(n);
        else if (onBaseIds.has(n)) shared.add(n);
        // No per-test lists: the check as a whole is the engine's word (red on the base, or not).
        else if (onBaseIds.size === 0 && newIds.size === 0 && failedOnBase(c)) shared.add(n);
        else fresh.add(n); // not shown to fail on the base: never claimed as the base's
      }
      if (c.classification === 'base_red_unseparated' || c.classification === 'unclassified_red_base') unseparated = true;
    }
  }
  return { checks, onBase, failures: failing.size, unseparated, shared: shared.size, fresh: fresh.size };
}

function andList(items: readonly string[]): string {
  return items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]!}`;
}

/**
 * The final message's sentence for an overridden floor, plainly: what you approved and why it is not the alarm it
 * sounds like. "You approved 6 failing tests in the test check; the base fails too, so they could not be told apart
 * from this change." The record keeps "Floor overridden by operator" (the details panel).
 */
export function approvedLine(o: OverriddenFloors): string {
  const what = o.checks.length === 0 ? 'the repository checks' : `the ${andList(o.checks)} check${o.checks.length === 1 ? '' : 's'}`;
  const n = o.failures ?? 0;
  const single = n > 0 ? n === 1 : o.checks.length <= 1;
  const tests = n > 0 ? `${n} failing ${n === 1 ? 'test' : 'tests'} in ${what}` : `${what}, which did not pass`;
  if (o.onBase && o.unseparated === true) return `You approved ${tests}; the base fails too, so ${single ? 'it' : 'they'} could not be told apart from this change.`;
  // Test by test (xreview on studio#933): "on the base too" only of the failures the engine showed on the base.
  const fresh = o.fresh ?? 0;
  const shared = o.shared ?? 0;
  if (n > 0 && fresh > 0) return `You approved ${tests}: ${fresh} ${fresh === 1 ? 'fails' : 'fail'} only with this change${shared > 0 ? `, ${shared} on the base too` : ''}.`;
  if (o.onBase) return `You approved ${tests}; ${single ? 'it fails' : 'they fail'} on the base too.`;
  return `You approved ${tests}.`;
}

/** "Overridden by you: test failed on this change and its base." — the one sentence every surface says
 *  for a hand-over whose failed floor the operator overrode. */
export function overriddenLine(o: OverriddenFloors): string {
  const what = o.checks.length === 0 ? 'the repository checks' : andList(o.checks);
  return `Overridden by you: ${what} failed on this change${o.onBase ? ' and its base' : ''}.`;
}
