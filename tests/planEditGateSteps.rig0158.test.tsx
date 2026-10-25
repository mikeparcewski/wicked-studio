/**
 * rig 0.15.8 (run 64f05d3d, 2026-10-25): the plan card proposed 10 steps — the PA's 6 plus the 4 the floor
 * added — while its Edit view listed 6 (the PA's proposal, read before the floor fill) and named Reproduce
 * "Plan". The editor now holds the plan the gate holds: the gate prompt's steps for this rev, in the card's
 * words, the floor's steps fixed where the floor put them.
 */
import { describe, expect, it } from 'vitest';
import type { RunTeamResponse } from '../src/api/teamPlan.js';
import { chainFromTeam, gatePlanLabels, gatePlanOf, stepLabelOf, withGatePlan } from '../src/board/chainModel.js';
import { EMPTY_FOLD, hydrateFold } from '../src/store/teamPlan.js';
import { planGateOf } from '../src/board/planModel.js';
import { gateRows } from '../src/board/planOrder.js';
import { gateDraftPlan } from '../src/board/planDraft.js';

/** The rig's gate, verbatim. */
const PROMPT = 'Approve plan rev 2 before unit 2 runs (manual mode; band 70-100, high risk; manual mode): pa-scope → triage → reproduce → '
  + 'design (floor) → architecture (floor) → fix → review (floor) → security_review (floor) → verify → deliver. '
  + 'Floor added: design, architecture, review, security_review. Approve, approve with an edited plan, or reject.';

const team: RunTeamResponse = {
  rows: [
    { event_id: 2911, event_type: 'wicked.team.plan.accepted', payload: { plan_rev: 1, steps: [{ id: 'pa-scope', catalog: 'understand' }] } },
    { event_id: 2917, event_type: 'wicked.team.plan.proposed', payload: { kind: 'initial', steps: [
      { id: 'pa-scope', catalog: 'understand' }, { id: 'triage', catalog: 'understand' }, { id: 'reproduce', catalog: 'test_plan' },
      { id: 'fix', catalog: 'build', pool: 2 }, { id: 'verify', catalog: 'test' }, { id: 'deliver', catalog: 'deliver' },
    ] } },
    { event_id: 2919, event_type: 'wicked.team.gate.opened', payload: {
      kind: 'plan_approval', gate_id: 'g2', ord: 2, plan_rev: 2, reason: 'manual_mode',
      diff: { added: ['design', 'architecture', 'review', 'security_review'], from_rev: 1 },
    } },
  ],
  units: [],
} as unknown as RunTeamResponse;

describe('the plan editor holds the steps the card proposes', () => {
  it('the gate\'s plan, floor steps in place, with the proposal\'s catalogs and pools', () => {
    const v = planGateOf(team, PROMPT)!;
    expect(v.planSteps.map((s) => s.id)).toEqual(gatePlanOf(PROMPT)!.ids);
    expect(v.planSteps).toHaveLength(10);
    expect(v.planSteps.find((s) => s.id === 'reproduce')?.catalog).toBe('test_plan');
    expect(v.planSteps.find((s) => s.id === 'security_review')?.catalog).toBe('security_review');
    expect(v.editSeed).toEqual(['understand', 'test_plan', 'design', 'architecture', 'build', 'review', 'security_review', 'test']);
    expect(v.editPools).toEqual([null, null, null, null, 2, null, null, null]);
  });

  it('the editor lists the card\'s 10 steps in the card\'s words; the floor\'s steps stay where the floor put them', () => {
    const rows = gateRows(planGateOf(team, PROMPT)!, null);
    expect(rows.map((r) => r.label)).toEqual(['Scope', 'Research', 'Reproduce', 'Design', 'Architecture', 'Fix', 'Review', 'Security check', 'Check', 'Deliver']);
    expect(rows.filter((r) => r.fixed === 'floor').map((r) => r.label)).toEqual(['Design', 'Architecture', 'Review', 'Security check']);
    // the card's sentence names the same steps, the same way
    expect(gatePlanOf(PROMPT)!.ids.map((id) => stepLabelOf(id))).toContain('Security check');
  });

  it('the run\'s step line names the gate\'s steps in the card\'s words too (no "Plan" beside "Reproduce")', () => {
    const fold = hydrateFold(EMPTY_FOLD, { ...team, runId: 'r1', teamed: true, transport: 'bus', reason: null, planRev: 1, ended: false } as RunTeamResponse);
    const line = withGatePlan(chainFromTeam(fold), PROMPT);
    const card = gatePlanLabels(PROMPT, chainFromTeam(fold).steps)!.labels;
    expect(line.steps.map((s) => s.label)).toEqual(card);
    expect(card).toEqual(['Scope', 'Research', 'Reproduce', 'Design', 'Architecture', 'Fix', 'Review', 'Security check', 'Check', 'Deliver']);
    expect(gateRows(planGateOf(team, PROMPT)!, null).map((r) => r.label)).toEqual(card);
  });

  it('an edit sends every step the gate holds, the floor\'s included', () => {
    const v = planGateOf(team, PROMPT)!;
    expect(gateDraftPlan({ seed: v.editSeed, added: [], order: null }).steps.map((s) => s.catalog))
      .toEqual(['understand', 'test_plan', 'design', 'architecture', 'build', 'review', 'security_review', 'test']);
  });

  it('a floor step whose id is not its catalog (`review-floor`) cannot be placed with certainty: the proposal as before (pr-xreview #903)', () => {
    const collided = PROMPT.replace('review (floor)', 'review-floor (floor)');
    expect(planGateOf(team, collided)!.planSteps).toHaveLength(6);
    expect(planGateOf(team, collided)!.editSeed).not.toContain('review-floor');
  });

  it('a prompt that drops or repeats a proposed step (a `. ` inside a step id cut the list): the proposal as before', () => {
    const dropped = PROMPT.replace('verify → ', '');
    expect(planGateOf(team, dropped)!.planSteps).toHaveLength(6);
    const repeated = PROMPT.replace('verify → deliver', 'triage → deliver');
    expect(planGateOf(team, repeated)!.planSteps).toHaveLength(6);
  });

  it('no prompt, or a prompt for another rev: the proposal as before', () => {
    expect(planGateOf(team)!.planSteps).toHaveLength(6);
    expect(planGateOf(team, PROMPT.replace('rev 2', 'rev 3'))!.planSteps).toHaveLength(6);
    expect(planGateOf(team, 'Approve plan rev 2 before unit 2 runs (manual mode): pa-scope → mystery → deliver.')!.planSteps).toHaveLength(6);
  });
});
