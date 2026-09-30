import type { CoreEvent, WorkUnit } from '../api/types.js';
import { DELIVER_STEP, type PlanGateView } from '../board/planModel.js';
import { checkOutcome, phaseLabel, type GateVerdictView } from './gateVerdictModel.js';

/**
 * The ONE recommended move at a gate (brainstorm-actionable idea 1) and the verdict diff beside it
 * (idea 2). Pure: every input is already on the card (the verdict fold, the run's units, the plan
 * gate view, the deliver diff), so this module makes zero requests.
 *
 * The card used to show state (a NOT PASS verdict, a floor that failed) and leave the operator to
 * work out the answer and type the note. Now the gate's kind and verdict pick the move, the move
 * names itself on the primary button, the consequence line says what happens before it is taken,
 * and the note arrives pre-filled with the reviewer's failing lines. The other answers stay, as
 * secondary buttons.
 *
 * The moves, each answered on a crew route the card already speaks (`POST /runs/:id/gate`):
 *  - `send-back`       an evaluator said NOT PASS → `{approve:false, action:'request_changes', amend}`:
 *                      the creator phase reruns with the failing items, the reviewer re-reviews;
 *  - `retry-findings`  a validator / repository checks rejected the unit (or a legacy NOT PASS gate
 *                      whose approve retries) → an approve carrying the findings as the note;
 *  - `approve-plan`    a plan gate at a low band → a plain approve of the plan as shown;
 *  - `deliver`         the gate before the deliver unit → review the diff, then approve.
 * `null` everywhere else: the card keeps its existing layout and nothing is recommended.
 */

export type GateMoveKind = 'send-back' | 'retry-findings' | 'approve-plan' | 'deliver';

export interface GateMove {
  kind: GateMoveKind;
  /** The primary button's text — the move, named. */
  label: string;
  /** The consequence line rendered above the button, before the move is taken. */
  consequence: string;
  /** The note the steer box is pre-filled with (`null` = the move takes no note). */
  prefill: string | null;
  /** The reviewer's failing items the move carries (empty for plan / deliver). */
  items: string[];
}

/** Denial layers that are an evaluator's judgement of the work (the creator should fix it). */
const EVALUATOR_SOURCES = new Set(['evaluator_verdict', 'agent_validator', 'evaluator']);
/** Denial layers that are a deterministic validator of the work (retry with what it found). */
const VALIDATOR_SOURCES = new Set(['repo_checks', 'repo_checks_timeout', 'pinned_validator', 'substance', 'deliverables']);

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/;
/** Lines that frame a verdict rather than state a finding. */
const FRAME = /^(?:the evaluator'?s verdict is\b|verdict\s*[:=]|agent judge:\s*fail\s*$|not pass\b|reviewed\b|findings?:?$)/i;

function lines(text: string | null | undefined): string[] {
  return (text ?? '').replace(/\r/g, '').split('\n').map((l) => l.trim()).filter((l) => l !== '');
}

/** The bulleted findings in a reviewer's text, in order, deduplicated. */
function bullets(text: string | null | undefined): string[] {
  const out: string[] = [];
  for (const l of lines(text)) {
    const m = BULLET.exec(l);
    if (m !== null && !FRAME.test(m[1]!) && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/** A reviewer's prose findings when it wrote no bullets: every line that is not a frame line. */
function proseFindings(text: string | null | undefined): string[] {
  return lines(text)
    .map((l) => l.replace(/^agent judge:\s*fail\s*[—-]\s*/i, ''))
    .filter((l) => !FRAME.test(l));
}

/**
 * The newest `gateEscalated.verdictSummary` for `ord` — the engine's copy of the reviewer's words on
 * the escalation it opened. `null` when the log holds none for that unit.
 */
export function escalationSummaryFor(events: readonly CoreEvent[], ord: number | null | undefined): string | null {
  if (typeof ord !== 'number') return null;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'gateEscalated' && e.ord === ord && typeof e.verdictSummary === 'string' && e.verdictSummary.trim() !== '') {
      return e.verdictSummary;
    }
  }
  return null;
}

/**
 * The reviewer's failing items for a failed verdict, best source first:
 *  1. the bullets of the denial's reason (the evaluator's own findings — `VERDICT: FAIL` output);
 *  2. the bullets of `gateEscalated.verdictSummary`;
 *  3. the failing repository checks of the floor (`name — how it ended`);
 *  4. the bullets, then the prose, of the judge's reasoning;
 *  5. the prose of the denial reason / summary, minus the frame lines.
 * Empty for a passing (or absent) verdict: there is nothing to send back.
 */
export function failingItems(verdict: GateVerdictView | null, verdictSummary?: string | null): string[] {
  if (verdict === null || verdict.outcome !== 'fail') return [];
  const reason = verdict.denial?.reason ?? null;
  const fromBullets = bullets(reason);
  if (fromBullets.length > 0) return fromBullets;
  const fromSummary = bullets(verdictSummary);
  if (fromSummary.length > 0) return fromSummary;
  const checks = (verdict.floor?.checks ?? [])
    .filter((c) => !checkOutcome(c).ok)
    .map((c) => `${c.name} — ${checkOutcome(c).word}`);
  if (checks.length > 0) return checks;
  const judge = bullets(verdict.agentReasoning);
  if (judge.length > 0) return judge;
  if (verdict.agentReasoning !== null && verdict.agentReasoning.trim() !== '' && verdict.denial?.source === 'agent_validator') {
    return proseFindings(verdict.agentReasoning);
  }
  // A validator's prose ("Repository checks failed on head") is a headline, not a finding: without
  // its checks there is nothing to carry, so the card recommends nothing rather than echo it.
  if (verdict.denial?.source != null && VALIDATOR_SOURCES.has(verdict.denial.source)) return [];
  const prose = proseFindings(reason);
  return prose.length > 0 ? prose : proseFindings(verdictSummary);
}

/** The note a send-back / retry carries: the failing items, one per line, under one plain ask. */
export function findingsNote(items: readonly string[], who: 'reviewer' | 'validator'): string {
  return [`Fix the ${who}'s failing items:`, ...items.map((i) => `- ${i}`)].join('\n');
}

/**
 * The creator phase a send-back reruns: the newest unit before `ord` whose role is `creator`, else
 * the newest `build`-stage unit before it; `null` when the units cannot say (no units, no ord).
 */
export function creatorUnitBefore(units: readonly WorkUnit[], ord: number | null): WorkUnit | null {
  if (ord === null) return null;
  const before = units.filter((u) => u.ord < ord).sort((a, b) => b.ord - a.ord);
  return before.find((u) => u.role === 'creator') ?? before.find((u) => u.stage === 'build' && u.role !== 'evaluator') ?? null;
}

/** A plan band is LOW when the plan is not high risk and the band tops out below 40 (`0-19`, `20-39`). */
export function isLowBand(view: PlanGateView): boolean {
  if (view.highRisk) return false;
  const m = /^(\d+)\s*-\s*(\d+)$/.exec(view.band.trim());
  return m !== null && Number(m[2]) < 40;
}

/** Whether the gate is the pre-run gate on the run's deliver unit. */
export function isDeliverGate(runId: string, units: readonly WorkUnit[], ord: number | null | undefined): boolean {
  if (typeof ord !== 'number') return false;
  return units.some((u) => u.ord === ord) && phaseLabel(runId, units, ord) === 'deliver';
}

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/** The first item, clipped for a button, with how many more ride along. */
function itemsLabel(items: readonly string[]): string {
  const first = items[0] ?? '';
  const clipped = first.length > 56 ? `${first.slice(0, 55).trimEnd()}…` : first;
  return items.length > 1 ? `${clipped} (+${items.length - 1} more)` : clipped;
}

export interface GateMoveInput {
  runId: string;
  ord: number | undefined;
  units: readonly WorkUnit[];
  /** The deciding verdict (`gateVerdictFor`) — `null` on a plan gate or an evaluation-less log. */
  verdict: GateVerdictView | null;
  /** `gateEscalated.verdictSummary` for the verdict's unit (`escalationSummaryFor`). */
  verdictSummary: string | null;
  /** The card's `isEscalationGate` reading (the four-verb layout). */
  escalationGate: boolean;
  /** Whether the gate has a deliver-lift story (a failed deliver — the engine's remedy governs). */
  hasLift: boolean;
  /** The worktree-guard restored-tree retry — the card already relabels Approve for it. */
  restoredRetry: boolean;
  isPlanGate: boolean;
  planView: PlanGateView | null;
  /** The deliver gate's diffstat label (`2 files changed, +3, −1`), when the diff was read. */
  diffstat: string | null;
}

/** The ONE recommended move for this gate, or `null` when the card should recommend nothing. */
export function recommendGateMove(input: GateMoveInput): GateMove | null {
  const { runId, ord, units, verdict, verdictSummary, escalationGate, hasLift, restoredRetry } = input;

  if (input.isPlanGate) {
    const view = input.planView;
    if (view === null || !isLowBand(view)) return null;
    // F4 — THE CONSEQUENCE IS DERIVED FROM THE PLAN IT GATES, never from the editor's seed.
    //
    // This read `view.editSeed`, which is what the plan EDITOR is filled with: it strips the two
    // steps an operator cannot author (`pa-scope`, the launch's `deliver`) and names steps by
    // CATALOG. Used as the plan it said "approve runs 6 phases: understand → design → build →
    // review → test → critique" over a plan of `pa-scope → clarify → design → build →
    // adversarial-review → test → review → deliver` — the wrong count, the wrong names, and
    // `deliver`, the only phase with an external side effect, absent from the line that gates it.
    const phases = [...view.planSteps, ...view.floorAdded.filter((p) => !view.planSteps.includes(p))];
    // Said out loud rather than left to be spotted in an eight-item arrow list: this is a consent
    // line, and one of those names reaches outside the machine.
    const sideEffect = phases.includes(DELIVER_STEP)
      ? `; its ${DELIVER_STEP} phase is the one with an external side effect`
      : '';
    return {
      kind: 'approve-plan',
      label: 'Approve the plan',
      consequence: phases.length > 0
        ? `Band ${view.band}, low risk — approve runs ${plural(phases.length, 'phase')}: ${phases.join(' → ')}${sideEffect}`
        : `Band ${view.band}, low risk — approve runs the plan as shown`,
      prefill: null,
      items: [],
    };
  }

  if (hasLift || restoredRetry) return null;

  // A failed verdict on THIS gate's unit (an escalation, or a legacy NOT PASS gate whose approve retries).
  const own = verdict !== null && verdict.outcome === 'fail' && typeof ord === 'number' && verdict.ord === ord;
  const source = verdict?.denial?.source ?? null;
  // Only a judgement of the WORK recommends a move: a worktree-guard, governance or worker-failure
  // denial is about how the phase ran, and the card's own remedy for it stands.
  const judged = source !== null && (EVALUATOR_SOURCES.has(source) || VALIDATOR_SOURCES.has(source));
  // core#469: a floor that did not FINISH judged nothing — "retry with its findings" would re-run the
  // seat over a timeout. The card's extend / targeted / accept arms are that gate's moves.
  if (own && source === 'repo_checks_timeout') return null;
  if (own && judged) {
    const items = failingItems(verdict, verdictSummary);
    if (items.length === 0) return null;
    const reviewer = phaseLabel(runId, units, verdict.ord);
    if (escalationGate && EVALUATOR_SOURCES.has(source)) {
      const creator = creatorUnitBefore(units, verdict.ord);
      const creatorName = creator === null ? 'the creator' : phaseLabel(runId, units, creator.ord);
      return {
        kind: 'send-back',
        label: `Send back to the creator: ${itemsLabel(items)}`,
        consequence: `${creatorName} reruns with ${plural(items.length, 'item')}; ${reviewer} re-reviews`,
        prefill: findingsNote(items, 'reviewer'),
        items,
      };
    }
    const validator = VALIDATOR_SOURCES.has(source);
    const who = validator ? 'validator' : 'reviewer';
    return {
      kind: 'retry-findings',
      label: `Retry with the ${who}'s findings`,
      consequence: `${reviewer} reruns with ${plural(items.length, validator && verdict.floor !== null ? 'failing check' : 'finding')} as its note`,
      prefill: findingsNote(items, who),
      items,
    };
  }

  if (!escalationGate && isDeliverGate(runId, units, ord)) {
    return {
      kind: 'deliver',
      label: 'Review the diff, then deliver',
      consequence: input.diffstat !== null
        ? `Deliver pushes the run branch: ${input.diffstat}`
        : 'Deliver pushes the run branch (no diff read for it yet)',
      prefill: null,
      items: [],
    };
  }
  return null;
}

// ── Idea 2: the verdict diff ────────────────────────────────────────────────────────────────────

/** One failing criterion beside what the creator claimed about it. */
export interface VerdictDiffRow {
  criterion: string;
  /** The creator's line that speaks to it (best word overlap), or `null` — it claimed nothing on it. */
  claim: string | null;
}

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'still', 'have', 'has', 'was', 'were',
  'are', 'not', 'but', 'its', 'now', 'all', 'any', 'every', 'each', 'should', 'would', 'missing',
]);

function words(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9_./-]+/).map((w) => w.replace(/^[./-]+|[./-]+$/g, ''))
      .filter((w) => w.length >= 3 && !STOP.has(w)),
  );
}

/**
 * What the creator claimed: the bullets of its output when it wrote any, else its non-empty lines —
 * the `VERDICT:` line and fenced-code markers dropped.
 */
export function creatorClaims(output: string | null | undefined): string[] {
  const all = lines(output).filter((l) => !/^verdict\s*[:=]/i.test(l) && !l.startsWith('```'));
  const fromBullets = all.map((l) => BULLET.exec(l)?.[1] ?? null).filter((l): l is string => l !== null);
  return fromBullets.length > 0 ? fromBullets : all;
}

/**
 * Each failing criterion beside the creator's claim that shares the most words with it (at least
 * one), so "why it failed" reads without the timeline: the reviewer says the test is missing, the
 * creator said it added the test.
 */
export function verdictDiff(items: readonly string[], creatorOutput: string | null | undefined): VerdictDiffRow[] {
  const claims = creatorClaims(creatorOutput).map((c) => ({ text: c, words: words(c) }));
  return items.map((criterion) => {
    const want = words(criterion);
    let best: string | null = null;
    let bestScore = 0;
    for (const c of claims) {
      let score = 0;
      for (const w of want) if (c.words.has(w)) score++;
      if (score > bestScore) { bestScore = score; best = c.text; }
    }
    return { criterion, claim: best };
  });
}

// ── The Home gate row's verb ──────────────────────────────────────────────────────────────────

/**
 * The Home "Needs you" gate row's verb, naming the move the gate card will recommend, read off the
 * gate record the row already holds (the prompt the engine wrote and the live frame's kind). The row
 * still OPENS the gate — the trailing ellipsis says the answer is given there; nothing is sent from
 * Home. `null` = the prompt names no move this can read (the row keeps "Open gate ›").
 */
export function gateRowVerb(prompt: string | undefined, gateKind?: string): string | null {
  const p = prompt ?? '';
  if (gateKind === 'plan_approval' || /^\s*Approve plan rev\b/i.test(p)) {
    const band = /\bband\s+(\d+)\s*-\s*(\d+)/i.exec(p);
    return band !== null && Number(band[2]) < 40 ? 'Approve plan… ›' : null;
  }
  if (/^\s*Unit\s+\d+\s+verdict is NOT PASS/i.test(p)) {
    // The worktree-guard mutation gate retries against the restored tree; every other NOT PASS
    // goes back to the creator.
    return /restored|changed the tree/i.test(p) ? 'Retry… ›' : 'Send back… ›';
  }
  if (/^\s*Unit\s+\d+\s+(?:failed and triage escalated|failed its deterministic floor)/i.test(p)) return 'Retry… ›';
  if (/^\s*Approve unit\s+\d+\s+before it runs:\s*deliver\b/i.test(p)) return 'Review diff… ›';
  return null;
}
