// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SessionView, SessionWithDelivery } from '../src/api/types.js';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import { needTextByRun, railGroups } from '../src/board/deskModel.js';
import { sessionTitle } from '../src/board/sessionModel.js';
import { KEPT_LINE, keptLocally, plainGateQuestion, plainRunTitle } from '../src/board/deskWords.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The Desk's words, from the live reel take of chapter 01-desk (studio#422, #423, #424):
 *  - a gate row and a project card say the question in plain words, never the engine's plan
 *    prompt (rev, unit, band, mode, phase ids);
 *  - onboarding runs are told apart by their repo ("Set up checkout-demo");
 *  - a run launched without delivery is finished work kept on this machine, not a need, and no
 *    line promises a PR an origin cannot have.
 */

const NOW = 1_700_000_000_000;
// The two live prompts (runs bfa38faf, gateKind plan_approval; 4b1fa3eb, gateKind def).
const PLAN_PROMPT = 'Approve plan rev 2 before unit 2 runs (manual mode; band 0-19; manual mode): pa-scope → clarify → design → build → adversarial-review → test → deliver';
const PHASE_PROMPT = 'Approve the output of unit 5 (adversarial-review — Add a FREESHIP discount code to the checkout so a cart over $50 ships free)';
const TECH = /\b(rev|unit|band|mode|pa-scope|adversarial-review)\b|→/i;

function inputs(over: Partial<NeedsYouInputs>): NeedsYouInputs {
  return {
    runs: [], gates: {}, failedAt: {}, attachedAt: {}, projectIds: {},
    chats: [], repos: [], campaigns: [], now: NOW, ...over,
  };
}

function gated(id: string, problem: string): SessionView {
  return makeView({ id, status: 'awaiting_human', problem, workdir: `/w/${id}` },
    [makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'pending' })]);
}

function finished(id: string, opts: { deliverUnit: boolean }): SessionView {
  const units = [makeUnit({ id: `${id}:build`, session_id: id, ord: 0, status: 'done' })];
  if (opts.deliverUnit) units.push(makeUnit({ id: `${id}:deliver`, session_id: id, ord: 1, status: 'rejected' }));
  const v = makeView({ id, workflow_id: 'feature', status: 'completed', problem: `Write the agenda for ${id}`, workdir: `/w/${id}` }, units);
  (v.session as SessionWithDelivery).delivery = 'stranded';
  return v;
}

describe('#422 a gate says its question in plain words', () => {
  it('a plan gate reads "Approve the plan (N steps)"', () => {
    expect(plainGateQuestion(PLAN_PROMPT, 'plan_approval')).toBe('Approve the plan (7 steps)');
    expect(plainGateQuestion('Approve plan rev 1 before unit 1 runs', undefined)).toBe('Approve the plan');
  });

  it('a phase gate names the step in words, without the unit number or the run title again', () => {
    expect(plainGateQuestion(PHASE_PROMPT, 'def')).toBe('Approve the review');
    expect(plainGateQuestion('Approve the output of unit 3 (build — Add a code)', 'def')).toBe('Approve the build');
    expect(plainGateQuestion('Approve the output of unit 3 (design)', 'def')).toBe('Approve the design');
    // The pre-execution form names the phase after the colon (Copilot r3).
    expect(plainGateQuestion('Approve unit 2 before it runs: review', 'def')).toBe('Approve the review');
    expect(plainGateQuestion('Approve unit 4 before it runs: deliver', undefined)).toBe('Approve the delivery');
    expect(plainGateQuestion('Approve unit 3 before it runs: apply the review fixes to the middleware chain', 'def')).toBe('Approve the next step: apply the review fixes to the middleware chain');
    expect(plainGateQuestion('Approve the output of unit 3 (some_new-phase — x)', 'def')).toBe('Approve the some new phase step');
  });

  it('a question an author wrote in words is kept; engine text never shows', () => {
    expect(plainGateQuestion('Approve the TTL bump?', undefined)).toBe('Approve the TTL bump?');
    // A long authored question is kept whole: the Desk truncates the line, its hover keeps it (Copilot).
    const long = 'Should the nightly export keep the 90-day window for the finance team, or move to 30 days now that the archive covers everything older than a month?';
    expect(plainGateQuestion(long, undefined)).toBe(long);
    expect(plainGateQuestion('Unit 4 rev 3 band 20-39: proceed?', undefined)).toBe('Waiting on your answer');
    expect(plainGateQuestion(undefined, undefined)).toBe('Waiting on your answer');
  });

  it('the needs-you gate row and the project card carry the plain question', () => {
    const rows = needsYouRows(inputs({
      runs: [gated('bfa38faf', 'Plan the offsite'), gated('4b1fa3eb', 'Add a FREESHIP discount code')],
      gates: {
        bfa38faf: { prompt: PLAN_PROMPT, receivedAt: NOW - 60_000, ord: 2, gateKind: 'plan_approval' },
        '4b1fa3eb': { prompt: PHASE_PROMPT, receivedAt: NOW - 30_000, ord: 6, gateKind: 'def' },
      },
    }));
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey['gate:bfa38faf']!.question).toBe('Approve the plan (7 steps)');
    expect(byKey['gate:4b1fa3eb']!.question).toBe('Approve the review');
    // The raw prompt stays on the row, for the layer underneath.
    expect(byKey['gate:bfa38faf']!.text).toContain('rev 2');
    const texts = needTextByRun(rows);
    expect(texts['bfa38faf']).toBe('Approve the plan (7 steps)');
    expect(texts['4b1fa3eb']).toBe('Approve the review');
    for (const t of Object.values(texts)) expect(t).not.toMatch(TECH);
  });
});

describe('#423 onboarding runs are told apart', () => {
  it('"Onboard repository: <name>" reads "Set up <name>"', () => {
    expect(plainRunTitle('Onboard repository: checkout-demo')).toBe('Set up checkout-demo');
    expect(plainRunTitle('Fix the double charge. Then show me.')).toBe('Fix the double charge');
  });

  it('three onboarding runs give three different session titles', () => {
    const names = ['checkout-demo', 'library-booking', 'offsite-plan'];
    const titles = names.map((n) => sessionTitle([], [makeView({ id: n, problem: `Onboard repository: ${n}` })]));
    expect(titles).toStrictEqual(['Set up checkout-demo', 'Set up library-booking', 'Set up offsite-plan']);
  });

  it('the same holds when the title comes from the first operator turn (codex)', () => {
    expect(sessionTitle([{ kind: 'user', text: 'Onboard repository: checkout-demo' }], [])).toBe('Set up checkout-demo');
  });
});

describe('#424 a run launched without delivery is kept, not stranded', () => {
  it('is not a need, and reads as finished and kept on this machine', () => {
    const kept = finished('2f903154', { deliverUnit: false });
    expect(keptLocally(kept)).toBe(true);
    const rows = needsYouRows(inputs({ runs: [kept] }));
    expect(rows.map((r) => r.key)).toStrictEqual([]);
    const [group] = railGroups([], [kept], {}, 5, {}, false);
    expect(group!.sessions[0]!.state).toBe('done');
    expect(group!.sessions[0]!.line).toBe(KEPT_LINE);
    expect(KEPT_LINE).not.toMatch(/stranded|PR/);
  });

  it('a post-hoc delivery attempted this session (in flight or failed) is not "kept": it still needs you (Copilot)', () => {
    const tried = finished('r-posthoc', { deliverUnit: false });
    expect(keptLocally(tried, true)).toBe(false);
    const rows = needsYouRows(inputs({ runs: [tried], deliveryAttempted: new Set(['r-posthoc']) }));
    expect(rows.map((r) => r.key)).toStrictEqual(['stranded:r-posthoc']);
  });

  it('a post-hoc delivery that just landed reads as delivered, before the run list catches up (Copilot r4)', () => {
    const kept = finished('2f903154', { deliverUnit: false });
    const [group] = railGroups([], [kept], {}, 5, {}, false, new Set(['2f903154']));
    expect(group!.sessions[0]!.line).toBe('Finished · delivered');
  });

  it('a run whose delivery was asked for and did not land still needs you, without promising a PR', () => {
    const stuck = finished('r-stuck', { deliverUnit: true });
    expect(keptLocally(stuck)).toBe(false);
    const rows = needsYouRows(inputs({ runs: [stuck] }));
    expect(rows.map((r) => r.key)).toStrictEqual(['stranded:r-stuck']);
    expect(rows[0]!.text).not.toMatch(/no PR/);
    expect(rows[0]!.text).not.toMatch(/stranded/i);
  });
});
