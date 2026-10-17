import { describe, expect, it } from 'vitest';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { qeGateOf, QE_RETRY_LABEL, QE_RETRY_NOTE_LABEL } from '../src/board/qeEscalation.js';
import { rerunOffer } from '../src/components/rerunModel.js';
import { makeUnit } from './factories.js';

// The frames of the verify program's w16 canary run (rec/events-rerun.json, seq 394-398): the QE
// unit (ord 6, `test`) passed its floor, its distinct evaluator and its judge, and the isolated QE
// reviewer recorded no verdict — `qe_review` outcome `invalid`.
const RUN = 'r-qe';
const NOW = 1_700_000_000_000;
const PROMPT = 'Unit 6 verdict is NOT PASS — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run';
const NO_VERDICT = "QE acceptance: the reviewer's verdict could not be bound: the reviewer recorded no verdict on QE run 56b40976-b3b4-4885-b2b8-65ea743de28b";
const FAIL = 'QE acceptance: the isolated QE reviewer on `codex` (distinct) recorded FAIL on QE run 56b40976-b3b4-4885-b2b8-65ea743de28b';

function units(outcome: string | null): WorkUnit[] {
  const qe = makeUnit({ id: `${RUN}:test`, session_id: RUN, ord: 6, stage: 'test', role: 'evaluator', status: 'rejected', assigned_cli: 'claude' });
  return [
    makeUnit({ id: `${RUN}:clarify`, session_id: RUN, ord: 3, stage: 'recon', role: 'neutral', status: 'done', assigned_cli: 'pi' }),
    makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 4, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'pi' }),
    makeUnit({ id: `${RUN}:adversarial-review`, session_id: RUN, ord: 5, stage: 'review', role: 'evaluator', status: 'done', assigned_cli: 'claude' }),
    outcome === null ? qe : ({ ...qe, qe_review: { outcome, reason: 'x', attempts: [] } } as WorkUnit),
    makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 7, stage: 'review', role: 'evaluator', status: 'distributed', assigned_cli: 'claude' }),
    makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 8, stage: 'build', role: 'neutral', status: 'distributed', assigned_cli: 'bash' }),
  ];
}

function events(summary: string, source = 'qe_review', condition = 'verdict_not_pass'): CoreEvent[] {
  return [
    { type: 'unitDispatched', session: RUN, ord: 4, attempt: 0, ts: NOW - 60_000 },
    { type: 'unitDone', session: RUN, ord: 4, ts: NOW - 50_000 },
    { type: 'unitDispatched', session: RUN, ord: 6, attempt: 0, ts: NOW - 40_000 },
    {
      type: 'gateEvaluated', session: RUN, ord: 6, ts: NOW - 1000,
      criterion: 'the run left a change in its worktree', hasDeterministicFloor: true, deterministicPass: true,
      agentVerdict: 'pass', agentReasoning: 'PASS — the worktree shows the change. PASS', evaluatorPass: true, evaluatorPolicies: [],
      evaluatorVerdict: 'PASS', denialReason: summary,
      denial: { source, reason: summary, claimId: null, ruleIds: [], deniedTool: null, phase: 'unit-6' },
      combined: false, judgeCli: 'pi', judgeDistinct: true,
    },
    { type: 'gateEscalated', session: RUN, ord: 6, attempt: 0, condition, defGate: true, denialSource: source, outputCaptured: true, restored: false, discarded: [], suggestionRef: null, verdictSummary: summary },
    { type: 'awaitingHuman', session: RUN, ord: 6, prompt: PROMPT, reviewingOrd: 6, gateKind: 'escalation' },
  ] as unknown as CoreEvent[];
}

const GATE: OpenGate = { runId: RUN, ord: 6, prompt: PROMPT, gateKind: 'escalation', lifecycle: 'open', receivedAt: NOW };

function model(evs: CoreEvent[], us: WorkUnit[]) {
  const offer = rerunOffer({ runId: RUN, status: 'awaiting_human', units: us, gateOrd: 6, prompt: PROMPT, gateKind: 'escalation', events: evs });
  return sessionGateChoices({ runId: RUN, gate: GATE, units: us, events: evs, pool: ['pi', 'claude'], roster: null, rerun: offer })!;
}

describe('studio#761/#762 — the QE review recorded no verdict', () => {
  it('leads with why, in plain words (no QE run id), before any choice', () => {
    const m = model(events(NO_VERDICT), units('invalid'));
    expect(m.qe?.outcome).toBe('no-verdict');
    expect(m.qe?.lead).toMatch(/didn't record a verdict, so nothing was judged/);
    expect(m.qe?.why).toBe('Nothing was found wrong with the work, so the steps before it are kept.');
    expect(`${m.qe?.lead} ${m.qe?.why}`).not.toMatch(/56b40976|QE run|bound/);
  });

  it('offers "Retry the QE review" first and suggested — a plain approve that re-runs the QE unit only', () => {
    const m = model(events(NO_VERDICT), units('invalid'));
    expect(m.choices[0]).toMatchObject({ key: 'retry', label: QE_RETRY_LABEL, decision: { approve: true }, needsNote: false });
    expect(m.recommended).toBe(0);
    expect(m.consequence).toMatch(/Only the QE check and its review run again/);
    expect(m.choices[m.choices.length - 1]!.key).toBe('stop');
  });

  it('offers no Send back and no "Rerun from build": nothing was found wrong with the work', () => {
    const m = model(events(NO_VERDICT), units('invalid'));
    const keys = [...m.choices, ...m.overflow].map((c) => c.key);
    expect(keys).not.toContain('send-back');
    expect(keys).not.toContain('rerun');
    expect(m.noteDefault).toBe('');
    expect(m.failing).toEqual([]);
  });

  it('the note arm is a retry with a note, never "Approve …"', () => {
    const m = model(events(NO_VERDICT), units('invalid'));
    const steer = [...m.choices, ...m.overflow].find((c) => c.key === 'steer')!;
    expect(steer.label).toBe(QE_RETRY_NOTE_LABEL);
    expect(steer.decision).toEqual({ approve: true });
    expect([...m.choices, ...m.overflow].map((c) => c.label).join(' ')).not.toMatch(/Approve/);
  });

  it('reads the escalation frame alone (a daemon that serves no qe_review on the unit)', () => {
    const m = model(events(NO_VERDICT), units(null));
    expect(m.qe?.outcome).toBe('no-verdict');
    expect(m.choices[0]!.key).toBe('retry');
  });

  it('says what else went wrong when the reviewer gave no VERDICT line, or the evidence was missing', () => {
    expect(qeGateOf(events('QE acceptance: the reviewer on `codex` ended with no VERDICT line'), units(null), 6)!.why).toMatch(/finished without giving a verdict/);
    expect(qeGateOf(events('QE acceptance: the QE executor turn named no evidence (no `QE-EVIDENCE:` line; …)'), units(null), 6)!.why).toMatch(/named no evidence/);
    expect(qeGateOf(events('QE acceptance: the floor re-run is not on the tree the last QE review judged; approve to re-run QE'), units(null), 6)!.why).toMatch(/work changed/);
  });
});

describe('studio#761 — a QE FAIL keeps Send back, and offers the review again', () => {
  it('Send back stays first; "Retry the QE review" sits beside it; the lead says the reviewer failed it', () => {
    const m = model(events(FAIL), units('fail'));
    expect(m.qe?.outcome).toBe('fail');
    expect(m.qe?.lead).toMatch(/said the work does not pass/);
    const keys = m.choices.map((c) => c.key);
    expect(keys[0]).toBe('send-back');
    expect(keys).toContain('retry');
    expect(keys[keys.length - 1]).toBe('stop');
  });

  it('a FAIL is read from the reason when the unit carries no record', () => {
    expect(qeGateOf(events(FAIL), units(null), 6)!.outcome).toBe('fail');
  });
});

describe('studio#762 — other gates are untouched', () => {
  it('a judge-unavailable QE gate keeps its approve (the operator judges) and only gains its why', () => {
    const evs = events('QE acceptance: every reviewer seat failed as a seat (pi: seat_failure:quota_exhausted)', 'qe_reviewer_unavailable', 'judge_unavailable');
    const m = model(evs, units('unavailable'));
    expect(m.qe?.outcome).toBe('unavailable');
    expect([...m.choices, ...m.overflow].some((c) => c.label === QE_RETRY_LABEL)).toBe(false);
  });

  it('a non-QE denial gives no QE lead', () => {
    expect(qeGateOf(events('the judge said FAIL', 'agent_validator'), units(null), 6)).toBeNull();
    const m = model(events('the judge said FAIL', 'agent_validator'), units(null));
    expect(m.qe).toBeUndefined();
  });
});
