// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SessionView, SessionWithDelivery } from '../src/api/types.js';
import type { ChainModel, ChainStep } from '../src/board/chainModel.js';
import { IDLE_GATE_ACTION } from '../src/board/gateActions.js';
import {
  outcomeLine, planSentence, planSteps, proposalCard, proposalKindOf, statusSentence,
} from '../src/board/proposalCard.js';
import { basedOnLine, parsePlace, passageCandidates, passageWindow, sourcesOf } from '../src/board/sources.js';
import type { OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

/**
 * S6b (DES-STUDIO-REBUILD-001 §3 scenes 07/08/24/33/34/42): the proposal card, the status sentence
 * and the sources — pure models the session renders.
 */

const PLAN_PROMPT = 'Approve plan rev 2 before unit 2 runs (manual mode; band 20-39; manual mode): understand → build → test → review → deliver';
const NO_UI = { dismissedOrd: null, confirmingOrd: null };

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
    expect(c.text).toBe('Here’s the plan: Understand → Build → Test → Review → Deliver (5 steps).');
    expect(c.act).toBe('Go');
    expect(c.text).not.toMatch(/rev|unit|band|mode/);
  });

  it('prefers the proposed chain’s own labels when the plan has reached the bus', () => {
    const proposed = chain([step('a', 'Research', 'todo'), step('b', 'Build', 'todo')], { proposed: true });
    expect(planSteps(proposed, PLAN_PROMPT)).toStrictEqual(['Research', 'Build']);
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
    const c = proposalCard({ view: run('r1', 'awaiting_human'), gate: planGate(2), chain: EMPTY, action: IDLE_GATE_ACTION, ui: { dismissedOrd: 2, confirmingOrd: null } })!;
    expect(c.state).toBe('no');
    expect(c.text).toBe('Not now — nothing started.');
    const next = proposalCard({ view: run('r1', 'awaiting_human'), gate: planGate(5), chain: EMPTY, action: IDLE_GATE_ACTION, ui: { dismissedOrd: 2, confirmingOrd: null } })!;
    expect(next.state).toBe('ask');
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
    const c = proposalCard({ view: run('r1', 'awaiting_human'), gate: undefined, chain: proposed, action: { ...IDLE_GATE_ACTION, answered: 'approved' }, ui: NO_UI })!;
    expect(c.state).toBe('run');
    expect(c.runLabel).toBe('Going');
  });

  it('a run that never proposed has no card; other gates are not proposals', () => {
    expect(proposalCard({ view: run('r1', 'executing'), gate: undefined, chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI })).toBeNull();
    const plain = openGate({ prompt: 'Approve the TTL bump?', ord: 1, gateKind: 'def' });
    expect(proposalCard({ view: run('r1', 'awaiting_human'), gate: plain, chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI })).toBeNull();
  });
});

describe('the deliver card: the one "Are you sure?"', () => {
  const units = [
    makeUnit({ id: 'r9:build', session_id: 'r9', ord: 1, status: 'done', phase_ref: 'build' }),
    makeUnit({ id: 'r9:deliver', session_id: 'r9', ord: 2, status: 'pending', phase_ref: 'deliver', description: 'deliver — Fix it ||| Pushes branch wicked/r9 to origin and opens a pull request on acme/shop. Push identity: gh' }),
  ];
  const gate = openGate({ runId: 'r9', prompt: 'Approve unit 2 before it runs: deliver', ord: 2, gateKind: 'deliver' });

  it('asks with what it sends off the machine, then confirms', () => {
    const v = run('r9', 'awaiting_human', units);
    expect(proposalKindOf('r9', gate, units)).toBe('deliver');
    const ask = proposalCard({ view: v, gate, chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI })!;
    expect(ask.state).toBe('ask');
    expect(ask.act).toBe('Deliver');
    expect(ask.why).toBe('Pushes branch wicked/r9 to origin and opens a pull request on acme/shop.');
    const sure = proposalCard({ view: v, gate, chain: EMPTY, action: IDLE_GATE_ACTION, ui: { dismissedOrd: null, confirmingOrd: 2 } })!;
    expect(sure.state).toBe('confirm');
    expect(sure.confirm).toStrictEqual({ q: 'This leaves studio.', w: ask.why, a: 'Yes, deliver' });
  });

  it('without the unit’s target sentence the pull request is a condition, never a promise', () => {
    const bare = [units[0]!, makeUnit({ id: 'r9:deliver', session_id: 'r9', ord: 2, status: 'pending', phase_ref: 'deliver', description: 'deliver' })];
    const ask = proposalCard({ view: run('r9', 'awaiting_human', bare), gate, chain: EMPTY, action: IDLE_GATE_ACTION, ui: NO_UI })!;
    expect(ask.why).toMatch(/a pull request opens only if that origin is a GitHub repository/);
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
