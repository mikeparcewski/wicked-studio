// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { SessionView, SessionWithDelivery } from '../src/api/types.js';
import { needsYouRows, type NeedsYouInputs } from '../src/board/needsYou.js';
import { needTextByRun, railGroups } from '../src/board/deskModel.js';
import { sessionTitle } from '../src/board/sessionModel.js';
import { askTitle, isChatScopeProblem, KEPT_LINE, keptLocally, plainGateQuestion, plainRunTitle } from '../src/board/deskWords.js';
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

  it('studio#464: the pre-execution form with the goal and the engine\'s phase scope reads as the step', () => {
    const prompt = 'Approve unit 1 before it runs: triage — SAVE20 should give twenty percent off, not twenty pounds off ||| PHASE SCOPE: this is the triage phase; read the code';
    expect(plainGateQuestion(prompt, 'def')).toBe('Approve the triage step');
    expect(plainGateQuestion('Approve unit 2 before it runs: fix — Fix issue #12 ||| PHASE SCOPE: fix only', undefined)).toBe('Approve the fix');
    // Words with no phase id: the engine's scaffold is cut, the words are kept.
    expect(plainGateQuestion('Approve unit 3 before it runs: apply the review fixes ||| PHASE SCOPE: x', 'def')).toBe('Approve the next step: apply the review fixes');
    // Never the scaffold, whatever the form.
    expect(plainGateQuestion('Check this ||| PHASE SCOPE: y', undefined)).not.toContain('|||');
  });

  it('a question an author wrote in words is kept; engine text never shows', () => {
    expect(plainGateQuestion('Approve the TTL bump?', undefined)).toBe('Approve the TTL bump?');
    // A long authored question is kept whole: the Desk truncates the line, its hover keeps it (Copilot).
    const long = 'Should the nightly export keep the 90-day window for the finance team, or move to 30 days now that the archive covers everything older than a month?';
    expect(plainGateQuestion(long, undefined)).toBe(long);
    expect(plainGateQuestion('Unit 4 rev 3 band 20-39: proceed?', undefined)).toBe('Waiting on your answer');
    // studio#570: the engine's pause prompts read as one line each; the legacy guard prompt stays neutral.
    expect(plainGateQuestion("Unit 4 verdict is NOT PASS (the evaluator's verdict is FAIL) — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run", undefined)).toBe('The reviewer said FAIL — send it back?');
    expect(plainGateQuestion('Unit 4 verdict is NOT PASS — confirm to retry the phase, or reject to cancel the run', undefined)).toBe('The step did not pass review — how should it go on?');
    // studio#601: the arms list names "request changes" on every NOT PASS gate; a judge refusing a
    // passing review (run e2e4039b: evaluatorVerdict PASS, denialSource agent_validator) is no FAIL.
    expect(plainGateQuestion('Unit 4 verdict is NOT PASS — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run', undefined)).toBe('The step did not pass review — how should it go on?');
    expect(plainGateQuestion("Unit 4 verdict is NOT PASS (no `VERDICT:` line in the evaluator's output (contract: end with `VERDICT: PASS` or `VERDICT: FAIL`)) — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run", undefined)).toBe('The reviewer said FAIL — send it back?');
    expect(plainGateQuestion("Unit 4 verdict is NOT PASS (the evaluator's verdict token `CONDITIONAL` is not PASS) — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run", undefined)).toBe('The reviewer said FAIL — send it back?');
    expect(plainGateQuestion('Unit 7 verdict is NOT PASS again — round 3, after 2 send-backs to unit 6 (the rework cap is 2), so this gate adjudicates instead of sending it back. Items — none. Approve = LAND WITH CARRIED ITEMS: … Request changes = ONE MORE ROUND: … Reject = STOP the run', undefined)).toBe('The review hit its rework cap — land it, one more round, or stop?');
    expect(plainGateQuestion("Unit 2 verdict is NOT PASS — the read-only `verify` phase changed the tree under review (M src/importer.ts); its edit was discarded and the creator's verified tree restored. Approve to retry the phase against the restored tree, or reject to cancel the run", undefined)).toBe('The reviewer changed the work instead of judging it — retry on the restored tree?');
    expect(plainGateQuestion('Unit 4 failed its deterministic floor (pinned_validator): exit 1', 'escalation')).toBe('The floor failed — how should the step go on?');
    expect(plainGateQuestion('Unit 2 was DENIED by input governance — a tool call was refused (`Bash`): never', undefined)).toBe('A Bash call was denied — how should the step go on?');
    expect(plainGateQuestion('Governance DENIED unit 1 (review): the middleware drops the refresh path', undefined)).toBe('Governance denied this step — how should it go on?');
    expect(plainGateQuestion('Team dispute on unit 4 (build — x): unresolved HIGH finding(s)', 'team_dispute')).toBe('The team disagreed — approve or reject the work?');
    expect(plainGateQuestion('Unit 3 failed and triage escalated: codex exited 1', undefined)).toBe('The step failed — send it back, reassign or stop?');
    expect(plainGateQuestion('Unit 2 (build) refused its environment: no network', undefined)).toBe('The step could not start — retry or stop?');
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

  it('a post-hoc delivery that just landed is not a stranded need, even with a deliver unit (Copilot on #438)', () => {
    const stuck = finished('r-stuck', { deliverUnit: true });
    expect(needsYouRows(inputs({ runs: [stuck], deliveredNow: new Set(['r-stuck']) })).map((r) => r.key)).toStrictEqual([]);
    expect(needsYouRows(inputs({ runs: [stuck] })).map((r) => r.key)).toStrictEqual(['stranded:r-stuck']);
  });

  it('a delivered-just-now run does not hide live work in its session (Copilot r2 on #438)', () => {
    const live = { session: { id: 'r-live', status: 'executing', problem: 'still going', chat_id: 'c1', created_at: 1 }, units: [] } as unknown as SessionView;
    const done = finished('r-done', { deliverUnit: false });
    (done.session as unknown as { chat_id: string; created_at: number }).chat_id = 'c1';
    (done.session as unknown as { created_at: number }).created_at = 2;
    const [group] = railGroups([], [live, done], {}, 5, {}, true, new Set(['r-done']));
    expect(group!.sessions[0]!.state).toBe('working');
    expect(group!.sessions[0]!.line).not.toBe('Finished · delivered');
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

describe('#540 an ask run is never titled "# Chat scope"', () => {
  const head = '# Chat scope\n\nThis directory is the scratch root of wicked-crew chat `c-1`. It is the ONLY place you may write.\n\n';
  it('names what the statement says the conversation is about', () => {
    expect(plainRunTitle(`${head}## Repositories in scope (READ-ONLY)\n\n- **alpha** (\`r-1\`): \`/srv/repos/alpha\`\n`)).toBe('A conversation about alpha');
    expect(plainRunTitle(`${head}## Scope: everything\n\n## Repositories in scope (READ-ONLY)\n\n- **alpha** (\`r-1\`): \`/a\`\n- **beta** (\`r-2\`): \`/b\`\n`)).toBe('A conversation about alpha and beta');
    expect(plainRunTitle(`${head}- **a** (\`1\`): \`/a\`\n- **b** (\`2\`): \`/b\`\n- **c** (\`3\`): \`/c\`\n- **d** (\`4\`): \`/d\`\n`)).toBe('A conversation about a, b and 2 more');
    expect(plainRunTitle(`${head}## Scope: system\n\nThis chat is about the wicked platform itself.\n`)).toBe('A conversation about the wicked platform');
    expect(plainRunTitle(`${head}## Repositories in scope\n\nNone. This chat was opened without a project or repo scope.\n`)).toBe('A conversation');
  });
  it('only a chat-scope statement is folded; every other problem keeps its clause', () => {
    expect(isChatScopeProblem(head)).toBe(true);
    expect(isChatScopeProblem('Chat scope: fix the double charge')).toBe(false);
    // The heading alone is an operator's words, not crew's statement (codex r1 #1).
    expect(isChatScopeProblem('# Chat scope\n\nwhich repos can this chat see?')).toBe(false);
    expect(plainRunTitle('# Chat scope\nwhich repos can this chat see?')).toBe('# Chat scope');
    expect(askTitle('fix the double charge on checkout. Then show me')).toBeNull();
    expect(plainRunTitle('fix the double charge on checkout. Then show me')).toBe('fix the double charge on checkout');
    expect(plainRunTitle('Onboard repository: alpha')).toBe('Set up alpha');
  });
});
