// @vitest-environment node
import { gatePlanOf, stepLabelOf, withGatePlan } from '../src/board/chainModel.js';
import { describe, expect, it } from 'vitest';
import type { SessionView, SessionWithDelivery } from '../src/api/types.js';
import type { ChainModel, ChainStep } from '../src/board/chainModel.js';
import { IDLE_GATE_ACTION } from '../src/board/gateActions.js';
import {
  gateInstance, handedOf, outcomeLine, planSentence, planSteps, proposalCard, proposalKindOf, statusSentence,
} from '../src/board/proposalCard.js';
import { basedOnLine, parsePlace, passageCandidates, passageHasLine, passageWindow, sourcesOf } from '../src/board/sources.js';
import type { OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

/**
 * S6b (DES-STUDIO-REBUILD-001 §3 scenes 07/08/24/33/34/42): the proposal card, the status sentence
 * and the sources — pure models the session renders.
 */

const PLAN_PROMPT = 'Approve plan rev 2 before unit 2 runs (manual mode; band 20-39; manual mode): understand → build → test → review → deliver';
const NO_UI = { dismissed: null, confirming: null };

function step(id: string, label: string, state: ChainStep['state']): ChainStep {
  return { id, catalog: id, block: 'build', label, state, addedBy: 'pa' };
}
function chain(steps: ChainStep[], over: Partial<ChainModel> = {}): ChainModel {
  return {
    source: 'team', steps, proposed: false, transportLine: null, checked: null,
    done: steps.filter((s) => s.state === 'done').length, total: steps.length, ...over,
  };
}
const EMPTY: ChainModel = { source: 'units', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };

function run(id: string, status: SessionView['session']['status'], units = [makeUnit({ id: `${id}:build`, session_id: id, ord: 1, status: 'pending', phase_ref: 'build' })]): SessionView {
  return makeView({ id, status, problem: 'Fix the double charge', workdir: `/w/${id}` }, units);
}
const openGate = (over: Partial<OpenGate>): OpenGate => ({ runId: 'r1', lifecycle: 'open', prompt: '', receivedAt: 1, ord: 1, ...over });
const planGate = (ord = 2): OpenGate => openGate({ prompt: PLAN_PROMPT, ord, gateKind: 'plan_approval' });

describe('the proposal: the plan, in one sentence, with Go / Not now', () => {
  it('a plan gate proposes its steps, from the prompt before the team plan reaches the bus', () => {
    const c = proposalCard({ view: run('r1', 'awaiting_human'), gate: planGate(), chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI })!;
    expect(c.kind).toBe('plan');
    expect(c.state).toBe('ask');
    expect(c.text).toBe('Here’s the plan: Research → Build → Test → Review → Deliver (5 steps).');
    expect(c.act).toBe('Go');
    expect(c.text).not.toMatch(/rev|unit|band|mode/);
  });

  it('the gate’s own plan decides which steps (studio#470); the proposed chain stands in only when the prompt lists none', () => {
    const proposed = chain([step('a', 'Research', 'todo'), step('b', 'Build', 'todo')], { proposed: true });
    expect(planSteps(proposed, PLAN_PROMPT)).toStrictEqual(['Research', 'Build', 'Test', 'Review', 'Deliver']);
    expect(planSteps(proposed, 'Approve the plan?')).toStrictEqual(['Research', 'Build']);
    expect(planSentence(['Research'])).toBe('Here’s the plan: Research (1 step).');
  });

  it('a queued or in-flight Go shows "Going" (a second Go is the decision path’s to drop)', () => {
    const c = proposalCard({ view: run('r1', 'awaiting_human'), gate: planGate(), chain: EMPTY, action: { ...IDLE_GATE_ACTION, queued: true }, ui: NO_UI })!;
    expect(c.state).toBe('run');
    expect(c.runLabel).toBe('Going');
  });

  it('a refused answer says why and keeps its buttons', () => {
    const c = proposalCard({ view: run('r1', 'awaiting_human'), gate: planGate(), chain: EMPTY, action: { ...IDLE_GATE_ACTION, error: 'gate_changed: the gate moved' }, ui: NO_UI })!;
    expect(c.state).toBe('fail');
    expect(c.reason).toBe('gate_changed: the gate moved');
    expect(c.canRetry).toBe(true);
    expect(c.act).toBe('Try again');
  });

  it('"Not now" sends nothing and keeps the proposal, for this gate only', () => {
    const c = proposalCard({ view: run('r1', 'awaiting_human'), gate: planGate(2), chain: EMPTY, action: IDLE_GATE_ACTION, ui: { dismissed: gateInstance(planGate(2)), confirming: null } })!;
    expect(c.state).toBe('no');
    expect(c.text).toBe('Not now — nothing started.');
    const next = proposalCard({ view: run('r1', 'awaiting_human'), gate: planGate(5), chain: EMPTY, action: IDLE_GATE_ACTION, ui: { dismissed: gateInstance(planGate(2)), confirming: null } })!;
    expect(next.state).toBe('ask');
    // The same ord reopened (a new gate instance) asks afresh (Copilot).
    const reopened = openGate({ prompt: PLAN_PROMPT, ord: 2, gateKind: 'plan_approval', receivedAt: 99 });
    const again = proposalCard({ view: run('r1', 'awaiting_human'), gate: reopened, chain: EMPTY, action: IDLE_GATE_ACTION, ui: { dismissed: gateInstance(planGate(2)), confirming: null } })!;
    expect(again.state).toBe('ask');
  });

  it('becomes its progress, then its receipt (one outcome line)', () => {
    const live = chain([step('a', 'Research', 'done'), step('b', 'Build', 'running'), step('c', 'Test', 'todo')]);
    const going = proposalCard({ view: run('r1', 'executing'), gate: undefined, chain: live, action: IDLE_GATE_ACTION, ui: NO_UI })!;
    expect(going.state).toBe('run');
    expect(going.live).toBe('Build is running · 1 of 3 done');
    const doneChain = chain([step('a', 'Research', 'done'), step('b', 'Build', 'done')]);
    const v = run('r1', 'completed');
    (v.session as SessionWithDelivery).delivery = 'delivered';
    const done = proposalCard({ view: v, gate: undefined, chain: doneChain, action: IDLE_GATE_ACTION, ui: NO_UI })!;
    expect(done.state).toBe('done');
    expect(done.out).toBe('Finished · delivered');
  });

  it('just answered, before the accepted plan reaches the bus, it reads "Going"', () => {
    const proposed = chain([step('a', 'Research', 'todo')], { proposed: true });
    const c = proposalCard({ view: run('r1', 'awaiting_human'), gate: undefined, chain: proposed, action: { ...IDLE_GATE_ACTION, answered: 'approved' }, ui: NO_UI, lastKind: 'plan' })!;
    expect(c.state).toBe('run');
    expect(c.runLabel).toBe('Going');
  });

  it('a run that never proposed has no card; def/run_level/unit_review gates go to GateRow (null from ProposalCard)', () => {
    expect(proposalCard({ view: run('r1', 'executing'), gate: undefined, chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI })).toBeNull();
    const plain = openGate({ prompt: 'Approve the TTL bump?', ord: 1, gateKind: 'def' });
    expect(proposalCard({ view: run('r1', 'awaiting_human'), gate: plain, chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI })).toBeNull();
  });
});

describe('Copilot r1 on the proposal model', () => {
  it('a plan prompt’s trailing instruction is not a step; a units chain or an accepted plan never stands in for the proposal', () => {
    const prompt = 'Approve plan rev 2 before unit 2 runs (manual mode; band 70-100; manual mode): understand → design → deliver. Approve, approve with an edited plan, or reject.';
    expect(planSteps(EMPTY, prompt)).toStrictEqual(['Research', 'Plan', 'Deliver']);
    const units: ChainModel = { ...EMPTY, source: 'units', steps: [step('u0', 'raw unit description', 'todo')], total: 1 };
    expect(planSteps(units, prompt)).toStrictEqual(['Research', 'Plan', 'Deliver']);
    const accepted = chain([step('a', 'Old step', 'done')]);
    expect(planSteps(accepted, prompt)).toStrictEqual(['Research', 'Plan', 'Deliver']);
  });

  it('a plan gate is classified first, and an escalation on the deliver unit is never a hand-over', () => {
    const units = [makeUnit({ id: 'r9:deliver', session_id: 'r9', ord: 2, status: 'pending', phase_ref: 'deliver' })];
    const lift = openGate({ runId: 'r9', ord: 2, prompt: 'Unit 2 failed: deliver: LIFT-CONFLICT — rebase onto origin/main conflicted; nothing pushed' });
    expect(proposalKindOf('r9', lift, units)).toBeNull();
    expect(proposalKindOf('r9', openGate({ runId: 'r9', ord: 2, gateKind: 'escalation', prompt: 'x' }), units)).toBeNull();
    expect(proposalKindOf('r9', openGate({ runId: 'r9', ord: 2, gateKind: 'plan_approval', prompt: 'x' }), units)).toBe('plan');
  });

  it('"Starting" lasts only until the daemon moves the run; then the card is live progress', () => {
    const live = chain([step('a', 'Research', 'running')]);
    const answered = { ...IDLE_GATE_ACTION, answered: 'approved' as const };
    expect(proposalCard({ view: run('r1', 'awaiting_human'), gate: undefined, chain: live, action: answered, ui: NO_UI })!.live).toBe('Starting the work');
    expect(proposalCard({ view: run('r1', 'executing'), gate: undefined, chain: live, action: answered, ui: NO_UI })!.live).toBe('Research is running · 0 of 1 done');
  });

  it('a remembered proposal keeps its card on a non-team run, through to its receipt; a late join reads a hand-over from the deliver unit', () => {
    const done = run('r1', 'completed');
    expect(proposalCard({ view: done, gate: undefined, chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI, lastKind: 'deliver' })!.state).toBe('done');
    const delivering = makeView({ id: 'r7', status: 'executing', unit_ix: 1, problem: 'x' }, [
      makeUnit({ id: 'r7:build', session_id: 'r7', ord: 0, status: 'done' }),
      makeUnit({ id: 'r7:deliver', session_id: 'r7', ord: 1, status: 'distributed', phase_ref: 'deliver' }),
    ]);
    const c = proposalCard({ view: delivering, gate: undefined, chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI })!;
    expect(c.kind).toBe('deliver');
    expect(c.runLabel).toBe('Handing over');
  });

  it('the status sentence never says work started while an answer is queued or sending', () => {
    const g = planGate();
    expect(statusSentence(run('r', 'awaiting_human'), EMPTY, g, { ...IDLE_GATE_ACTION, queued: true })).toBe('Your answer goes in a moment — Undo is in the notice');
    expect(statusSentence(run('r', 'awaiting_human'), EMPTY, g, { ...IDLE_GATE_ACTION, busy: true })).toBe('Sending your answer');
    expect(statusSentence(run('r', 'awaiting_human'), EMPTY, g, IDLE_GATE_ACTION)).toBe('Waiting on your go for the plan');
  });

  it('a corrected citation without its real place is not a source; a missing line is not "shown"', () => {
    expect(sourcesOf({ verified: 0, unverifiable: 0, corrected: 1, unchecked: 0, items: [{ raw: 'src/a.ts:3', kind: 'line', status: 'corrected' }] })).toStrictEqual([]);
    expect(passageHasLine('a\nb', 2)).toBe(true);
    expect(passageHasLine('a\nb', 9)).toBe(false);
    expect(passageHasLine('a', null)).toBe(true);
    // A trailing newline is not a line; empty content has none (Copilot r2).
    expect(passageHasLine('a\n', 2)).toBe(false);
    expect(passageHasLine('', 1)).toBe(false);
    expect(passageHasLine('a\nb\n', 2)).toBe(true);
  });
});

describe('Copilot r3 (past the cap: small, user-visible)', () => {
  it('a step label never carries the engine’s instruction segment', () => {
    const c = chain([step('d', 'deliver — Fix it ||| Pushes branch x to origin. Push identity: gh', 'running')], { source: 'units' });
    expect(statusSentence(run('r', 'executing'), c, undefined)).toBe('deliver — Fix it is running · 0 of 1 done');
  });

  it('a cancelled run reads Cancelled, neutral, not a failure', () => {
    const c = chain([step('a', 'Research', 'done')]);
    const card = proposalCard({ view: run('r1', 'cancelled'), gate: undefined, chain: c, action: IDLE_GATE_ACTION, ui: NO_UI, lastKind: 'plan' })!;
    expect(card.state).toBe('cancelled');
    expect(card.out).toBe('Cancelled · 1 of 1 done');
  });

  it('r4: a late join never infers a hand-over while an escalation waits on the operator', () => {
    const units = [
      makeUnit({ id: 'r9:build', session_id: 'r9', ord: 1, status: 'done' }),
      makeUnit({ id: 'r9:deliver', session_id: 'r9', ord: 2, status: 'rejected', phase_ref: 'deliver' }),
    ];
    const lift = openGate({ runId: 'r9', ord: 2, gateKind: 'escalation', prompt: 'deliver: LIFT-CONFLICT — nothing pushed' });
    const c = proposalCard({ view: run('r9', 'awaiting_human', units), gate: lift, chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI });
    expect(c).toBeNull();
  });

  it('a line-range citation opens at its first line', () => {
    expect(parsePlace('src/a.ts:12-20')).toStrictEqual({ path: 'src/a.ts', line: 12 });
  });
});

describe('the deliver card: the one "Are you sure?"', () => {
  const units = [
    makeUnit({ id: 'r9:build', session_id: 'r9', ord: 1, status: 'done', phase_ref: 'build' }),
    makeUnit({ id: 'r9:deliver', session_id: 'r9', ord: 2, status: 'pending', phase_ref: 'deliver', description: 'deliver — Fix it ||| Pushes branch wicked/r9 to acme/shop on GitHub and opens a pull request there; merge stays human. Push identity: gh' }),
  ];
  const gate = openGate({ runId: 'r9', prompt: 'Approve unit 2 before it runs: deliver', ord: 2, gateKind: 'deliver' });

  it('asks with what it sends off the machine, then confirms', () => {
    const v = run('r9', 'awaiting_human', units);
    expect(proposalKindOf('r9', gate, units)).toBe('deliver');
    const ask = proposalCard({ view: v, gate, chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI })!;
    expect(ask.state).toBe('ask');
    expect(ask.act).toBe('Deliver');
    // studio#444: one plain sentence from the card's parts, never the card's own words.
    expect(ask.why).toBe('Pushes your changes as a new branch to acme/shop on GitHub and opens a pull request there. Merging stays yours.');
    const sure = proposalCard({ view: v, gate, chain: EMPTY, action: IDLE_GATE_ACTION, ui: { dismissed: null, confirming: gateInstance(gate) } })!;
    expect(sure.state).toBe('confirm');
    expect(sure.confirm).toStrictEqual({ q: 'This leaves studio.', w: ask.why, a: 'Yes, deliver' });
  });

  it('without the unit’s target sentence the pull request is a condition, never a promise', () => {
    const bare = [units[0]!, makeUnit({ id: 'r9:deliver', session_id: 'r9', ord: 2, status: 'pending', phase_ref: 'deliver', description: 'deliver' })];
    const ask = proposalCard({ view: run('r9', 'awaiting_human', bare), gate, chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI })!;
    expect(ask.why).toMatch(/a pull request opens only if that origin is on GitHub/);
  });
});

describe('after an accepted hand-over is pruned', () => {
  it('still reads as a hand-over, not a plan (codex)', () => {
    const c = proposalCard({ view: run('r9', 'awaiting_human'), gate: undefined, chain: EMPTY, action: { ...IDLE_GATE_ACTION, answered: 'approved' }, ui: NO_UI, lastKind: 'deliver' })!;
    expect(c.kind).toBe('deliver');
    expect(c.runLabel).toBe('Handing over');
  });
});

describe('the status sentence and the outcome line', () => {
  it('says what is happening in words', () => {
    const c = chain([step('a', 'Research', 'done'), step('b', 'Build', 'failed')]);
    expect(statusSentence(run('r', 'failed'), c, undefined)).toBe('Stopped at Build · 1 of 2 done');
    expect(statusSentence(run('r', 'awaiting_human'), c, planGate())).toBe('Waiting on your go for the plan · 1 of 2 done');
    expect(statusSentence(run('r', 'executing'), EMPTY, undefined)).toBe('Being worked on');
  });

  it('a kept-local run and a stranded one read differently; neither promises a PR', () => {
    const kept = run('k', 'completed', [makeUnit({ id: 'k:build', session_id: 'k', status: 'done' })]);
    (kept.session as SessionWithDelivery).delivery = 'stranded';
    expect(outcomeLine(kept)).toBe('Finished · kept on this machine, not pushed');
    const stuck = run('s', 'completed', [makeUnit({ id: 's:deliver', session_id: 's', status: 'rejected' })]);
    (stuck.session as SessionWithDelivery).delivery = 'stranded';
    expect(outcomeLine(stuck)).toBe('Finished, but the work hasn’t been pushed anywhere yet');
  });
});

describe('sources: "Based on N sources", hover, the passage', () => {
  const cites = {
    verified: 3, unverifiable: 1, corrected: 1, unchecked: 1,
    items: [
      { raw: 'src/checkout.ts:42', kind: 'line' as const, status: 'verified' as const },
      { raw: 'src/pay.ts:10', kind: 'line' as const, status: 'corrected' as const, resolved: 'src/pay.ts:14', note: 'the line moved' },
      { raw: 'README.md', kind: 'path' as const, status: 'verified' as const },
      { raw: 'src/checkout.ts:42', kind: 'line' as const, status: 'verified' as const },
      { raw: 'deadbeef', kind: 'sha' as const, status: 'verified' as const },
      { raw: 'src/ghost.ts', kind: 'path' as const, status: 'unverified' as const },
      { raw: 'src/far.ts', kind: 'path' as const, status: 'unchecked' as const },
    ],
  };

  it('only confirmed places are sources, each once, at the corrected place', () => {
    const s = sourcesOf(cites);
    expect(s.map((x) => x.label)).toStrictEqual(['checkout.ts:42', 'pay.ts:14', 'README.md']);
    expect(s[1]!.hover).toBe('src/pay.ts:14 (the reply said src/pay.ts:10) — the line moved');
    expect(basedOnLine(s.length)).toBe('Based on 3 sources');
    expect(basedOnLine(0)).toBeNull();
    expect(sourcesOf(undefined)).toStrictEqual([]);
  });

  it('parses places and builds contained candidates under the run’s worktree', () => {
    expect(parsePlace('src/a.ts:42')).toStrictEqual({ path: 'src/a.ts', line: 42 });
    expect(parsePlace('src/a.ts:charge')).toStrictEqual({ path: 'src/a.ts', line: null });
    expect(passageCandidates('alpha/src/a.ts', '/w/r1/')).toStrictEqual(['/w/r1/alpha/src/a.ts']);
    expect(passageCandidates('../etc/passwd', '/w/r1')).toStrictEqual([]);
    expect(passageCandidates('a.ts', null)).toStrictEqual([]);
  });

  it('the passage is the lines around the cited one, that line marked', () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    const w = passageWindow(text, 15, 2);
    expect(w.map((l) => l.n)).toStrictEqual([13, 14, 15, 16, 17]);
    expect(w.filter((l) => l.hit).map((l) => l.n)).toStrictEqual([15]);
    expect(passageWindow(text, null, 1).length).toBe(3);
  });
});

describe('studio#442: the proposal names the steps the chain names', () => {
  const REEL_PROMPT = 'Approve plan rev 2 before unit 2 runs (manual mode; band 0-19; manual mode): pa-scope → clarify → design → build → adversarial-review → test → review';
  it('the prompt fallback says each step id in the chain’s words, never "Pa scope"', () => {
    expect(planSteps(EMPTY, REEL_PROMPT)).toStrictEqual(['Scope', 'Clarify', 'Plan', 'Build', 'Challenge', 'Test', 'Review']);
  });
  it('a pending proposal on the team bus is the plan the card proposes when the gate lists no steps; the gate’s list wins (studio#470)', () => {
    const pending = [step('pa-scope', 'Scope', 'todo'), step('build', 'Build', 'todo')];
    const accepted = chain([step('pa-scope', 'Scope', 'done')], { pending });
    expect(planSteps(accepted, 'Approve the next plan?')).toStrictEqual(['Scope', 'Build']);
    expect(planSteps(accepted, REEL_PROMPT)).toStrictEqual(['Scope', 'Clarify', 'Plan', 'Build', 'Challenge', 'Test', 'Review']);
  });
});

/** studio#470: the proposal and the chain name the steps the run will run — the gate's own plan,
 *  floor additions included — in the words the chain keeps after Go. */
describe('the floor-filled plan (studio#470)', () => {
  const FLOOR_PROMPT = 'Approve plan rev 2 before unit 1 runs (high risk: auto mode still requires approval; band 60-79, high risk; auto mode): '
    + 'pa-scope → clarify → test_plan (floor) → design → architecture (floor) → build → adversarial-review → test → review → '
    + 'security_review (floor) → deliver. Floor added: test_plan, architecture, security_review';
  const AFTER_GO = ['Scope', 'Clarify', 'Test plan', 'Design', 'Architecture', 'Build', 'Challenge', 'Test', 'Review', 'Security check', 'Deliver'];
  // The PA's proposal on the bus, before the floor filled it: 8 steps.
  const PA = chain(['pa-scope', 'clarify', 'design', 'build', 'adversarial-review', 'test', 'review', 'deliver']
    .map((id) => step(id, stepLabelOf(id), 'todo')), { proposed: true });

  it('the gate\'s plan parsed: ids without the floor marker, and which ones the floor added', () => {
    expect(gatePlanOf(FLOOR_PROMPT)).toStrictEqual({
      ids: ['pa-scope', 'clarify', 'test_plan', 'design', 'architecture', 'build', 'adversarial-review', 'test', 'review', 'security_review', 'deliver'],
      floor: ['test_plan', 'architecture', 'security_review'],
    });
    expect(gatePlanOf('Approve unit 1 before it runs: triage')).toBeNull();
  });

  it('the proposal counts and names the 11 steps the run will run, as the chain names them after Go', () => {
    expect(planSteps(PA, FLOOR_PROMPT)).toStrictEqual(AFTER_GO);
    const c = proposalCard({ view: run('r1', 'awaiting_human'), gate: openGate({ prompt: FLOOR_PROMPT, ord: 1, gateKind: 'plan_approval' }), chain: PA, action: IDLE_GATE_ACTION, ui: NO_UI })!;
    expect(c.text).toBe(`Here’s the plan: ${AFTER_GO.join(' → ')} (11 steps).`);
    expect(c.why ?? '').toContain('3 required by the floor: Test plan, Architecture, Security check');
  });

  it('the chain under it shows the same 11 while the gate waits — the floor steps marked as the floor\'s', () => {
    const shown = withGatePlan(PA, FLOOR_PROMPT);
    expect(shown.steps.map((s) => s.label)).toStrictEqual(AFTER_GO);
    expect(shown.total).toBe(11);
    expect(shown.steps.filter((s) => s.addedBy === 'floor').map((s) => s.id)).toStrictEqual(['test_plan', 'architecture', 'security_review']);
    // An accepted plan is the run's own: the gate's plan never rewrites it.
    const accepted = chain(PA.steps, { proposed: false });
    expect(withGatePlan(accepted, FLOOR_PROMPT)).toBe(accepted);
  });
});

/** S15e boundary: def / run_level / unit_review gates belong to GateRow, not ProposalCard. */
describe('def / run_level / unit_review gates: ProposalCard returns null (GateRow handles them)', () => {
  const PRE = 'Approve unit 1 before it runs: triage — SAVE20 should give twenty percent off ||| PHASE SCOPE: read the code';
  const OUT = 'Approve the output of unit 3 (review — Fix the importer)';
  it('a pre-unit gate (run_level) returns null from ProposalCard', () => {
    expect(proposalCard({ view: run('r1', 'awaiting_human'), gate: openGate({ prompt: PRE, ord: 1, gateKind: 'run_level' }), chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI })).toBeNull();
  });
  it('an output gate (def) returns null from ProposalCard', () => {
    expect(proposalCard({ view: run('r1', 'awaiting_human'), gate: openGate({ prompt: OUT, ord: 4, gateKind: 'def' }), chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI })).toBeNull();
  });
  it('proposalKindOf returns null for def, run_level, and still null for escalation/failures', () => {
    expect(proposalKindOf('r1', openGate({ prompt: 'Approve the TTL bump?', gateKind: 'def' }), [])).toBeNull();
    expect(proposalKindOf('r1', openGate({ prompt: PRE, gateKind: 'run_level' }), [])).toBeNull();
    expect(proposalKindOf('r1', openGate({ prompt: 'Unit 1 failed and triage escalated', gateKind: 'escalation' }), [])).toBeNull();
    expect(proposalKindOf('r1', openGate({ prompt: 'LIFT-CONFLICT on src/a.ts' }), [])).toBeNull();
  });
});

describe('codex on #486 (#470 delta)', () => {
  it('a rev-2 plan gate over an accepted plan: the chain shows the gate\'s plan, the history kept, one count with the proposal', () => {
    const prompt = 'Approve plan rev 2 before unit 2 runs (manual mode; band 20-39; manual mode): pa-scope → test_plan (floor) → build. Floor added: test_plan';
    const accepted = chain([step('pa-scope', 'Scope', 'done'), step('build', 'Build', 'todo')], {
      pending: [step('pa-scope', 'Scope', 'todo'), step('build', 'Build', 'todo')],
    });
    const shown = withGatePlan(accepted, prompt);
    expect(shown.steps.map((s) => [s.id, s.state, s.addedBy])).toStrictEqual([['pa-scope', 'done', 'pa'], ['test_plan', 'todo', 'floor'], ['build', 'todo', 'pa']]);
    expect([shown.done, shown.total]).toStrictEqual([1, 3]);
    expect(shown.pending?.map((s) => s.label)).toStrictEqual(planSteps(accepted, prompt));
    // The pending plan keeps each step's real state (codex r2).
    expect(shown.pending?.map((s) => s.state)).toStrictEqual(['done', 'todo', 'todo']);
  });

  it('the accepted chain is never reordered; a step no longer planned stays where it ran (codex r2)', () => {
    const prompt = 'Approve plan rev 2 before unit 3 runs (manual mode; band 20-39; manual mode): pa-scope → build';
    const accepted = chain([step('pa-scope', 'Scope', 'done'), step('design', 'Plan', 'done'), step('build', 'Build', 'todo')], {
      pending: [step('pa-scope', 'Scope', 'todo'), step('build', 'Build', 'todo')],
    });
    expect(withGatePlan(accepted, prompt).steps.map((s) => s.id)).toStrictEqual(['pa-scope', 'design', 'build']);
  });

  it('a prompt older than the bus\'s pending plan does not override it (codex r2)', () => {
    const stale = 'Approve plan rev 1 before unit 1 runs (manual mode; band 20-39; manual mode): pa-scope → build';
    const accepted = chain([step('pa-scope', 'Scope', 'done'), step('build', 'Build', 'todo')], {
      pending: [step('pa-scope', 'Scope', 'todo'), step('test_plan', 'Test plan', 'todo'), step('build', 'Build', 'todo')],
    });
    expect(withGatePlan(accepted, stale)).toBe(accepted);
    // Same ids, an older order: still not the bus's plan (codex r3).
    const reordered = 'Approve plan rev 1 before unit 1 runs (manual mode; band 20-39; manual mode): pa-scope → build → test_plan';
    expect(withGatePlan(accepted, reordered)).toBe(accepted);
  });

  it('the floor line names the floor\'s steps as the proposal sentence names them', () => {
    const prompt = 'Approve plan rev 2 before unit 1 runs (manual mode; band 20-39; manual mode): ux-review (floor) → build. Floor added: ux-review';
    const known = chain([{ id: 'ux-review', catalog: 'review', block: 'review', label: 'x', state: 'todo', addedBy: 'pa' }], { proposed: true });
    const c = proposalCard({ view: run('r1', 'awaiting_human'), gate: openGate({ prompt, gateKind: 'plan_approval' }), chain: known, action: IDLE_GATE_ACTION, ui: NO_UI })!;
    const first = planSteps(known, prompt)[0]!;
    expect(c.why ?? '').toContain(`1 required by the floor: ${first}.`);
  });
});

// ── studio#575: the receipt says where the work went ─────────────────────────────────────────

describe('studio#575: the done receipt carries the pull request, else the branch', () => {
  const doneChain = chain([step('a', 'Build', 'done'), step('b', 'Deliver', 'done')]);
  const PR = 'https://github.com/example/studio-api/pull/999';
  it('a delivered run with a PR url in hand links it — the same href the Handed-over row carries', () => {
    const v = run('r1', 'completed');
    (v.session as SessionWithDelivery).delivery = 'delivered';
    (v.session as SessionWithDelivery).deliverUrl = PR;
    expect(handedOf(v)).toStrictEqual({ href: PR, branch: null });
    const done = proposalCard({ view: v, gate: undefined, chain: doneChain, action: IDLE_GATE_ACTION, ui: NO_UI, lastKind: 'deliver' })!;
    expect(done.state).toBe('done');
    expect(done.out).toBe('Finished · delivered');
    expect(done.handed).toStrictEqual({ href: PR, branch: null });
  });
  it('a push-only hand-over names the branch and links nothing', () => {
    const v = run('r1', 'completed');
    Object.assign(v.session as object, { delivery: 'pushed', deliverBranch: 'wicked/r1', deliverRemote: 'origin' });
    expect(handedOf(v)).toStrictEqual({ href: null, branch: 'wicked/r1' });
    const done = proposalCard({ view: v, gate: undefined, chain: doneChain, action: IDLE_GATE_ACTION, ui: NO_UI, lastKind: 'deliver' })!;
    expect(done.out).toBe('Finished · branch pushed');
    expect(done.handed).toStrictEqual({ href: null, branch: 'wicked/r1' });
  });
  it('"delivered" with no url, or a run that never delivered, hands nothing to link — and a non-https url is never a link', () => {
    const v = run('r1', 'completed');
    (v.session as SessionWithDelivery).delivery = 'delivered';
    expect(handedOf(v)).toBeNull();
    expect(handedOf(run('r2', 'completed'))).toBeNull();
    (v.session as SessionWithDelivery).deliverUrl = 'javascript:alert(1)';
    expect(handedOf(v)).toBeNull();
  });
});
