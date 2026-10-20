/**
 * A gate no judge could rule on (`judge_unavailable`, crew api-types 0.134.0 / wicked-core `rejudge`):
 * the card offers "Re-run the judge" only when crew's gate read says a judge seat can rule now, names
 * the missing seats and why when none can, labels the plain approve for what it is ("Approve as your
 * own judgment"), and no longer promises that approving re-runs the check. A gate and a delivery the
 * operator judged say "Judged by operator".
 */

import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { deliveryReceiptOf, gateReceiptFor, receiptOf, receiptWords } from '../src/board/assuranceModel.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { OPERATOR_JUDGMENT_LABEL, REJUDGE_LABEL, rejudgeOfferOf, type RejudgeOffer } from '../src/board/rejudge.js';
import { GateRow, useRejudgeOffer } from '../src/components/session/GateRow.js';
import { AssuranceReceipt as ReceiptView } from '../src/components/session/AssuranceReceipt.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-rejudge';
const NOW = 1_700_000_000_000;

/** The engine's receipt as the wire carries it (`operatorJudges[]` also carries `reason`). */
function wire(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: 'full', required: ['distinct_evaluator', 'judge'], ran: [], skipped: [],
    creator: null, evaluator: null, judge: null, tree: null, attempt: 2, ...over,
  };
}

// The e2e shape (run 290a7fee): the FIX step itself (a creator) parked at its judge_unavailable gate.
const UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:reproduce`, session_id: RUN, ord: 3, role: 'neutral', status: 'done', stage: 'build', assigned_cli: 'codex' }),
  makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 4, role: 'creator', status: 'rejected', stage: 'build', assigned_cli: 'claude' }),
];

const PROMPT =
  'Unit 4 could not be judged — no eligible judge seat remained: agent judge could not run — every eligible judge seat failed: pi (no_seat_image). '
  + 'The work was not rejected. Approve to judge it yourself (it counts, labelled "judged by operator"), re-run the judge on the same work once a judge seat can rule (action `rejudge`; the step does not run again), request changes to send it back for rework, or reject to cancel the run';

const EVENTS = [
  { type: 'unitDispatched', session: RUN, ord: 4, attempt: 2 },
  { type: 'gateEvaluated', session: RUN, ord: 4, combined: false, denial: { source: 'judge_unavailable', reason: 'every eligible judge seat failed', claimId: null, ruleIds: [], deniedTool: null, phase: null }, denialReason: 'every eligible judge seat failed', hasDeterministicFloor: true, deterministicPass: true, agentVerdict: 'reject', judgeCli: null, judgeDistinct: null, evaluatorPolicies: [], assurance: wire({ ran: ['pinned_validator', 'repo_checks'], creator: 'claude', skipped: [{ instrument: 'judge', reason: 'error', detail: 'pi (no_seat_image)' }] }) },
  { type: 'gateEscalated', session: RUN, ord: 4, condition: 'judge_unavailable', denialSource: 'judge_unavailable', verdictSummary: 'every eligible judge seat failed' },
  { type: 'awaitingHuman', session: RUN, ord: 4, prompt: PROMPT, gateKind: 'escalation' },
] as unknown as CoreEvent[];

const GATE: OpenGate = { runId: RUN, ord: 4, prompt: PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };

const AVAILABLE: RejudgeOffer = { available: true, eligible: ['pi', 'copilot'], missing: [{ seat: 'claude', reason: 'built this work' }] };
const NONE: RejudgeOffer = {
  available: false,
  eligible: [],
  missing: [{ seat: 'claude', reason: 'built this work' }, { seat: 'pi', reason: 'benched for this run: quota_exhausted' }],
};

const choices = (rejudge: RejudgeOffer | null) =>
  sessionGateChoices({ runId: RUN, gate: GATE, units: UNITS, events: EVENTS, pool: ['claude', 'codex', 'pi'], roster: null, rerun: null, fullVerdict: null, rejudge })!;

describe('the judge-unavailable gate model', () => {
  it('with an eligible judge seat: Re-run the judge first (suggested), and the approve says it is your judgment', () => {
    const m = choices(AVAILABLE);
    expect(m.choices.map((c) => c.label)).toEqual([REJUDGE_LABEL, 'Send back', OPERATOR_JUDGMENT_LABEL, 'Stop']);
    expect(m.choices[0]!.decision).toEqual({ approve: true, action: 'rejudge' });
    expect(m.choices[0]!.needsNote).toBe(false);
    expect(m.choices[0]!.title).toMatch(/^Have pi, copilot check the work as it stands\. The step does not run again/);
    expect(m.recommended).toBe(0);
    const own = m.choices[2]!;
    expect(own.decision).toEqual({ approve: true });
    expect(own.title).toMatch(/judged by operator/);
    expect(own.title).toMatch(/No independent check runs/);
  });

  it('with no eligible seat, or no offer read: no Re-run, and the approve still says it is your judgment', () => {
    for (const offer of [NONE, null]) {
      const m = choices(offer);
      expect(m.choices.map((c) => c.label)).toEqual(['Send back', OPERATOR_JUDGMENT_LABEL, 'Stop']);
      expect(m.choices.some((c) => c.key === 'rejudge')).toBe(false);
    }
  });

  it('an offer on another kind of gate offers nothing (the engine would refuse it)', () => {
    const events = EVENTS.map((e) => (e.type === 'gateEscalated' ? { ...e, condition: 'verdict_not_pass', denialSource: 'agent_validator' } : e)) as unknown as CoreEvent[];
    const gate = { ...GATE, prompt: 'Unit 4 verdict is NOT PASS (the judge said REJECT) — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run' };
    const m = sessionGateChoices({ runId: RUN, gate, units: UNITS, events, pool: [], roster: null, rerun: null, fullVerdict: null, rejudge: AVAILABLE })!;
    expect(m.choices.some((c) => c.key === 'rejudge')).toBe(false);
    expect(m.choices.some((c) => c.label === OPERATOR_JUDGMENT_LABEL)).toBe(false);
  });

  it('an EARLIER attempt\'s judge hold does not relabel a later attempt\'s gate (sent back, then a worker failure)', () => {
    const later = [
      ...EVENTS,
      { type: 'unitDispatched', session: RUN, ord: 4, attempt: 3 },
      { type: 'awaitingHuman', session: RUN, ord: 4, prompt: 'Unit 4 failed: the worker exited 1 — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run', gateKind: 'escalation' },
    ] as unknown as CoreEvent[];
    const gate = { ...GATE, prompt: 'Unit 4 failed: the worker exited 1 — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run' };
    const m = sessionGateChoices({ runId: RUN, gate, units: UNITS, events: later, pool: [], roster: null, rerun: null, fullVerdict: null, rejudge: AVAILABLE })!;
    expect(m.choices.some((c) => c.label === OPERATOR_JUDGMENT_LABEL || c.key === 'rejudge')).toBe(false);
  });

  it('reads the offer off the gate read null-safely', () => {
    expect(rejudgeOfferOf({ ord: 4 })).toBeNull();
    expect(rejudgeOfferOf({ rejudge: { available: 'yes' } })).toBeNull();
    expect(rejudgeOfferOf({ rejudge: AVAILABLE })).toEqual(AVAILABLE);
    // "available" with no seat named is not available.
    expect(rejudgeOfferOf({ rejudge: { available: true, eligible: [], missing: [] } })!.available).toBe(false);
  });
});

describe('the judge-unavailable gate row', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useGateActionStore.setState({ byGate: {} });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
    useRunEventStore.setState({ byRun: { [RUN]: EVENTS } });
  });
  afterEach(() => cleanup());

  /** The row's choice labels; the suggested one carries its "suggested" tag. */
  const labels = () => screen.getAllByTestId('session-gate-choice').map((b) => b.textContent ?? '');
  const renderRow = () =>
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human', clis: ['claude', 'codex', 'pi'] } as never, UNITS)} gate={GATE} navigate={vi.fn()} />);

  it('a judge seat can rule: the Re-run choice, and the line says what each way forward does', async () => {
    vi.spyOn(client.api, 'getGate').mockResolvedValue({ runId: RUN, ord: 4, prompt: PROMPT, lifecycle: 'open', receivedAt: '', rejudge: AVAILABLE } as never);
    renderRow();
    await waitFor(() => expect(labels()).toContain(`${REJUDGE_LABEL}suggested`));
    expect(labels()).toEqual([`${REJUDGE_LABEL}suggested`, 'Send back', OPERATOR_JUDGMENT_LABEL, 'Stop']);
    const line = screen.getByTestId('session-gate-judge-wait');
    expect(line.getAttribute('data-rejudge')).toBe('available');
    expect(line.textContent).toMatch(/Pi, Copilot can run it now/);
    expect(line.textContent).toMatch(/the step does not run again/);
    expect(line.textContent).toMatch(/Approve as your own judgment only if you checked the work yourself/);
    expect(line.textContent).toMatch(/judged by operator/);
    // The old promise is gone: approving never re-runs the check.
    expect(line.textContent).not.toMatch(/approve to re-run/i);
  });

  it('no judge seat can rule: no Re-run, and the line names each missing seat and why', async () => {
    vi.spyOn(client.api, 'getGate').mockResolvedValue({ runId: RUN, ord: 4, prompt: PROMPT, lifecycle: 'open', receivedAt: '', rejudge: NONE } as never);
    renderRow();
    await waitFor(() => expect(screen.getByTestId('session-gate-judge-wait').getAttribute('data-rejudge')).toBe('unavailable'));
    expect(screen.getByTestId('session-gate-judge-missing').textContent).toBe('Claude (built this work); Pi (benched for this run: quota_exhausted)');
    expect(labels().map((l) => l.replace(/suggested$/, ''))).toEqual(['Send back', OPERATOR_JUDGMENT_LABEL, 'Stop']);
    expect(screen.getByTestId('session-gate-judge-wait').textContent).not.toMatch(/approve to re-run/i);
  });

  it('an older daemon (no offer): no Re-run is promised, and the approve is still named for what it does', async () => {
    const get = vi.spyOn(client.api, 'getGate').mockResolvedValue({ runId: RUN, ord: 4, prompt: PROMPT, lifecycle: 'open', receivedAt: '' } as never);
    renderRow();
    await waitFor(() => expect(get).toHaveBeenCalledWith(RUN));
    const line = screen.getByTestId('session-gate-judge-wait');
    expect(line.getAttribute('data-rejudge')).toBe('unknown');
    expect(line.textContent).not.toMatch(/re-run/i);
    expect(labels().map((l) => l.replace(/suggested$/, ''))).toEqual(['Send back', OPERATOR_JUDGMENT_LABEL, 'Stop']);
  });
});

describe('the offer poll', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('only the newest read sets the offer: a slow earlier answer never overwrites a newer one', async () => {
    vi.useFakeTimers();
    const pending: Array<(v: unknown) => void> = [];
    vi.spyOn(client.api, 'getGate').mockImplementation(() => new Promise((resolve) => { pending.push(resolve); }) as never);
    const { result } = renderHook(() => useRejudgeOffer(RUN, 4, true));
    await act(async () => { vi.advanceTimersByTime(20_000); });
    expect(pending).toHaveLength(2);
    // The newer read (a seat signed out since) answers first; the older one (still eligible) last.
    await act(async () => { pending[1]!({ ord: 4, rejudge: NONE }); });
    await act(async () => { pending[0]!({ ord: 4, rejudge: AVAILABLE }); });
    expect(result.current).toEqual(NONE);
  });
});

describe('judged by operator, on the gate and the delivery', () => {
  afterEach(() => cleanup());
  const judged = wire({
    ran: ['pinned_validator', 'repo_checks', 'operator_judge'],
    creator: 'claude',
    judge: 'operator:mikep (user)',
    operatorJudges: [{ by: 'mikep (user)', at: 1, note: 'I read the diff', reason: 'every eligible judge seat failed' }],
  });

  it('the receipt names the operator as the judge, never as a seat', () => {
    const r = receiptOf(judged)!;
    expect(r.operatorJudges).toEqual([{ by: 'mikep (user)', at: 1, note: 'I read the diff' }]);
    const w = receiptWords(r, true);
    expect(w.who).toBe('built by claude · judged by operator (mikep (user))');
    expect(w.ran).toBe('ran: pinned validator, repo checks, operator judgment');
    render(<ReceiptView passed receipt={r} />);
    expect(screen.getByTestId('assurance-operator-judged').textContent).toBe('Judged by operator');
    expect(screen.getByTestId('assurance-operator-judged-line').textContent).toMatch(/mikep \(user\) judged it as it stood; no independent check ran/);
  });

  it('the gate receipt and the delivery carry the judgment written on the unit after its evaluation', () => {
    // The log holds the evaluation that held the gate; the operator's judgment is on the unit record.
    const units = [UNITS[0]!, { ...UNITS[1]!, status: 'done', assurance: judged }] as unknown as WorkUnit[];
    const gate = gateReceiptFor(EVENTS, units, 4)!;
    expect(gate.operatorJudges?.map((j) => j.by)).toEqual(['mikep (user)']);
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, units);
    const delivery = deliveryReceiptOf(view, EVENTS)!;
    expect(delivery.operatorJudges?.map((j) => j.by)).toEqual(['mikep (user)']);
    render(<ReceiptView passed receipt={delivery} testId="delivery-receipt" />);
    expect(screen.getByTestId('assurance-operator-judged').textContent).toBe('Judged by operator');
    expect(screen.getByTestId('assurance-operator-judged-line').textContent).toMatch(/^At one gate no helper could check the work/);
    // A unit record from another attempt is not this evaluation's judgment.
    const other = [UNITS[0]!, { ...UNITS[1]!, assurance: { ...judged, attempt: 1 } }] as unknown as WorkUnit[];
    expect(gateReceiptFor(EVENTS, other, 4)!.operatorJudges).toBeUndefined();
  });
});
