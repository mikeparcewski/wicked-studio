// Brainstorm-actionable ideas 1 + 2 — the pure half: which move a gate recommends, the reviewer's
// failing items, the verdict diff, and the Home gate row's verb.
import { describe, expect, it } from 'vitest';
import {
  creatorClaims, failingItems, gateRowVerb, isLowBand, recommendGateMove, verdictDiff, type GateMoveInput,
} from '../src/components/gateMoveModel.js';
import { gateVerdictFor } from '../src/components/gateVerdictModel.js';
import type { PlanGateStep, PlanGateView } from '../src/board/planModel.js';
import type { CoreEvent } from '../src/api/types.js';
import { CREATOR_OUTPUT, MOVE_RUN, MOVE_UNITS, NOT_PASS_EVENTS, NOT_PASS_PROMPT, REVIEWER_REASON } from './fixtures/gateMove.js';

function input(over: Partial<GateMoveInput>): GateMoveInput {
  return {
    runId: MOVE_RUN, ord: 2, units: MOVE_UNITS, verdict: null, verdictSummary: null, escalationGate: false,
    hasLift: false, restoredRetry: false, isPlanGate: false, planView: null, diffstat: null, ...over,
  };
}

/** A plan step as `plan.proposed` carries it: the id the card shows, the catalog that says what it
 *  is. `steps('a', 'b:c')` = id `a` (catalog `a`), then id `b` with catalog `c`. */
const steps = (...spec: string[]): PlanGateStep[] =>
  spec.map((s) => {
    const [id, catalog] = s.split(':');
    return { id: id!, catalog: catalog ?? id! };
  });

const plan = (over: Partial<PlanGateView>): PlanGateView => ({
  gateId: 'g-1', ord: 2, planRev: 1, band: '0-19', highRisk: false, reason: 'manual_mode', score: 10,
  reasons: [], floorAdded: [], editSeed: ['understand', 'build'], planSteps: steps('understand', 'build'), ...over,
});

describe('failingItems', () => {
  it("reads the evaluator's bullets off the recorded VERDICT: FAIL frame, frame lines dropped", () => {
    const v = gateVerdictFor(NOT_PASS_EVENTS, 2, NOT_PASS_PROMPT);
    expect(failingItems(v, REVIEWER_REASON)).toEqual(['the regression test is missing', 'src/app.ts still reads `buggy`']);
  });

  it('falls back to the failing repository checks, then prose; a pass has none', () => {
    const floorFail = [
      { type: 'repoChecksEvaluated', ord: 3, passed: false, criterion: 'checks', checks: [
        { name: 'typecheck', argv: ['tsc'], exitCode: 2, durationMs: 10 },
        { name: 'lint', argv: ['eslint'], exitCode: 0, durationMs: 10 },
      ] },
      { type: 'gateEvaluated', ord: 3, combined: false, hasDeterministicFloor: true,
        denial: { source: 'repo_checks', reason: 'Repository checks failed on head' } },
    ] as unknown as CoreEvent[];
    expect(failingItems(gateVerdictFor(floorFail, 3, undefined))).toEqual(['typecheck — exit 2']);
    const prose = [{ type: 'gateEvaluated', ord: 3, combined: false, denial: { source: 'evaluator_verdict', reason: 'Evaluator judged this NOT PASS' } }] as unknown as CoreEvent[];
    expect(failingItems(gateVerdictFor(prose, 3, undefined))).toEqual(['Evaluator judged this NOT PASS']);
    expect(failingItems(null)).toEqual([]);
  });
});

describe('recommendGateMove', () => {
  it('a NOT PASS evaluator verdict → send back to the creator with the failing items, consequence first', () => {
    const verdict = gateVerdictFor(NOT_PASS_EVENTS, 2, NOT_PASS_PROMPT);
    const move = recommendGateMove(input({ verdict, verdictSummary: REVIEWER_REASON, escalationGate: true }));
    expect(move?.kind).toBe('send-back');
    expect(move?.label).toBe('Send back to the creator: the regression test is missing (+1 more)');
    expect(move?.consequence).toBe('produce reruns with 2 items; critique re-reviews');
    expect(move?.prefill).toBe("Fix the reviewer's failing items:\n- the regression test is missing\n- src/app.ts still reads `buggy`");
  });

  it('a validator reject → retry with the validator findings', () => {
    const events = [
      { type: 'repoChecksEvaluated', ord: 1, passed: false, criterion: 'checks', checks: [{ name: 'test', argv: ['npm', 'test'], exitCode: 1, durationMs: 5 }] },
      { type: 'gateEvaluated', ord: 1, combined: false, hasDeterministicFloor: true, denial: { source: 'repo_checks', reason: 'Repository checks failed' } },
    ] as unknown as CoreEvent[];
    const move = recommendGateMove(input({ ord: 1, verdict: gateVerdictFor(events, 1, undefined), escalationGate: true }));
    expect(move?.kind).toBe('retry-findings');
    expect(move?.label).toBe("Retry with the validator's findings");
    expect(move?.consequence).toBe('produce reruns with 1 failing check as its note');
    expect(move?.prefill).toContain('- test — exit 1');
  });

  // ── F4 (ship-proof C7) — THE CONSEQUENCE NAMES THE PLAN IT GATES ──────────────────────────────
  //
  // The line read "approve runs 6 phases: understand → design → build → review → test → critique"
  // while the plan on the same card was `pa-scope → clarify → design → build → adversarial-review
  // → test → review → deliver` (8 units). It was derived from `editSeed` — what the plan EDITOR is
  // seeded with, which strips the two steps an operator cannot author and names steps by CATALOG —
  // so the count, the names, and the presence of `deliver` (the only phase with an external side
  // effect) were all wrong on the card that approves it.
  it('derives the consequence from the COMPOSED plan, deliver included, not from the editor seed', () => {
    const view = plan({
      // What C7 saw: the plan as composed, by step id.
      planSteps: steps('pa-scope:understand', 'clarify:understand', 'design', 'build:produce',
        'adversarial-review:critique', 'test', 'review', 'deliver'),
      // What the editor is seeded with — deliberately different, and no longer what the line reads.
      editSeed: ['understand', 'design', 'build', 'review', 'test', 'critique'],
    });
    const move = recommendGateMove(input({ isPlanGate: true, planView: view }));

    expect(move?.consequence).toBe(
      'Band 0-19, low risk — approve runs 8 phases: pa-scope → clarify → design → build → ' +
        'adversarial-review → test → review → deliver; its deliver phase is the one with an ' +
        'external side effect',
    );
    // The two halves of the defect, pinned separately so a regression names itself.
    expect(move?.consequence).toContain('8 phases');
    expect(move?.consequence).toContain('deliver');
    expect(move?.consequence).not.toContain('6 phases');
    expect(move?.consequence).not.toContain('critique');
  });

  it('a floor addition the proposed plan does not carry still rides the consequence, once', () => {
    const view = plan({ planSteps: steps('understand', 'build'), floorAdded: ['test_plan', 'build'] });
    expect(recommendGateMove(input({ isPlanGate: true, planView: view }))?.consequence).toBe(
      'Band 0-19, low risk — approve runs 3 phases: understand → build → test_plan',
    );
  });

  it('a plan with no deliver step says nothing about an external side effect', () => {
    const view = plan({ planSteps: steps('understand', 'build') });
    expect(recommendGateMove(input({ isPlanGate: true, planView: view }))?.consequence).toBe(
      'Band 0-19, low risk — approve runs 2 phases: understand → build',
    );
  });

  // codex review of this PR, two MEDIUMs: the names the card shows are step IDS while the floor's
  // additions and the deliver step are named by CATALOG. Mixing the namespaces double-counted a
  // floor addition already in the plan and read the side effect off the wrong field.
  it('the deliver step is found by CATALOG, whatever its step id is', () => {
    const renamed = plan({ planSteps: steps('understand', 'publish-output:deliver') });
    expect(recommendGateMove(input({ isPlanGate: true, planView: renamed }))?.consequence).toBe(
      'Band 0-19, low risk — approve runs 2 phases: understand → publish-output; its deliver phase ' +
        'is the one with an external side effect',
    );
    // And a step merely CALLED deliver, instantiating something else, is not the side effect.
    const impostor = plan({ planSteps: steps('understand', 'deliver:review') });
    expect(recommendGateMove(input({ isPlanGate: true, planView: impostor }))?.consequence).toBe(
      'Band 0-19, low risk — approve runs 2 phases: understand → deliver',
    );
  });

  it('a floor addition already in the plan under another step id is not listed twice', () => {
    const view = plan({
      planSteps: steps('understand', 'adversarial-review:critique'),
      floorAdded: ['critique', 'test_plan'],
    });
    expect(recommendGateMove(input({ isPlanGate: true, planView: view }))?.consequence).toBe(
      'Band 0-19, low risk — approve runs 3 phases: understand → adversarial-review → test_plan',
    );
  });

  it('a step the payload could not name is COUNTED and said to be unnamed, never dropped', () => {
    const view = plan({ planSteps: [{ id: 'understand', catalog: 'understand' }, { id: null, catalog: null }] });
    expect(recommendGateMove(input({ isPlanGate: true, planView: view }))?.consequence).toBe(
      'Band 0-19, low risk — approve runs 2 phases: understand → (unnamed phase)',
    );
  });

  it('a plan gate at a low band → approve the plan; a high band recommends nothing', () => {
    const low = recommendGateMove(input({ isPlanGate: true, planView: plan({}) }));
    expect(low).toMatchObject({ kind: 'approve-plan', label: 'Approve the plan', prefill: null });
    expect(low?.consequence).toBe('Band 0-19, low risk — approve runs 2 phases: understand → build');
    expect(recommendGateMove(input({ isPlanGate: true, planView: plan({ band: '70-100', highRisk: true }) }))).toBeNull();
    expect(isLowBand(plan({ band: '40-69' }))).toBe(false);
  });

  it('the deliver gate → review the diff, then deliver, naming what the push carries', () => {
    const move = recommendGateMove(input({ ord: 3, diffstat: '2 files changed, +3, −1' }));
    expect(move).toMatchObject({ kind: 'deliver', label: 'Review the diff, then deliver' });
    expect(move?.consequence).toBe('Deliver pushes the run branch: 2 files changed, +3, −1');
  });

  it('recommends nothing on a deliver lift, a restored-tree retry, or a plain pre-run gate', () => {
    const verdict = gateVerdictFor(NOT_PASS_EVENTS, 2, NOT_PASS_PROMPT);
    expect(recommendGateMove(input({ verdict, escalationGate: true, hasLift: true }))).toBeNull();
    expect(recommendGateMove(input({ verdict, escalationGate: true, restoredRetry: true }))).toBeNull();
    expect(recommendGateMove(input({ ord: 1 }))).toBeNull();
  });
});

describe('verdictDiff', () => {
  it('sets each failing criterion beside the creator claim that speaks to it', () => {
    const rows = verdictDiff(['the regression test is missing', 'src/app.ts still reads `buggy`', 'docs are stale'], CREATOR_OUTPUT);
    expect(rows).toEqual([
      { criterion: 'the regression test is missing', claim: 'added a regression test for the buggy path' },
      { criterion: 'src/app.ts still reads `buggy`', claim: 'src/app.ts now reads `fixed` instead of `buggy`' },
      { criterion: 'docs are stale', claim: null },
    ]);
    expect(creatorClaims('one\nVERDICT: PASS')).toEqual(['one']);
  });
});

describe('gateRowVerb (Home gate row)', () => {
  it('names the move the card will recommend; unknown prompts keep "Open gate ›"', () => {
    expect(gateRowVerb(NOT_PASS_PROMPT)).toBe('Send back… ›');
    expect(gateRowVerb('Unit 4 verdict is NOT PASS — the evaluator changed the tree under review; its edit was discarded and the creator\'s verified tree restored.')).toBe('Retry… ›');
    expect(gateRowVerb('Unit 3 failed its deterministic floor (repo_checks): typecheck exited 1.')).toBe('Retry… ›');
    expect(gateRowVerb('Approve plan rev 1 before unit 1 runs (manual mode; band 0-19): build.', 'plan_approval')).toBe('Approve plan… ›');
    expect(gateRowVerb('Approve plan rev 2 before unit 2 runs (manual mode; band 70-100): build.', 'plan_approval')).toBeNull();
    expect(gateRowVerb('Approve unit 5 before it runs: deliver — ship it')).toBe('Review diff… ›');
    expect(gateRowVerb('approve the plan?')).toBeNull();
  });
});
