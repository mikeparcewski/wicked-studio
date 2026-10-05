import { describe, expect, it } from 'vitest';
import type { TeamRow } from '../src/api/teamPlan.js';
import { askLines, askPathOf, askShapeLabel, isAskTurnGate } from '../src/board/askThread.js';

/**
 * DES-ASK-TEAM-CHAT-001 §4.8 (slice ASK-S1): the ask thread's quiet lines, folded from the run's
 * `wicked.team.*` rows. Pure. The rows are the shapes the crew lane captured live on the proof
 * daemon (ws.jsonl, 2026-10-05) — field for field.
 */

const RUN = 'r-ask';
let eid = 100;
function row(type: string, payload: Record<string, unknown>, at = 1_700_000_000_000 + eid): TeamRow {
  eid += 1;
  return {
    event_id: eid,
    event_type: `wicked.team.${type}`,
    emitted_at: at,
    payload: { run_id: RUN, ord: null, attempt: null, by: 'engine', re: null, at, ...payload },
  };
}

const started = row('path.started', { cli: 'claude', selection: 'random', roster: ['claude', 'codex'], request: 'why does greet() not trim?', workflow: null, plan: true });
const proposed = row('plan.proposed', {
  by: 'human', proposal_id: 'p-1', base_rev: null, kind: 'initial', preset: null, monitors: { asked: 1 }, asks: [], touch: [], override: null, rationale: '',
  steps: [{ catalog: 'understand', id: 'answer-1', gate: { human_confirm: { unconditional: true } }, budget_secs: 600, instructions: 'why does greet() not trim?' }],
});
const scored = row('path.scored', { basis: 'intent', score: 0, deterministic: 0, reasons: ['no creator step and no declared scope'], model: null, score_source: 'intent:p-1', signals: null, plan: { depth: 'none', monitors: 0, post_hoc_other_cli: false, post_hoc_reviewer: false }, tree: null });
const accepted = row('plan.accepted', {
  plan_rev: 1, workflow_id: 'r-ask:plan-1', band: '0-19', high_risk: false, mode: 'auto', override: null, proposal_id: 'p-1', touch: [],
  steps: [{ added_by: 'plan', catalog: 'understand', id: 'answer-1', gate: { human_confirm: { unconditional: true } }, budget_secs: 600 }],
});
const claimed = row('step.claimed', { by: 'claude', ord: 1, attempt: 0, step_id: 'answer-1', role: 'creator', kind: 'agent', phase: 'understand', criterion: '', baseline_tree: null, repo: null, code_graph_db: null });
const reviewing = row('member.joined', { by: 'codex', ord: 1, attempt: 0, member_id: 'm1', open_seq: 1, seat: 'codex', role: 'monitor', status: 'attached', reason: 'team plan monitors=1', error: null });
const completed = row('step.completed', { by: 'claude', ord: 1, attempt: 0, step_id: 'answer-1', status: 'ok', tree: null, output_bytes: 1068, output_ref: `unit:${RUN}:1:0`, answers_presented: true });
const finding = row('finding.raised', {
  by: 'codex', ord: 1, attempt: 0, raise_seq: 1, finding_id: 'f-1', member_id: 'm1', line_key: null, anchor: null, anchor_source: 'none', severity: 'medium', target: 'output',
  path: 'answer-1', line: 3, evidence: 'greet.js:2 interpolates `name` verbatim', claim: 'the answer cites line 2 but the template literal is on line 3', suggestion: 'cite greet.js:3', tree: '', in_diff: false, corroborated_by: [],
});
const folded = row('ledger.folded', { ord: 1, attempt: 0, final_pass: 'completed', ledger: { finalPass: 'completed', findings: [], monitors: [{ monitorId: 'm1', seat: 'codex', status: 'completed', batches: 1, error: null }], rejected: {}, renderedToJudge: false, teamPause: false }, transport: 'bus', transcript: { from_event_id: 0, to_event_id: 0, count: 0, truncated: false, events: [] } });

describe('askPathOf — who answers, how picked, who watches, what shape', () => {
  it('reads the PA, the random pick and the roster off path.started, the band off plan.accepted, the shape off the accepted steps', () => {
    const p = askPathOf([started, proposed, scored, accepted, claimed, reviewing]);
    expect(p.pa).toBe('claude');
    expect(p.selection).toBe('random');
    expect(p.roster).toStrictEqual(['claude', 'codex']);
    expect(p.score).toStrictEqual({ score: 0, band: '0-19', reasons: ['no creator step and no declared scope'] });
    expect(p.shape.map((s) => `${s.id}:${s.label}`)).toStrictEqual(['answer-1:answer']);
    expect(p.creatorAccepted).toBe(false);
    expect(p.reviewer).toStrictEqual({ seat: 'codex', status: 'attached', error: null });
  });

  it('a re-pick moves the PA; the absent reviewer (seat null) is on record', () => {
    const noReviewer = row('member.joined', { by: 'engine', ord: 1, attempt: 0, member_id: 'm1', open_seq: 1, seat: null, role: 'monitor', status: 'failed', reason: 'team plan monitors=1', error: 'no seat distinct from the PA' });
    const repicked = row('path.repicked', { from: 'claude', to: 'codex', reason: 'timed_out', selection: 'random', pick_seq: 1, ord: 1, attempt: 0 });
    const p = askPathOf([started, accepted, noReviewer, repicked]);
    expect(p.pa).toBe('codex');
    expect(p.reviewer).toStrictEqual({ seat: null, status: 'failed', error: 'no seat distinct from the PA' });
  });

  it('a change that adds a creator step, once accepted, makes the thread a chain (rule 3)', () => {
    const change = row('plan.proposed', { by: 'claude', proposal_id: 'p-2', base_rev: 1, kind: 'change', preset: null, monitors: { asked: 1 }, asks: [], touch: ['src/greet.js'], override: null, rationale: '', steps: [{ catalog: 'build', id: 'build-1', instructions: 'trim the name' }] });
    const accepted2 = row('plan.accepted', { plan_rev: 2, workflow_id: 'r-ask:plan-2', band: '20-39', high_risk: false, mode: 'auto', override: null, proposal_id: 'p-2', touch: ['src/greet.js'], steps: [{ added_by: 'plan', catalog: 'understand', id: 'answer-1' }, { added_by: 'plan', catalog: 'build', id: 'build-1' }, { added_by: 'floor', catalog: 'review', id: 'review', floor_reason: 'band 20+ always reviews' }] });
    expect(askPathOf([started, accepted, change]).creatorAccepted).toBe(false);
    const p = askPathOf([started, accepted, change, accepted2]);
    expect(p.creatorAccepted).toBe(true);
    expect(p.shape.map((s) => s.label)).toStrictEqual(['answer', 'build', 'check']);
  });
});

describe('askShapeLabel — answer / research / check / build from {catalog, owner, gate}', () => {
  it('names the steps as the operator sees them', () => {
    expect(askShapeLabel({ catalog: 'understand', id: 'answer-2', gate: { human_confirm: { unconditional: true } } })).toBe('answer');
    expect(askShapeLabel({ catalog: 'understand', id: 'understand' })).toBe('research');
    expect(askShapeLabel({ catalog: 'review', id: 'review' })).toBe('check');
    expect(askShapeLabel({ catalog: 'test', id: 'test' })).toBe('check');
    expect(askShapeLabel({ catalog: 'build', id: 'build' })).toBe('build');
    expect(askShapeLabel({ catalog: 'deliver', id: 'deliver' })).toBe('deliver');
  });
});

describe('askLines — the quiet lines, in row order, each expandable to its row', () => {
  it('who answers (with the pick, score and shape underneath), the reviewer, a finding on the answer, and the reply is NOT a line', () => {
    const lines = askLines([started, proposed, scored, accepted, claimed, reviewing, completed, finding, folded]);
    expect(lines.map((l) => l.kind)).toStrictEqual(['who', 'reviewer', 'finding']);
    const who = lines[0]!;
    expect(who.text).toBe('claude answers · picked at random');
    expect(who.detail).toStrictEqual([
      'Picked claude at random from claude, codex.',
      'Score 0 · band 0–19 · no creator step and no declared scope.',
      'Shape: answer.',
    ]);
    expect(lines[1]!.text).toBe('codex is reviewing');
    expect(lines[2]!.text).toBe('reviewer · 1 finding: the answer cites line 2 but the template literal is on line 3');
    expect(lines[2]!.detail).toStrictEqual(['Evidence: greet.js:2 interpolates `name` verbatim', 'Suggestion: cite greet.js:3']);
    expect(lines[2]!.ord).toBe(1);
    // Every line carries its row's time so the thread can interleave it with the turns.
    expect(lines.every((l) => l.at > 0)).toBe(true);
  });

  it('the PA answers the finding; the reviewer holds', () => {
    const answered = row('advice.answered', { by: 'claude', ord: 1, attempt: 0, raise_seq: 1, answered_in: 'answer-2:0', finding_id: 'f-1', disposition: 'declined', reason: 'line 2 is the signature; the body starts on 3 and I cited the function' });
    const held = row('finding.settled', { by: 'codex', ord: 1, attempt: 0, raise_seq: 1, finding_id: 'f-1', status: 'held', reason: 'the cited line is still wrong', final_line: 3 });
    const lines = askLines([started, finding, answered, held]);
    const f = lines.find((l) => l.kind === 'finding')!;
    expect(f.text).toBe('reviewer · 1 finding: the answer cites line 2 but the template literal is on line 3 · claude: declined — line 2 is the signature; the body starts on 3 and I cited the function · reviewer holds');
  });

  it('help: asked and answered, timed out, no member', () => {
    const asked = row('help.requested', { by: 'claude', ord: 1, attempt: 0, help_id: 'h-1', help_seq: 1, question: 'is trimming the name a behaviour change callers rely on?', context: '' });
    const answered = row('help.answered', { by: 'codex', ord: 1, attempt: 0, help_id: 'h-1', answer_id: 'a-1', answer: 'No caller passes padded names; trimming is safe.', evidence: [], outcome: 'answered', error: null });
    const asked2 = row('help.requested', { by: 'claude', ord: 1, attempt: 0, help_id: 'h-2', help_seq: 2, question: 'check the migration', context: '' });
    const timedOut = row('help.answered', { by: 'codex', ord: 1, attempt: 0, help_id: 'h-2', answer_id: 'a-2', answer: null, evidence: [], outcome: 'timed_out', error: 'member turn exceeded 240 s' });
    const asked3 = row('help.requested', { by: 'claude', ord: 1, attempt: 0, help_id: 'h-3', help_seq: 3, question: 'second opinion?', context: '' });
    const nobody = row('help.answered', { by: 'engine', ord: 1, attempt: 0, help_id: 'h-3', answer_id: 'a-3', answer: null, evidence: [], outcome: 'no_member', error: null });
    const lines = askLines([started, asked, answered, asked2, timedOut, asked3, nobody]).filter((l) => l.kind === 'help');
    expect(lines.map((l) => l.text)).toStrictEqual([
      'asked codex: is trimming the name a behaviour change callers rely on? · answered',
      'asked codex: check the migration · codex did not answer (timed out)',
      'asked for help: second opinion? · no other helper is signed in',
    ]);
    expect(lines[0]!.detail).toStrictEqual(['No caller passes padded names; trimming is safe.']);
    expect(lines[1]!.detail).toStrictEqual(['member turn exceeded 240 s']);
  });

  it('no reviewer on a one-seat roster — with the Sign in action; a seat that cannot join says why', () => {
    const none = row('member.joined', { by: 'engine', ord: 1, attempt: 0, member_id: 'm1', open_seq: 1, seat: null, role: 'monitor', status: 'failed', reason: 'team plan monitors=1', error: 'no seat distinct from the PA' });
    const cannot = row('member.joined', { by: 'codex', ord: 1, attempt: 0, member_id: 'm1', open_seq: 1, seat: 'codex', role: 'monitor', status: 'failed', reason: 'team plan monitors=1', error: "seat 'codex' has no ACP adapter configured" });
    const [a] = askLines([started, none]).filter((l) => l.kind === 'reviewer');
    expect(a!.text).toBe('No reviewer — only claude is signed in.');
    expect(a!.action).toBe('signin');
    const [b] = askLines([started, cannot]).filter((l) => l.kind === 'reviewer');
    expect(b!.text).toBe("No reviewer — codex can't join: seat 'codex' has no ACP adapter configured");
    expect(b!.action).toBeUndefined();
  });

  it('a second attempt on the same reviewer is not a second line (first attempt only)', () => {
    const again = row('member.joined', { by: 'codex', ord: 1, attempt: 1, member_id: 'm2', open_seq: 2, seat: 'codex', role: 'monitor', status: 'attached', reason: 'team plan monitors=1', error: null });
    expect(askLines([started, reviewing, again]).filter((l) => l.kind === 'reviewer')).toHaveLength(1);
  });

  it('timeouts, re-picks, the reviewer running out of time, a refused plan, the end', () => {
    const timedOut = row('step.completed', { by: 'claude', ord: 1, attempt: 0, step_id: 'answer-1', status: 'timed_out', tree: null, output_bytes: 0, output_ref: `unit:${RUN}:1:0` });
    const repicked = row('path.repicked', { from: 'claude', to: 'codex', reason: 'timed_out', selection: 'random', pick_seq: 1, ord: 1, attempt: 0 });
    const slow = row('ledger.folded', { ord: 1, attempt: 1, final_pass: 'timed_out', ledger: { finalPass: 'timed_out', findings: [], monitors: [], rejected: {}, renderedToJudge: false, teamPause: false }, transport: 'bus', transcript: { from_event_id: 0, to_event_id: 0, count: 0, truncated: false, events: [] } });
    const refusedSeat = row('plan.refused', { by: 'engine', proposal_id: 'p-2', base_rev: 1, reason: 'NoEligibleSeat: no seat distinct from the creator seat claude' });
    const refusedRepo = row('plan.refused', { by: 'engine', proposal_id: 'p-3', base_rev: 1, reason: 'no repo bound' });
    const ended = row('path.ended', { status: 'cancelled' });
    const lines = askLines([started, accepted, timedOut, repicked, slow, refusedSeat, refusedRepo, ended]);
    expect(lines.map((l) => [l.kind, l.text])).toStrictEqual([
      ['who', 'claude answers · picked at random'],
      ['timeout', 'claude didn’t answer in 10 min'],
      ['repick', 'codex takes over — claude stopped answering'],
      ['reviewer', 'reviewer did not answer in time'],
      // The re-pick above moved the PA to codex: the one-seat refusal names the CURRENT PA.
      ['refused', 'Can’t build from here: only codex is signed in; sign in another helper so review can run.'],
      ['refused', 'This conversation isn’t attached to a repo — open one from a project to build.'],
      ['ended', 'Conversation ended'],
    ]);
    expect(lines[1]!.tone).toBe('problem');
    expect(lines[2]!.tone).toBe('problem');
    expect(lines[4]!.action).toBe('signin');
  });

  it('a restart redrives the answer as attempt+1 on the same seat: "started over"', () => {
    const again = row('step.claimed', { by: 'claude', ord: 1, attempt: 1, step_id: 'answer-1', role: 'creator', kind: 'agent', phase: 'understand', criterion: '', baseline_tree: null, repo: null, code_graph_db: null });
    const lines = askLines([started, accepted, claimed, again]);
    expect(lines.map((l) => l.kind)).toStrictEqual(['who', 'restart']);
    expect(lines[1]!.text).toBe('claude started over after a restart');
  });

  it('tree findings and creator-step rows are not ask lines (the chain draws them)', () => {
    const tree = row('finding.raised', { by: 'codex', ord: 2, attempt: 0, raise_seq: 1, finding_id: 'f-9', member_id: 'm1', line_key: 'k', anchor: null, anchor_source: 'hunk', severity: 'high', target: 'tree', path: 'src/greet.js', line: 3, evidence: 'e', claim: 'c', suggestion: null, tree: 'abc', in_diff: true, corroborated_by: [] });
    const buildClaimed = row('step.claimed', { by: 'claude', ord: 2, attempt: 0, step_id: 'build-1', role: 'creator', kind: 'agent', phase: 'build', criterion: '', baseline_tree: 'abc', repo: null, code_graph_db: null });
    expect(askLines([started, tree, buildClaimed]).map((l) => l.kind)).toStrictEqual(['who']);
  });
});

describe('isAskTurnGate — the turn gate draws nothing, and only the turn gate', () => {
  const know = (creator = false) => ({ runs: new Set(['r-ask']), creatorAccepted: creator ? { 'r-ask': true } : {} });
  it('a def/terminal gate on a creator-less ask run is the turn gate; a deliver, escalation or plan_approval gate is not; another run never is', () => {
    expect(isAskTurnGate(know(), 'r-ask', 'def')).toBe(true);
    expect(isAskTurnGate(know(), 'r-ask', 'terminal')).toBe(true);
    expect(isAskTurnGate(know(), 'r-ask', 'deliver')).toBe(false);
    expect(isAskTurnGate(know(), 'r-ask', 'escalation')).toBe(false);
    expect(isAskTurnGate(know(), 'r-ask', 'plan_approval')).toBe(false);
    expect(isAskTurnGate(know(), 'r-other', 'def')).toBe(false);
  });
  it('once a creator step is accepted every gate is real work’s and is drawn (codex #1)', () => {
    expect(isAskTurnGate(know(true), 'r-ask', 'def')).toBe(false);
    expect(isAskTurnGate(know(true), 'r-ask', 'terminal')).toBe(false);
  });
  it('a gate with no kind (a late join’s GET /runs/:id/gate) is classified by the engine’s own words (codex #3)', () => {
    expect(isAskTurnGate(know(), 'r-ask', undefined, 'Approve unit 2 before it runs. The work: answer-2 — why?')).toBe(true);
    expect(isAskTurnGate(know(), 'r-ask', undefined, 'Approve the output of unit 1 (answer-1) — the plan is complete.')).toBe(true);
    expect(isAskTurnGate(know(), 'r-ask', undefined, 'Approve delivery before unit 2 runs. Pushes branch wicked/x to origin.')).toBe(false);
    expect(isAskTurnGate(know(), 'r-ask', undefined, 'Approve plan rev 2 before unit 2 runs: build-1 → review.')).toBe(false);
    expect(isAskTurnGate(know(), 'r-ask', undefined, 'The deliver phase refused: fatal: origin does not exist')).toBe(false);
    expect(isAskTurnGate(know(), 'r-ask', undefined)).toBe(false);
  });
});

describe('history is not rewritten by a re-pick (codex #10)', () => {
  it('the who-line keeps the FIRST pick; the absent-reviewer line names the PA of its own moment', () => {
    const chosen = row('path.started', { cli: 'claude', selection: 'chosen', roster: ['claude', 'codex'], request: 'q', workflow: null, plan: true });
    const none = row('member.joined', { by: 'engine', ord: 1, attempt: 0, member_id: 'm1', open_seq: 1, seat: null, role: 'monitor', status: 'failed', reason: 'team plan monitors=1', error: 'no seat distinct from the PA' });
    const repicked = row('path.repicked', { from: 'claude', to: 'codex', reason: 'timed_out', selection: 'random', pick_seq: 1, ord: 1, attempt: 0 });
    const lines = askLines([chosen, accepted, none, repicked]);
    expect(lines[0]!.text).toBe('claude answers · your pick');
    expect(lines[0]!.detail[0]).toBe('You picked claude from claude, codex.');
    expect(lines[1]!.text).toBe('No reviewer — only claude is signed in.');
    expect(askPathOf([chosen, accepted, none, repicked]).pa).toBe('codex');
  });
});

describe('every quiet line expands to its row (codex #12)', () => {
  it('a timeout, a re-pick, a restart and the end carry the row’s fact underneath', () => {
    const timedOut = row('step.completed', { by: 'claude', ord: 1, attempt: 0, step_id: 'answer-1', status: 'timed_out', tree: null, output_bytes: 0, output_ref: `unit:${RUN}:1:0` });
    const repicked = row('path.repicked', { from: 'claude', to: 'codex', reason: 'timed_out', selection: 'random', pick_seq: 1, ord: 1, attempt: 0 });
    const again = row('step.claimed', { by: 'codex', ord: 1, attempt: 2, step_id: 'answer-1', role: 'creator', kind: 'agent', phase: 'understand', criterion: '', baseline_tree: null, repo: null, code_graph_db: null });
    const ended = row('path.ended', { status: 'cancelled' });
    const lines = askLines([started, accepted, timedOut, repicked, again, ended]);
    for (const l of lines) expect(l.detail.length, `${l.kind} has a detail`).toBeGreaterThan(0);
    expect(lines.find((l) => l.kind === 'timeout')!.detail[0]).toMatch(/^answer-1 · attempt 0 · timed_out at \d{4}-/);
    expect(lines.find((l) => l.kind === 'repick')!.detail[0]).toMatch(/^timed_out · re-pick 1 · at /);
    expect(lines.find((l) => l.kind === 'restart')!.detail[0]).toMatch(/^answer-1 · attempt 2 · at /);
    expect(lines.find((l) => l.kind === 'ended')!.detail[0]).toMatch(/^cancelled · at /);
  });
});
