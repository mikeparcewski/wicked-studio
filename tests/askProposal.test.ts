import { describe, expect, it } from 'vitest';
import type { TeamRow } from '../src/api/teamPlan.js';
import { askProposal, askLines } from '../src/board/askThread.js';
import { askProposalWords } from '../src/board/proposalCard.js';

/**
 * ASK-S2 (DES-ASK-TEAM-CHAT-001 §4.7): the PA's pending proposal to BUILD — the first-creator change,
 * scored on its declared touch, the floor's review added, the crossing-into-work approval row — and
 * the card's words. Pure.
 */
const RUN = 'r-ask';
let eid = 300;
function row(type: string, payload: Record<string, unknown>): TeamRow {
  eid += 1;
  const at = 1_700_000_000_000 + eid;
  return { event_id: eid, event_type: `wicked.team.${type}`, emitted_at: at, payload: { run_id: RUN, ord: null, attempt: null, by: 'engine', re: null, at, ...payload } };
}
const started = row('path.started', { cli: 'claude', selection: 'random', roster: ['claude', 'codex'], request: 'q', workflow: null, plan: true });
const accepted1 = row('plan.accepted', { plan_rev: 1, workflow_id: `${RUN}:plan-1`, band: '0-19', high_risk: false, mode: 'auto', override: null, proposal_id: 'p-1', touch: [], steps: [{ added_by: 'plan', catalog: 'understand', id: 'answer-1' }] });
const change = row('plan.proposed', { by: 'claude', proposal_id: 'p-2', base_rev: 1, kind: 'change', preset: null, monitors: { asked: 1 }, asks: [], touch: ['src/greet.js', 'test/greet.test.js'], override: null, rationale: '', steps: [{ catalog: 'build', id: 'build-1', instructions: 'trim' }] });
const scored = row('path.scored', { basis: 'intent', score: 25, deterministic: 25, reasons: ['2 files, 12 dependents'], model: null, score_source: 'intent:p-2', signals: { changed_symbols: 1, dependents: 12, products: 1, contract_change: false, test_gap: 0, critical: false, destructive: false, truncated: false }, plan: { depth: 'build', monitors: 1, post_hoc_reviewer: true, post_hoc_other_cli: false }, tree: null });
const revised = row('plan.revised', { plan_rev: 1, proposal_id: 'p-2', reason: 'floor_raised', from_band: '0-19', to_band: '20-39', high_risk: false, added: [{ catalog: 'review', id: 'review', added_by: 'floor', floor_reason: 'band 20+ always reviews' }] });
const opened = row('gate.opened', { gate_id: 'g-2', kind: 'plan_approval', reviewing_ord: 2, plan_rev: 2, band: '20-39', high_risk: false, mode: 'auto', reason: 'first_creator', diff: { from_rev: 1, added: ['build-1', 'review'] } });

describe('askProposal — the pending first-creator change', () => {
  it('reads the steps (floor additions marked), the touch, the band, the dependents, the first_creator row and the accepted rev’s steps', () => {
    const p = askProposal([started, accepted1, change, scored, revised, opened])!;
    expect(p).not.toBeNull();
    expect(p.proposalId).toBe('p-2');
    expect(p.by).toBe('claude');
    expect(p.steps).toStrictEqual([{ id: 'build-1', label: 'build', floor: false, owner: null }, { id: 'review', label: 'check', floor: true, owner: null }]);
    expect(p.touch).toStrictEqual(['src/greet.js', 'test/greet.test.js']);
    expect(p.band).toBe('20-39');
    expect(p.score).toBe(25);
    expect(p.dependents).toBe(12);
    expect(p.firstCreator).toBe(true);
    expect(p.gateOpen).toBe(true);
    expect(p.acceptedSteps).toStrictEqual([{ catalog: 'understand', id: 'answer-1' }]);
  });

  it('is gone once accepted or refused; a change without a creator step is not a proposal', () => {
    const accepted2 = row('plan.accepted', { plan_rev: 2, workflow_id: `${RUN}:plan-2`, band: '20-39', high_risk: false, mode: 'auto', override: null, proposal_id: 'p-2', touch: ['src/greet.js'], steps: [{ catalog: 'understand', id: 'answer-1' }, { catalog: 'build', id: 'build-1' }] });
    expect(askProposal([started, accepted1, change, opened, accepted2])).toBeNull();
    const refused = row('plan.refused', { proposal_id: 'p-2', base_rev: 1, reason: 'NoEligibleSeat' });
    expect(askProposal([started, accepted1, change, refused])).toBeNull();
    const readOnly = row('plan.proposed', { by: 'claude', proposal_id: 'p-3', base_rev: 1, kind: 'change', preset: null, monitors: { asked: 1 }, asks: [], touch: [], override: null, rationale: '', steps: [{ catalog: 'understand', id: 'answer-2' }] });
    expect(askProposal([started, accepted1, readOnly])).toBeNull();
  });

  it('the gate decided closes the question but keeps the proposal until the engine accepts or refuses it', () => {
    const decided = row('gate.decided', { gate_id: 'g-2', kind: 'plan_approval', decision: 'allow', combined: false, team_pause: false, unresolved: [] });
    const p = askProposal([started, accepted1, change, opened, decided])!;
    expect(p.gateOpen).toBe(false);
  });

  it('every row is correlated to ITS proposal: a foreign revision or gate is ignored, a second proposal replaces the first, a decided card never takes a later gate (codex on ASK-S2 #1)', () => {
    const foreignRevised = row('plan.revised', { plan_rev: 1, proposal_id: 'p-9', reason: 'floor_raised', from_band: '0-19', to_band: '70-100', high_risk: true, added: [{ catalog: 'security', id: 'security', added_by: 'floor' }] });
    const p = askProposal([started, accepted1, change, scored, foreignRevised, opened])!;
    expect(p.steps.map((s) => s.id)).not.toContain('security');
    expect(p.band).toBe('20-39'); // the gate's band, not the foreign revision's
    // The gate decided with another gate's id is not this card's answer.
    const foreignDecided = row('gate.decided', { gate_id: 'g-7', kind: 'plan_approval', decision: 'reject', combined: false, team_pause: false, unresolved: [] });
    const q = askProposal([started, accepted1, change, scored, revised, opened, foreignDecided])!;
    expect(q.gateOpen).toBe(true);
    expect(q.decision).toBeNull();
    // Decided (Not now) — a later plan gate on the run is another question; the retained card stays decided.
    const decided = row('gate.decided', { gate_id: 'g-2', kind: 'plan_approval', decision: 'human_amended', combined: false, team_pause: false, unresolved: [] });
    const laterGate = row('gate.opened', { gate_id: 'g-3', kind: 'plan_approval', reviewing_ord: 3, plan_rev: 3, band: '20-39', high_risk: false, mode: 'auto', reason: 'high_risk', diff: { from_rev: 2, added: ['migrate'] } });
    const r = askProposal([started, accepted1, change, scored, revised, opened, decided, laterGate])!;
    expect(r.gateOpen).toBe(false);
    expect(r.decision).toBe('human_amended');
    expect(r.decidedAt).toBe(decided.payload['at']);
    expect(r.steps.map((s) => s.id)).not.toContain('migrate');
    // A second creator proposal replaces the first, with its own rows.
    const change2 = row('plan.proposed', { by: 'claude', proposal_id: 'p-3', base_rev: 2, kind: 'change', preset: null, monitors: { asked: 1 }, asks: [], touch: ['src/greet.js'], override: null, rationale: '', steps: [{ catalog: 'build', id: 'build-2', instructions: 'trim' }] });
    const opened2 = row('gate.opened', { gate_id: 'g-4', kind: 'plan_approval', reviewing_ord: 3, plan_rev: 3, band: '20-39', high_risk: false, mode: 'auto', reason: 'first_creator', diff: { from_rev: 2, added: ['build-2'] } });
    const s = askProposal([started, accepted1, change, scored, revised, opened, decided, change2, opened2])!;
    expect(s.proposalId).toBe('p-3');
    expect(s.gateId).toBe('g-4');
    expect(s.gateOpen).toBe(true);
    expect(s.steps.map((x) => x.id)).toStrictEqual(['build-2']);
  });

  it('a reopen for the SAME plan rev (the engine refused the answer) rebinds the card and reopens its three answers; another rev does not (r2 #1)', () => {
    const decided = row('gate.decided', { gate_id: 'g-2', kind: 'plan_approval', decision: 'human_amended', combined: false, team_pause: false, unresolved: [] });
    const reopen = row('gate.opened', { gate_id: 'g-2b', kind: 'plan_approval', reviewing_ord: 1, plan_rev: 2, band: '20-39', high_risk: false, mode: 'auto', reason: 'first_creator', diff: { from_rev: 1, added: ['build-1', 'review'] } });
    const p = askProposal([started, accepted1, change, scored, revised, opened, decided, reopen])!;
    expect(p.gateId).toBe('g-2b');
    expect(p.gateOpen).toBe(true);
    expect(p.decision).toBeNull();
    expect(p.decidedAt).toBeNull();
    const otherRev = row('gate.opened', { gate_id: 'g-9', kind: 'plan_approval', reviewing_ord: 2, plan_rev: 3, band: '20-39', high_risk: false, mode: 'auto', reason: 'high_risk', diff: { from_rev: 2, added: ['migrate'] } });
    const q = askProposal([started, accepted1, change, scored, revised, opened, decided, otherRev])!;
    expect(q.gateId).toBe('g-2');
    expect(q.gateOpen).toBe(false);
    expect(q.decision).toBe('human_amended');
  });

  it('Not now re-approves the NEWEST accepted rev: a plan.accepted that advances under the card refreshes its steps (#5)', () => {
    const accepted2 = row('plan.accepted', { plan_rev: 2, workflow_id: `${RUN}:plan-2`, band: '0-19', high_risk: false, mode: 'auto', override: null, proposal_id: 'p-answer-2', touch: [], steps: [{ added_by: 'plan', catalog: 'understand', id: 'answer-1' }, { added_by: 'plan', catalog: 'understand', id: 'answer-2' }] });
    const p = askProposal([started, accepted1, change, scored, revised, opened, accepted2])!;
    expect(p.proposalId).toBe('p-2');
    expect(p.acceptedSteps).toStrictEqual([{ catalog: 'understand', id: 'answer-1' }, { catalog: 'understand', id: 'answer-2' }]);
  });

  it('a step is "required" only when the floor added it; the PA’s own addition and an unattributed gate diff stay unmarked (#6)', () => {
    const paAdded = row('plan.revised', { plan_rev: 1, proposal_id: 'p-2', reason: 'pa_added', from_band: '20-39', to_band: '20-39', high_risk: false, added: [{ catalog: 'test', id: 'test-1', added_by: 'plan' }] });
    const openedBare = row('gate.opened', { gate_id: 'g-2', kind: 'plan_approval', reviewing_ord: 2, plan_rev: 2, band: '20-39', high_risk: false, mode: 'auto', reason: 'first_creator', diff: { from_rev: 1, added: ['build-1', 'docs'] } });
    const p = askProposal([started, accepted1, change, scored, revised, paAdded, openedBare])!;
    expect(p.steps).toStrictEqual([
      { id: 'build-1', label: 'build', floor: false, owner: null },
      { id: 'review', label: 'check', floor: true, owner: null },
      { id: 'test-1', label: 'check', floor: false, owner: null },
      { id: 'docs', label: 'docs', floor: false, owner: null },
    ]);
    const words = askProposalWords(p, 'claude');
    expect(words.text).toBe('Continue in Build? claude proposes: Build → Check (required) → Check → Docs.');
  });

  it('a build step the plan gives the TEAM is not claimed for the primary helper’s seat (r5 #1)', () => {
    const teamBuild = row('plan.proposed', { by: 'claude', proposal_id: 'p-7', base_rev: 1, kind: 'change', preset: null, monitors: { asked: 1 }, asks: [], touch: ['src/greet.js'], override: null, rationale: '', steps: [{ catalog: 'build', id: 'build-1', owner: 'team' }] });
    const p = askProposal([started, accepted1, teamBuild])!;
    expect(p.steps[0]).toMatchObject({ id: 'build-1', owner: 'team' });
    expect(askProposalWords(p, 'claude').why).toContain('Continue starts the work — a helper takes the team’s build step');
    expect(askProposalWords(askProposal([started, accepted1, change])!, 'claude').why).toContain("Continue starts the work on claude's seat");
  });

  it('the touch set is declared PATHS, not a file count (r2 #10)', () => {
    const dirScope = row('plan.proposed', { by: 'claude', proposal_id: 'p-6', base_rev: 1, kind: 'change', preset: null, monitors: { asked: 1 }, asks: [], touch: ['src/team/'], override: null, rationale: '', steps: [{ catalog: 'build', id: 'build-1' }] });
    const p = askProposal([started, accepted1, dirScope])!;
    expect(askProposalWords(p, 'claude').why.startsWith('touches 1 declared path · ')).toBe(true);
    expect(askProposalWords(askProposal([started, accepted1, change])!, 'claude').why).toContain('touches 2 declared paths');
  });

  it('the proposal is a card, not a quiet line', () => {
    expect(askLines([started, accepted1, change, opened]).map((l) => l.kind)).toStrictEqual(['who']);
  });
});

describe('askProposalWords — the card', () => {
  it('names the steps, the floor’s additions, the band, the files and the dependents, and the three answers', () => {
    const p = askProposal([started, accepted1, change, scored, revised, opened])!;
    expect(askProposalWords(p, null)).toStrictEqual({
      text: 'Continue in Build? claude proposes: Build → Check (required).',
      why: 'band 20–39 · touches 2 declared paths · 12 dependents · Continue starts the work on claude\'s seat; review runs on a different helper, and the reviewer carries over. Not now keeps the conversation going; End closes it.',
    });
  });

  it('§8 F10 holds once the engine’s band arrives: the no-scope warning stands beside the band (#7)', () => {
    const noScope = row('plan.proposed', { by: 'claude', proposal_id: 'p-5', base_rev: 1, kind: 'change', preset: null, monitors: { asked: 1 }, asks: [], touch: [], override: null, rationale: '', steps: [{ catalog: 'build', id: 'build-1' }] });
    const scoredHigh = row('path.scored', { basis: 'intent', score: 100, deterministic: 100, reasons: ['no declared scope'], model: null, score_source: 'intent:p-5', signals: null, plan: null, tree: null });
    const openedHigh = row('gate.opened', { gate_id: 'g-5', kind: 'plan_approval', reviewing_ord: 2, plan_rev: 2, band: '70-100', high_risk: true, mode: 'auto', reason: 'first_creator', diff: { from_rev: 1, added: ['build-1'] } });
    const p = askProposal([started, accepted1, noScope, scoredHigh, openedHigh])!;
    const words = askProposalWords(p, 'claude');
    expect(words.why.startsWith('band 70–100 · high risk — the helper declared no scope · ')).toBe(true);
  });

  it('§8 F10: a proposal with no declared scope says so (X1 fail-closed: high risk)', () => {
    const bare = row('plan.proposed', { by: 'claude', proposal_id: 'p-9', base_rev: 1, kind: 'change', preset: null, monitors: { asked: 1 }, asks: [], touch: [], override: null, rationale: '', steps: [{ catalog: 'build', id: 'build-1' }] });
    const p = askProposal([started, accepted1, bare])!;
    expect(askProposalWords(p, 'claude').why.startsWith('high risk — the helper declared no scope ·')).toBe(true);
  });
});
