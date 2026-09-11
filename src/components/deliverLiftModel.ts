import type { CoreEvent } from '../api/types.js';
import { floorOf, type GateFloorView } from './gateVerdictModel.js';

/**
 * deliverLift — the deliver phase's pre-push story, read off the run's event log
 * (wicked-core#431 / F-3R2-013, api-types 0.33.0; the studio half of wicked-crew#527).
 *
 * Before the run's `deliver` Tool phase pushes, the engine LIFTS the run's work onto the remote
 * default branch's current tip and says what that did (`deliverLiftEvaluated`, once per deliver
 * attempt): `unchanged` (the base was already the tip), `lifted` (re-applied onto the tip; the
 * repository's checks were then RE-RUN on the lifted tree — a `repoChecksEvaluated` for the deliver
 * ord), `conflict` (nothing rebased or pushed; the unit failed with the engine's `deliver:
 * LIFT-CONFLICT — …` remedy), `skipped` (the lift could not be decided) or `failed` (the apply
 * failed part-way). A deliver unit the engine REFUSES emits `stepFailed` with a `deliver:`-prefixed
 * detail — and a refusal that precedes the lift (a worktree whose `HEAD` is not on the run branch,
 * a tree that could not be snapshotted) has NO `deliverLiftEvaluated` before it at all, so this
 * derivation never assumes the lift frame exists (wicked-core#433 final review).
 *
 * Pure: the delivery card, the deliver gate's card and the timeline all read the same fold, so none
 * of them can disagree. Zero requests — a view over the log the run page already hydrates.
 *
 * WHICH attempt: the frames are folded in log order and a `unitDispatched` for the deliver ord starts
 * a fresh story (a retry's frames never inherit the previous attempt's conflict or refusal). The view
 * is therefore the NEWEST attempt's — the one an open retry gate is about, and the one that ended the
 * run when it is terminal.
 */

/** The engine's outcome tokens (api-types 0.33.0 `DeliverLiftOutcome`); a newer engine's token is
 *  kept as it arrived and rendered as such, never guessed at. */
export type DeliverLiftOutcomeWord = 'unchanged' | 'lifted' | 'conflict' | 'skipped' | 'failed';

export interface DeliverLiftView {
  ord: number | null;
  attempt: number | null;
  /** The lift's outcome token; `null` when no `deliverLiftEvaluated` frame preceded — the deliver
   *  unit was refused BEFORE the lift and only its `deliver:` failure text exists. */
  outcome: string | null;
  /** The remote default ref the lift targets (`origin/main`), when one was resolved. */
  baseRef: string | null;
  /** The run branch's `HEAD` before the lift (the base the work was verified on). */
  baseBefore: string | null;
  /** The remote tip the work now sits on (`lifted`) or would have (`conflict`). */
  baseAfter: string | null;
  treeBefore: string | null;
  treeAfter: string | null;
  /** The paths the lift would conflict in (`conflict`); empty otherwise. */
  conflicts: string[];
  /** Why the lift was skipped / failed, or a disclosed degradation (a failed fetch). */
  note: string | null;
  /** The deliver ord's `repoChecksEvaluated` — the re-verify on the tree that would ship. `passed:
   *  false` there is a failed re-verify OR a failed post-check proof (the checks passed but CHANGED
   *  the worktree) — the `failure` text says which. */
  reverify: GateFloorView | null;
  /** The deliver unit's `stepFailed.detail` for this attempt — engine-authored (`deliver: …`) or the
   *  deliver script's own refusal — verbatim; `null` while the unit has not failed. */
  failure: string | null;
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

/** The engine's own prefix on a deliver refusal it authored (wicked-core `deliver_lift.rs`); the
 *  deliver script's refusals (`deliver: BASE MOVED since verification`, `deliver: LIFT-CONFLICT`)
 *  wear the same prefix. */
const DELIVER_PREFIX = /^deliver:/;

function blank(ord: number | null, ev: CoreEvent): DeliverLiftView {
  return {
    ord,
    attempt: num(ev.attempt),
    outcome: null,
    baseRef: null,
    baseBefore: null,
    baseAfter: null,
    treeBefore: null,
    treeAfter: null,
    conflicts: [],
    note: null,
    reverify: null,
    failure: null,
  };
}

function liftOf(ord: number | null, ev: CoreEvent): DeliverLiftView {
  return {
    ...blank(ord, ev),
    outcome: str(ev.outcome),
    baseRef: str(ev.baseRef),
    baseBefore: str(ev.baseBefore),
    baseAfter: str(ev.baseAfter),
    treeBefore: str(ev.treeBefore),
    treeAfter: str(ev.treeAfter),
    conflicts: strings(ev.conflicts),
    note: str(ev.note),
  };
}

/**
 * The deliver phase's newest-attempt story for `deliverOrd`, or `null` when the log holds none.
 *
 * With `deliverOrd` given, a `deliver:` `stepFailed` for that ord builds a view even with no lift
 * frame before it (the refused-before-the-lift case). A `repoChecksEvaluated` attaches only to a
 * lift story already in hand — the engine emits `deliverLiftEvaluated` BEFORE any deliver re-verify,
 * so a floor with no lift before it is some other phase's floor (the verify gate's, say), never a
 * deliver re-verify. Without `deliverOrd`, only a `deliverLiftEvaluated` starts a story and later
 * frames attach only when they carry its ord.
 */
export function deliverLift(events: readonly CoreEvent[], deliverOrd?: number): DeliverLiftView | null {
  const scoped = deliverOrd !== undefined;
  let view: DeliverLiftView | null = null;
  for (const e of events) {
    const ord = num(e.ord);
    if (scoped && ord !== deliverOrd) continue;
    const mine = view !== null && view.ord === ord;
    switch (e.type) {
      case 'unitDispatched':
        // A retry starts a fresh story: the previous attempt's conflict is that attempt's.
        if (mine) view = null;
        break;
      case 'deliverLiftEvaluated':
        view = liftOf(ord, e);
        break;
      case 'repoChecksEvaluated':
        if (mine) view = { ...view!, reverify: floorOf(e) };
        break;
      case 'stepFailed': {
        const detail = str(e.detail);
        if (detail === null || detail === '') break;
        // With a lift frame in hand any failure of this attempt is the lift's story; without one,
        // only the engine's own `deliver:` refusal is — a worker's stack trace on a deliver unit
        // that never reached the lift is the failure banner's business, not this card's.
        if (mine || (scoped && DELIVER_PREFIX.test(detail))) view = { ...(view ?? blank(ord, e)), failure: detail };
        break;
      }
      default:
        break;
    }
  }
  return view;
}

/** The short word the card leads with, per outcome; a newer engine's token passes through. */
export function liftOutcomeLabel(outcome: string | null): string {
  switch (outcome) {
    case 'unchanged': return 'base unchanged';
    case 'lifted': return 'lifted onto the current tip';
    case 'conflict': return 'LIFT-CONFLICT';
    case 'skipped': return 'lift skipped';
    case 'failed': return 'lift failed';
    case null: return 'refused before the lift';
    default: return outcome;
  }
}

/** Whether the outcome (or the absence of one beside a failure) is a stop: nothing was pushed. */
export function liftIsFailure(view: DeliverLiftView): boolean {
  return view.outcome === 'conflict' || view.outcome === 'failed' || view.failure !== null || view.reverify?.passed === false;
}

/**
 * A `passed: false` re-verify whose every check exited 0 is the post-check PROOF failing, not a
 * red suite: the repository's checks passed but CHANGED the worktree while running (wicked-core
 * F-433-002) — the refusal text names the tree/HEAD that moved. Said out loud so "repository
 * checks — fail" over three green rows does not read as a contradiction.
 */
export function reverifyChangedTree(floor: GateFloorView): boolean {
  return (
    !floor.passed &&
    floor.checks.length > 0 &&
    floor.skipped.length === 0 &&
    floor.checks.every((c) => c.exitCode === 0 && !c.timedOut && c.spawnError === null)
  );
}

/** The engine's elision marker, as `bounded_excerpt` (wicked-core `actor.rs`) writes it between the
 *  kept head and tail of an over-long output: `{head}\n[… N chars elided …]\n{tail}`. */
export const ELISION_MARKER = /\[… \d+ chars elided …\]/;

/** `text` cut at the engine's elision marker(s): even indices are the words the wire KEPT, odd
 *  indices the markers themselves — so a view can dim the marker and keep the words verbatim. */
export function splitElided(text: string): string[] {
  return text.split(/(\[… \d+ chars elided …\])/);
}

/**
 * Whether `text` — a gate prompt, a unit's `denial_reason` — already carries `failure` (the deliver
 * unit's `stepFailed.detail`), so a surface that renders both never prints the engine's refusal twice
 * (F-255-02).
 *
 * `text.includes(failure)` is not enough because of what the wire does to the words (wicked-core
 * `actor.rs`): `detail` is a HEAD+TAIL excerpt — `bounded_excerpt(…, 150, 250)` on the failure-triage
 * path, 300/500 on the plain worker-failure path — with `[… N chars elided …]` between the halves once
 * the refusal outgrows the bound, while the triage-escalate prompt quotes a WIDER excerpt (450/750:
 * `… Failure output: "<excerpt>". Approve to retry …`) and a rejected unit's `denial_reason` frames
 * its own (`Worker FAILED on unit N: <excerpt>`). Every segment the detail kept is a substring of any
 * wider excerpt of the same output — a head+tail excerpt keeps the original head and the original
 * tail — so the test is: each kept segment of `failure` occurs in `text`. Nothing on either side is
 * nothing to compare, never a match.
 */
export function textCarriesFailure(text: string | null | undefined, failure: string | null): boolean {
  if (text === null || text === undefined || failure === null) return false;
  const kept = splitElided(failure)
    .filter((_, i) => i % 2 === 0)
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return kept.length > 0 && kept.every((s) => text.includes(s));
}
