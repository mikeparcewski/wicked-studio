/**
 * core#850 (studio half): the assurance receipt on the gate row, the deliver card and the delivery
 * panel; the reduced-assurance label on the session, the gate and the delivery; and the skipped
 * required judge's "waiting for a judge seat" with its sign-in move.
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import {
  assuranceKind, deliveryReceiptOf, gateReceiptFor, receiptOf, receiptWords, sessionAssurance, waitsForJudge,
  type AssuranceReceipt,
} from '../src/board/assuranceModel.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { AssuranceReceipt as ReceiptView, RunAssuranceLabel } from '../src/components/session/AssuranceReceipt.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-850';
const NOW = 1_700_000_000_000;

/** The engine's receipt (camelCase; `null` = None), as `gateEvaluated.assurance` carries it. */
function wire(over: Partial<AssuranceReceipt> = {}): Record<string, unknown> {
  return {
    mode: 'full', required: ['distinct_evaluator', 'judge'], ran: [], skipped: [],
    creator: null, evaluator: null, judge: null, tree: null, attempt: 0, ...over,
  };
}

const UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 1, role: 'creator', status: 'done', stage: 'build', assigned_cli: 'claude' }),
  makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, role: 'evaluator', status: 'pending', stage: 'review', assigned_cli: 'codex' }),
];

describe('the receipt model', () => {
  it('reads the wire null-safely and refuses a non-receipt', () => {
    expect(receiptOf(undefined)).toBeNull();
    expect(receiptOf({ ran: ['judge'] })).toBeNull();
    const r = receiptOf({ ...wire({ ran: ['repo_checks'] }), skipped: [{ instrument: 'judge', reason: 'no_distinct_seat', detail: null }, { bad: 1 }] })!;
    expect(r.ran).toEqual(['repo_checks']);
    expect(r.skipped).toEqual([{ instrument: 'judge', reason: 'no_distinct_seat', detail: null }]);
  });

  it('independent, same-seat, floor-only and unchecked read differently', () => {
    const indep = receiptOf(wire({ ran: ['repo_checks', 'judge', 'distinct_evaluator'], creator: 'claude', evaluator: 'codex', judge: 'pi' }))!;
    expect(assuranceKind(indep)).toBe('independent');
    const w = receiptWords(indep, true);
    expect(w.label).toBe('Independently accepted');
    // A decision that did not pass is never "accepted": the words say what checked it.
    expect(receiptWords(indep, false).label).toBe('Checked independently');
    expect(receiptWords(indep).label).toBe('Checked independently');
    expect(w.who).toBe('built by claude · evaluated by codex · judged by pi (separate seats)');
    expect(w.ran).toBe('ran: repo checks, judge, distinct evaluator');
    expect(w.required).toBe('required: distinct evaluator, judge');

    const floor = receiptOf(wire({ ran: ['repo_checks', 'pinned_validator'], creator: 'claude', skipped: [{ instrument: 'judge', reason: 'no_distinct_seat', detail: 'no eligible judge seat distinct from creator `claude`' }] }))!;
    expect(assuranceKind(floor)).toBe('floor-only');
    expect(receiptWords(floor, true).label).toBe('Floor-only approval');
    expect(receiptWords(floor, false).label).toBe('Floor checks only');
    expect(receiptWords(floor).skipped).toBe('skipped: judge (no distinct seat)');
    expect(receiptWords(floor).skippedDetail).toEqual(['judge: no eligible judge seat distinct from creator `claude`']);

    const same = receiptOf(wire({ mode: 'reduced', ran: ['repo_checks'], creator: 'claude', evaluator: 'claude', skipped: [{ instrument: 'distinct_evaluator', reason: 'reduced_assurance', detail: 'evaluated on a seat that built the work, `claude`' }] }))!;
    expect(assuranceKind(same)).toBe('same-seat');
    expect(receiptWords(same).reduced).toBe(true);
    expect(receiptWords(same).who).toBe('built by claude · evaluated by claude (same seat, reduced assurance)');

    // A judge that answered on the creator's own seat is not independent acceptance.
    expect(assuranceKind(receiptOf(wire({ ran: ['judge'], creator: 'claude', judge: 'claude' }))!)).toBe('same-seat');
    expect(assuranceKind(receiptOf(wire())!)).toBe('unchecked');
    expect(receiptWords(receiptOf(wire())!).ran).toBe('ran: nothing');
  });

  it('tree and attempt; an unknown token passes through spaced', () => {
    const r = receiptOf(wire({ ran: ['new_thing'], tree: '1a2b3c4d5e6f', attempt: 2 }))!;
    expect(receiptWords(r).where).toBe('tree 1a2b3c4 · attempt 2');
    expect(receiptWords(r).ran).toBe('ran: new thing');
  });

  it('the gate receipt is the newest gateEvaluated for the ord, else the unit record', () => {
    const events = [
      { type: 'gateEvaluated', ord: 1, assurance: wire({ ran: ['repo_checks'] }) },
      { type: 'gateEvaluated', ord: 1, assurance: wire({ ran: ['judge'], judge: 'codex' }) },
    ] as unknown as CoreEvent[];
    expect(gateReceiptFor(events, UNITS, 1)!.ran).toEqual(['judge']);
    const units = [{ ...UNITS[0]!, assurance: wire({ ran: ['pinned_validator'] }) }] as unknown as WorkUnit[];
    expect(gateReceiptFor([], units, 1)!.ran).toEqual(['pinned_validator']);
    expect(gateReceiptFor(events, UNITS, null)).toBeNull();
  });

  it('the delivery receipt: the lift\'s own, else the gates\' aggregate with the contract', () => {
    const view = makeView({ id: RUN, status: 'awaiting_human', assurance: { mode: 'reduced', required: ['distinct_evaluator', 'judge'] } } as never, UNITS);
    const gates = [
      { type: 'gateEvaluated', ord: 1, assurance: wire({ mode: 'reduced', ran: ['repo_checks'], creator: 'claude', skipped: [{ instrument: 'judge', reason: 'reduced_assurance', detail: null }] }) },
      { type: 'gateEvaluated', ord: 2, assurance: wire({ mode: 'reduced', ran: ['evaluator_pass'], creator: 'claude', evaluator: 'claude', skipped: [{ instrument: 'judge', reason: 'error', detail: 'x' }] }) },
    ] as unknown as CoreEvent[];
    const agg = deliveryReceiptOf(view, gates)!;
    expect(agg.mode).toBe('reduced');
    expect(agg.ran).toEqual(['repo_checks', 'evaluator_pass']);
    expect(agg.skipped).toEqual([{ instrument: 'judge', reason: 'reduced_assurance', detail: null }]);
    expect(agg.creator).toBe('claude');
    const lifted = deliveryReceiptOf(view, [...gates, { type: 'deliverLiftEvaluated', ord: 3, assurance: wire({ mode: 'reduced', ran: ['repo_checks'], tree: 'abcdef0123', attempt: 1 }) }] as unknown as CoreEvent[])!;
    expect(lifted.tree).toBe('abcdef0123');
    expect(lifted.creator).toBe('claude');
    expect(deliveryReceiptOf(makeView({ id: RUN } as never, UNITS), [])).toBeNull();
  });

  it('codex r1: a delivery is independent only when each gate was (the names are display only)', () => {
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS);
    // One gate judged on its creator's own seat, another floor-only: joined names must not read as separate seats.
    const mixed = [
      { type: 'gateEvaluated', ord: 1, assurance: wire({ mode: 'reduced', ran: ['judge'], creator: 'claude', judge: 'claude' }) },
      { type: 'gateEvaluated', ord: 2, assurance: wire({ mode: 'reduced', ran: ['repo_checks'], creator: 'codex' }) },
    ] as unknown as CoreEvent[];
    const r = deliveryReceiptOf(view, mixed)!;
    expect(assuranceKind(r)).toBe('same-seat');
    expect(receiptWords(r, true).who).toBe('built by claude, codex · judged by claude (same seat, reduced assurance)');
    // One independent gate, another that skipped its judge: partly independent.
    const part = deliveryReceiptOf(view, [
      { type: 'gateEvaluated', ord: 1, assurance: wire({ ran: ['judge'], creator: 'claude', judge: 'codex' }) },
      { type: 'gateEvaluated', ord: 2, assurance: wire({ ran: ['repo_checks'], creator: 'claude', skipped: [{ instrument: 'judge', reason: 'error', detail: null }] }) },
    ] as unknown as CoreEvent[])!;
    expect(receiptWords(part, true).label).toBe('Accepted, partly independently');
    // A judge with no known seat never establishes independence.
    expect(assuranceKind(receiptOf(wire({ ran: ['judge'], creator: null, judge: null }))!)).toBe('floor-only');
  });

  it('codex r1: a re-dispatch voids the previous attempt\'s receipt (gate and lift)', () => {
    const view = makeView({ id: RUN, status: 'awaiting_human', verified_tree: 'cafe00' } as never, UNITS);
    const log = [
      { type: 'gateEvaluated', ord: 1, assurance: wire({ ran: ['repo_checks'], creator: 'claude' }) },
      { type: 'deliverLiftEvaluated', ord: 3, assurance: wire({ ran: ['repo_checks'], tree: 'aaaa1111', attempt: 0 }) },
      { type: 'unitDispatched', ord: 3, attempt: 1 },
    ] as unknown as CoreEvent[];
    expect(deliveryReceiptOf(view, log)!.tree).toBe('cafe00');
    expect(gateReceiptFor([...log, { type: 'unitDispatched', ord: 1, attempt: 1 }] as unknown as CoreEvent[], UNITS, 1)).toBeNull();
  });

  it('codex r2: the delivery aggregate uses each unit\'s current attempt; a lift alone keeps its own evidence', () => {
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS);
    const log = [
      { type: 'unitDispatched', ord: 1, attempt: 0 },
      { type: 'gateEvaluated', ord: 1, assurance: wire({ ran: ['judge'], creator: 'claude', judge: 'codex' }) },
      { type: 'unitDispatched', ord: 1, attempt: 1 },
      { type: 'gateEvaluated', ord: 2, assurance: wire({ ran: ['repo_checks'], creator: 'claude' }) },
    ] as unknown as CoreEvent[];
    const r = deliveryReceiptOf(view, log)!;
    expect(r.ran).toEqual(['repo_checks']);
    expect(assuranceKind(r)).toBe('floor-only');
    const lift = deliveryReceiptOf(view, [{ type: 'deliverLiftEvaluated', ord: 3, assurance: wire({ ran: ['distinct_evaluator', 'repo_checks'] }) }] as unknown as CoreEvent[])!;
    expect(assuranceKind(lift)).toBe('independent');
  });

  it('the session contract: the record, else sessionStarted', () => {
    expect(sessionAssurance(makeView({ id: RUN } as never, UNITS), [{ type: 'sessionStarted', assurance: { mode: 'reduced', required: [] } } as unknown as CoreEvent])!.mode).toBe('reduced');
    expect(sessionAssurance(makeView({ id: RUN } as never, UNITS), [])).toBeNull();
  });

  it('a held judge: the escalation class, else the engine prompt', () => {
    expect(waitsForJudge([{ type: 'gateEscalated', ord: 2, condition: 'judge_unavailable', denialSource: 'judge_unavailable', verdictSummary: '' } as unknown as CoreEvent], 2, '')).toBe(true);
    expect(waitsForJudge([{ type: 'gateEscalated', ord: 2, condition: 'verdict_not_pass', denialSource: 'agent_validator', verdictSummary: '' } as unknown as CoreEvent], 2, '')).toBe(false);
    expect(waitsForJudge([], 2, 'Unit 2 could not be judged — no eligible judge seat remained: codex signed out.')).toBe(true);
  });
});

describe('the receipt renders', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useGateActionStore.setState({ byGate: {} });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
  });
  afterEach(() => cleanup());

  it('on a gate row: the evaluation the gate is about, compact', () => {
    useRunEventStore.setState({ byRun: { [RUN]: [
      { type: 'unitDispatched', ord: 1, attempt: 1 },
      { type: 'gateEvaluated', session: RUN, ord: 1, combined: true, denial: null, hasDeterministicFloor: true, deterministicPass: true, agentVerdict: 'PASS', judgeCli: 'codex', judgeDistinct: true, evaluatorPolicies: [], assurance: wire({ ran: ['repo_checks', 'judge'], creator: 'claude', judge: 'codex', tree: 'feedfacecafe', attempt: 1 }) },
    ] as unknown as CoreEvent[] } });
    const g: OpenGate = { runId: RUN, ord: 2, prompt: 'Approve unit 2 before it runs: review', lifecycle: 'open', receivedAt: NOW, gateKind: 'def' };
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS)} gate={g} />);
    const box = screen.getByTestId('session-gate-assurance');
    expect(box.getAttribute('data-kind')).toBe('independent');
    expect(screen.getByTestId('assurance-kind').textContent).toBe('Independently accepted');
    expect(box.textContent).toContain('required: distinct evaluator, judge · ran: repo checks, judge');
    expect(screen.getByTestId('assurance-who').textContent).toBe('built by claude · judged by codex (judged on a separate seat)');
    expect(screen.getByTestId('assurance-where').textContent).toBe('tree feedfac · attempt 1');
    expect(screen.queryByTestId('assurance-reduced')).toBeNull();
  });

  it('codex r1: a refused hand-over row never shows the previous unit\'s acceptance', () => {
    const units: WorkUnit[] = [
      makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 1, role: 'creator', status: 'done', stage: 'build', assigned_cli: 'claude' }),
      makeUnit({ id: `${RUN}:deliver`, session_id: RUN, ord: 2, description: 'deliver', stage: 'build', phase_ref: 'deliver', status: 'rejected' }),
    ];
    useRunEventStore.setState({ byRun: { [RUN]: [
      { type: 'gateEvaluated', session: RUN, ord: 1, combined: true, denial: null, hasDeterministicFloor: true, deterministicPass: true, agentVerdict: 'PASS', judgeCli: 'codex', judgeDistinct: true, evaluatorPolicies: [], assurance: wire({ ran: ['judge'], creator: 'claude', judge: 'codex' }) },
    ] as unknown as CoreEvent[] } });
    const g: OpenGate = { runId: RUN, ord: 2, prompt: 'The deliver phase refused: deliver: identity mismatch — nothing was pushed. Approve to re-run the deliver phase now (the engine re-lifts and re-verifies first; no second deliver gate), reject to cancel the run and keep the worktree.', lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, units)} gate={g} />);
    expect(screen.getAllByTestId('session-gate-choice').map((b) => b.textContent)).toEqual(['Deliver again', 'Stop']);
    expect(screen.queryByTestId('session-gate-assurance')).toBeNull();
  });

  it('a reduced run says so on the gate even with no receipt, and on the session', () => {
    useRunEventStore.setState({ byRun: { [RUN]: [{ type: 'sessionStarted', session: RUN, assurance: { mode: 'reduced', required: ['distinct_evaluator', 'judge'] } }] as unknown as CoreEvent[] } });
    const view = makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS);
    const g: OpenGate = { runId: RUN, ord: 1, prompt: 'Approve unit 1 before it runs: build', lifecycle: 'open', receivedAt: NOW, gateKind: 'def' };
    render(<><RunAssuranceLabel view={view} /><GateRow view={view} gate={g} /></>);
    expect(screen.getByTestId('session-run-reduced').textContent).toBe('Reduced assurance');
    expect(screen.getByTestId('session-gate-reduced').textContent).toBe('Reduced assurance');
  });

  it('a floor-only approval reads differently, with the reduced label', () => {
    render(<ReceiptView passed receipt={receiptOf(wire({ mode: 'reduced', ran: ['repo_checks'], skipped: [{ instrument: 'judge', reason: 'reduced_assurance', detail: null }] }))!} />);
    expect(screen.getByTestId('assurance-receipt').getAttribute('data-kind')).toBe('floor-only');
    expect(screen.getByTestId('assurance-kind').textContent).toBe('Floor-only approval');
    expect(screen.getByTestId('assurance-reduced')).toBeTruthy();
    expect(screen.getByTestId('assurance-skipped').textContent).toBe('skipped: judge (reduced assurance)');
  });

  it('a held judge: "waiting for a judge seat" and the sign-in move', () => {
    useRunEventStore.setState({ byRun: { [RUN]: [
      { type: 'unitDispatched', ord: 2, attempt: 1 },
      { type: 'gateEvaluated', session: RUN, ord: 2, combined: false, denial: { source: 'judge_unavailable', reason: 'no eligible judge seat', claimId: null, ruleIds: [], deniedTool: null, phase: null }, denialReason: 'no eligible judge seat', hasDeterministicFloor: true, deterministicPass: true, agentVerdict: null, judgeCli: null, judgeDistinct: null, evaluatorPolicies: [], assurance: wire({ ran: ['repo_checks'], creator: 'claude', skipped: [{ instrument: 'judge', reason: 'no_distinct_seat', detail: 'no eligible judge seat' }] }) },
      { type: 'gateEscalated', session: RUN, ord: 2, condition: 'judge_unavailable', denialSource: 'judge_unavailable', verdictSummary: 'no eligible judge seat' },
    ] as unknown as CoreEvent[] } });
    const g: OpenGate = { runId: RUN, ord: 2, prompt: 'Unit 2 could not be judged — no eligible judge seat remained: no eligible judge seat. The work was not rejected. Sign a judge seat in (or reassign), then approve to re-run the phase, or reject to cancel the run', lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };
    const navigate = vi.fn();
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' } as never, UNITS)} gate={g} navigate={navigate} />);
    expect(screen.getByTestId('session-gate-judge-wait').textContent).toMatch(/^Waiting for a judge seat\./);
    fireEvent.click(screen.getByTestId('session-gate-judge-signin'));
    expect(navigate).toHaveBeenCalledWith('/system');
    expect(screen.getByTestId('assurance-kind').textContent).toBe('Floor checks only');
  });
});
