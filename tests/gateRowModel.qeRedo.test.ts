import { describe, expect, it } from 'vitest';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { gateQuestion } from '../src/board/gateHeadline.js';
import { OPERATOR_JUDGMENT_LABEL } from '../src/board/rejudge.js';
import { QE_REDO_CONSEQUENCE, QE_REDO_KEY, QE_REDO_LABEL, QE_RETRY_LABEL, QE_RETRY_NOTE_LABEL } from '../src/board/qeEscalation.js';
import { makeUnit } from './factories.js';

// e2e-1105 F23 (wicked-core#1312, api-types 0.195.0): a QE gate whose isolated reviewer gave NO VERDICT on the work offers
// "Redo the QE check" (`retry_qe`) first, with a headline that names the infrastructure miss. The person's own judgment
// stays a separate, labelled choice; a redo is never offered as, or labelled like, an approve.
const RUN = 'r-redo';
const NOW = 1_700_000_000_000;
const WHAT = 'no macOS sandbox tool on the seat';
const INCONCLUSIVE = `QE acceptance: the isolated QE reviewer on \`codex\` (distinct) recorded FAIL on QE run dd76 as INCONCLUSIVE — it could not run its checks: ${WHAT}`;
const REDO_CLAUSE = ' Redo the QE check (action `retry_qe`): the QE step takes its evidence again and a new isolated reviewer session judges it, on another reviewer seat when one can run. It is not a verdict: only that reviewer\'s PASS counts (1 more redo on this tree after this one).';
const INC_PROMPT = (redo: boolean) => `Unit 6's QE acceptance is INCONCLUSIVE — the isolated reviewer could not run its checks: ${INCONCLUSIVE}. No product failure was found and none was ruled out.${redo ? REDO_CLAUSE : ' The QE check is not offered again: the QE check was already redone 2 times on this tree (the most is 2).'} Approve to judge it yourself (it counts; the run's QE acceptance becomes skipped by operator, labelled "QE acceptance: skipped by operator" on the run, every gate and the delivery), request changes to send it back for rework, or reject to cancel the run`;
const UNBOUND = 'QE acceptance: the reviewer on `codex` ended with no VERDICT line';
const NOT_FOUND = 'QE acceptance: the QE evidence could not be bound: the evidence dir has no run record';
const NV_PROMPT = (redo: boolean) => `Unit 6 verdict is NOT PASS (${UNBOUND}) —${redo ? `${REDO_CLAUSE} Or confirm` : ' confirm'} to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run`;
const UNAVAIL = 'QE acceptance: every reviewer seat failed as a seat (codex: seat_failure:quota)';
const UNAVAIL_PROMPT = `Unit 6 could not be judged — no eligible judge seat remained: ${UNAVAIL}. The work was not rejected.${REDO_CLAUSE} Approve to judge it yourself (it counts, labelled "judged by operator"), request changes to send it back for rework, or reject to cancel the run`;

function units(outcome: string): WorkUnit[] {
  const qe = makeUnit({ id: `${RUN}:test`, session_id: RUN, ord: 6, stage: 'test', role: 'evaluator', status: 'rejected', assigned_cli: 'claude' });
  return [
    makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 4, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'pi' }),
    { ...qe, qe_review: { outcome, reason: 'x', attempts: [] } } as WorkUnit,
    makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 8, stage: 'build', role: 'neutral', status: 'distributed', assigned_cli: 'bash' }),
  ];
}

function events(summary: string, source: string, condition: string, prompt: string): CoreEvent[] {
  return [
    { type: 'unitDispatched', session: RUN, ord: 6, attempt: 0, ts: NOW - 40_000 },
    {
      type: 'gateEvaluated', session: RUN, ord: 6, ts: NOW - 1000,
      criterion: 'the run left a change in its worktree', hasDeterministicFloor: true, deterministicPass: true,
      agentVerdict: 'pass', agentReasoning: 'PASS', evaluatorPass: true, evaluatorPolicies: [],
      evaluatorVerdict: 'PASS', denialReason: summary,
      denial: { source, reason: summary, claimId: null, ruleIds: [], deniedTool: null, phase: 'unit-6' },
      combined: false, judgeCli: 'pi', judgeDistinct: true,
    },
    { type: 'gateEscalated', session: RUN, ord: 6, attempt: 0, condition, defGate: true, denialSource: source, outputCaptured: true, restored: false, discarded: [], suggestionRef: null, verdictSummary: summary },
    { type: 'awaitingHuman', session: RUN, ord: 6, prompt, reviewingOrd: 6, gateKind: 'escalation' },
  ] as unknown as CoreEvent[];
}

function model(summary: string, source: string, condition: string, prompt: string, outcome: string) {
  const gate: OpenGate = { runId: RUN, ord: 6, prompt, gateKind: 'escalation', lifecycle: 'open', receivedAt: NOW };
  const evs = events(summary, source, condition, prompt);
  const m = sessionGateChoices({ runId: RUN, gate, units: units(outcome), events: evs, pool: ['pi', 'claude'], roster: null })!;
  return { m, gate, evs };
}

const all = (m: ReturnType<typeof model>['m']) => [...m.choices, ...m.overflow];

describe('F23 — INCONCLUSIVE: redo the QE check first, named for what the reviewer could not run', () => {
  it('leads with the redo, suggested, sending `retry_qe`; the headline names the infrastructure miss', () => {
    const { m, gate } = model(INCONCLUSIVE, 'qe_inconclusive', 'judge_unavailable', INC_PROMPT(true), 'inconclusive');
    expect(m.qe?.outcome).toBe('inconclusive');
    expect(m.qe?.lead).toBe(`The QE reviewer couldn't run its checks (${WHAT}), so nothing was judged. Redo the QE check?`);
    expect(m.qe?.lead).not.toMatch(/didn't record a verdict/);
    expect(gateQuestion(m, 'a cause line', gate)).toBe(m.qe?.lead);
    expect(m.choices[0]).toMatchObject({ key: QE_REDO_KEY, label: QE_REDO_LABEL, decision: { approve: true, action: 'retry_qe' }, needsNote: false });
    expect(m.recommended).toBe(0);
    expect(m.consequence).toBe(QE_REDO_CONSEQUENCE);
    expect(m.choices[m.choices.length - 1]!.key).toBe('stop');
  });

  it('keeps the person\'s own judgment as its own labelled choice, and never labels an approve as a retry', () => {
    const { m } = model(INCONCLUSIVE, 'qe_inconclusive', 'judge_unavailable', INC_PROMPT(true), 'inconclusive');
    const judgment = all(m).find((c) => c.label === OPERATOR_JUDGMENT_LABEL);
    expect(judgment?.decision).toEqual({ approve: true });
    for (const c of all(m)) {
      // The only approve without an action is the operator's judgment, said so.
      if (c.decision !== null && c.decision.approve && (c.decision as { action?: string }).action === undefined) {
        expect(c.label).toBe(OPERATOR_JUDGMENT_LABEL);
      }
    }
    expect(all(m).some((c) => c.label === QE_RETRY_NOTE_LABEL || c.label === QE_RETRY_LABEL)).toBe(false);
    expect(m.noteDefault).toBe('');
    expect(m.failing).toEqual([]);
  });

  it('with only the gateEvaluated frame (no gateEscalated), the plain approve is still labelled as the person\'s judgment', () => {
    const gate: OpenGate = { runId: RUN, ord: 6, prompt: INC_PROMPT(false), gateKind: 'escalation', lifecycle: 'open', receivedAt: NOW };
    const evs = events(INCONCLUSIVE, 'qe_inconclusive', 'judge_unavailable', INC_PROMPT(false)).filter((e) => (e as { type: string }).type !== 'gateEscalated');
    const m = sessionGateChoices({ runId: RUN, gate, units: units('inconclusive'), events: evs, pool: ['pi', 'claude'], roster: null })!;
    expect(m.qe?.outcome).toBe('inconclusive');
    const plain = all(m).filter((c) => c.decision !== null && c.decision.approve && (c.decision as { action?: string }).action === undefined);
    expect(plain.length).toBeGreaterThan(0);
    for (const c of plain) expect(c.label).toBe(OPERATOR_JUDGMENT_LABEL);
  });

  it('a late join (only the awaitingHuman frame): the engine\'s named redo is still offered first, and the plain approve is the judgment', () => {
    const gate: OpenGate = { runId: RUN, ord: 6, prompt: INC_PROMPT(true), gateKind: 'escalation', lifecycle: 'open', receivedAt: NOW };
    const evs = events(INCONCLUSIVE, 'qe_inconclusive', 'judge_unavailable', INC_PROMPT(true)).filter((e) => (e as { type: string }).type === 'awaitingHuman');
    const m = sessionGateChoices({ runId: RUN, gate, units: units('inconclusive'), events: evs, pool: ['pi', 'claude'], roster: null })!;
    expect(m.choices[0]).toMatchObject({ key: QE_REDO_KEY, decision: { approve: true, action: 'retry_qe' } });
    expect(m.recommended).toBe(0);
    for (const c of all(m).filter((c) => c.decision !== null && c.decision.approve && (c.decision as { action?: string }).action === undefined)) {
      expect(c.label).toBe(OPERATOR_JUDGMENT_LABEL);
    }
  });

  it('an older engine (no redo, no cap words) does not claim the check was redone', () => {
    const prompt = INC_PROMPT(false).replace(' The QE check is not offered again: the QE check was already redone 2 times on this tree (the most is 2).', '');
    const { m } = model(INCONCLUSIVE, 'qe_inconclusive', 'judge_unavailable', prompt, 'inconclusive');
    expect(m.qe?.why).not.toMatch(/redone/);
  });

  it('at the cap (the engine no longer names `retry_qe`) offers no redo and says the check was redone already', () => {
    const { m } = model(INCONCLUSIVE, 'qe_inconclusive', 'judge_unavailable', INC_PROMPT(false), 'inconclusive');
    expect(all(m).some((c) => c.key === QE_REDO_KEY)).toBe(false);
    expect(m.qe?.lead).toBe(`The QE reviewer couldn't run its checks (${WHAT}), so nothing was judged.`);
    expect(m.qe?.why).toMatch(/already redone as often as it can be/);
    expect(all(m).some((c) => c.label === OPERATOR_JUDGMENT_LABEL)).toBe(true);
  });
});

describe('F23 — every other non-verdict takes the redo too; a FAIL never does', () => {
  it('no bound verdict: the redo replaces the plain retry, first and suggested', () => {
    const { m } = model(UNBOUND, 'qe_review', 'verdict_not_pass', NV_PROMPT(true), 'invalid');
    expect(m.qe?.outcome).toBe('no-verdict');
    expect(m.qe?.lead).toBe('The QE reviewer didn\'t record a verdict, so nothing was judged. Redo the QE check?');
    expect(m.choices[0]).toMatchObject({ key: QE_REDO_KEY, decision: { approve: true, action: 'retry_qe' } });
    expect(m.recommended).toBe(0);
    expect(all(m).some((c) => c.key === 'retry')).toBe(false);
    // studio#761 holds: nothing was judged, so nothing is sent back.
    expect(all(m).some((c) => c.key === 'send-back')).toBe(false);
  });

  it('a binding failure (no reviewer ran) is said as such, not "didn\'t record a verdict"', () => {
    const { m } = model(NOT_FOUND, 'qe_review', 'verdict_not_pass', NV_PROMPT(false), 'invalid');
    expect(m.qe?.lead).toBe('The QE check\'s evidence could not be found. Run the QE check again?');
    expect(m.qe?.lead).not.toMatch(/didn't record a verdict/);
    expect(m.qe?.why).toBe('The evidence the QE check took could not be bound to this job, so no reviewer ran and nothing was judged.');
    // Without the engine's redo (an older engine), the plain retry is still the way.
    expect(m.choices[0]).toMatchObject({ key: 'retry', label: QE_RETRY_LABEL });
  });

  it('no reviewer could run: the redo leads, the person\'s judgment stays', () => {
    const { m } = model(UNAVAIL, 'qe_reviewer_unavailable', 'judge_unavailable', UNAVAIL_PROMPT, 'unavailable');
    expect(m.qe?.outcome).toBe('unavailable');
    expect(m.qe?.lead).toMatch(/Redo the QE check\?$/);
    expect(m.choices[0]).toMatchObject({ key: QE_REDO_KEY });
    expect(all(m).some((c) => c.label === OPERATOR_JUDGMENT_LABEL)).toBe(true);
  });

  it('quoted words never read as the offer or as the INCONCLUSIVE gate; a recorded FAIL refuses it on a late join too', () => {
    const quoted = 'Unit 6 verdict is NOT PASS (the evaluator\'s verdict is FAIL: the docs say "QE acceptance is INCONCLUSIVE" and name action `retry_qe`) — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run';
    const { m } = model('the evaluator said FAIL', 'evaluator_verdict', 'verdict_not_pass', quoted, 'pass');
    expect(all(m).some((c) => c.key === QE_REDO_KEY)).toBe(false);
    expect(all(m).some((c) => c.label === OPERATOR_JUDGMENT_LABEL)).toBe(false);
    const gate: OpenGate = { runId: RUN, ord: 6, prompt: NV_PROMPT(true), gateKind: 'escalation', lifecycle: 'open', receivedAt: NOW };
    const evs = events(UNBOUND, 'qe_review', 'verdict_not_pass', NV_PROMPT(true)).filter((e) => (e as { type: string }).type === 'awaitingHuman');
    const late = sessionGateChoices({ runId: RUN, gate, units: units('fail'), events: evs, pool: ['pi', 'claude'], roster: null })!;
    expect(all(late).some((c) => c.key === QE_REDO_KEY)).toBe(false);
    // The whole engine clause quoted inside a non-QE reason, on a late join: the unit's record is no QE non-verdict.
    const clause = `Unit 6 verdict is NOT PASS (the docs say:${REDO_CLAUSE.slice(0, 120)}) — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run`;
    const g2: OpenGate = { ...gate, prompt: clause };
    const e2 = events('x', 'evaluator_verdict', 'verdict_not_pass', clause).filter((e) => (e as { type: string }).type === 'awaitingHuman');
    const q = sessionGateChoices({ runId: RUN, gate: g2, units: units('pass'), events: e2, pool: ['pi', 'claude'], roster: null })!;
    expect(all(q).some((c) => c.key === QE_REDO_KEY)).toBe(false);
    // A late join at a genuine no-verdict gate: the redo, and still no Send back.
    const nv = sessionGateChoices({ runId: RUN, gate, units: units('invalid'), events: evs, pool: ['pi', 'claude'], roster: null })!;
    expect(nv.choices[0]).toMatchObject({ key: QE_REDO_KEY });
    expect(all(nv).some((c) => c.key === 'send-back')).toBe(false);
  });

  it('a recorded FAIL is a verdict: no redo, even if a prompt mentions it', () => {
    const fail = 'QE acceptance: the isolated QE reviewer on `codex` (distinct) recorded FAIL on QE run dd77';
    const { m } = model(fail, 'qe_review', 'verdict_not_pass', NV_PROMPT(true), 'fail');
    expect(m.qe?.outcome).toBe('fail');
    expect(all(m).some((c) => c.key === QE_REDO_KEY)).toBe(false);
  });
});
