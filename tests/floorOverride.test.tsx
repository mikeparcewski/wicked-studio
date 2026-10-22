/**
 * (crew api-types 0.135.0, wicked-core `operator_judgment`, operator ruling 2026-10-21) "Approve as your
 * own judgment" at a FAILED REPO-CHECKS FLOOR: offered where the engine's prompt names the arm, the
 * consequence said first, the rationale required (the box opens empty, Send stays off while blank), and
 * the answer is `{approve: true, action: 'operator_judgment', amend: <rationale>}`. A gate and a delivery
 * whose floor the operator overrode say "Floor overridden by operator".
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { receiptOf, receiptWords } from '../src/board/assuranceModel.js';
import { FLOOR_OVERRIDE_CONSEQUENCE, FLOOR_OVERRIDE_KEY, offersFloorOverride } from '../src/board/floorOverride.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { OPERATOR_JUDGMENT_LABEL } from '../src/board/rejudge.js';
import { setUndoWindowForTest } from '../src/board/undoQueue.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { AssuranceReceipt as ReceiptView } from '../src/components/session/AssuranceReceipt.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { makeUnit, makeView } from './factories.js';

const RUN = 'r-floor';
const NOW = 1_700_000_000_000;
const SUMMARY = 'Repository checks failed: test (21 failing, head-only)';
const PROMPT =
  `Unit 2 failed its deterministic floor (repo_checks): ${SUMMARY} — confirm to retry the phase, judge it yourself with a written `
  + 'rationale when the evidence shows the failures are not the work\'s (action `operator_judgment`: it overrides the failed floor, '
  + 'labelled "floor overridden by operator" on the run and the delivery; every other layer still denies and QE acceptance is still '
  + 'required), or reject to cancel the run';
const OLD_PROMPT = `Unit 2 failed its deterministic floor (repo_checks): ${SUMMARY} — confirm to retry the phase, or reject to cancel the run`;

const UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:clarify`, session_id: RUN, ord: 1, role: 'neutral', status: 'done', stage: 'recon', assigned_cli: 'pi' }),
  makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 2, role: 'creator', status: 'rejected', stage: 'build', assigned_cli: 'codex' }),
];
const EVENTS = [
  { type: 'unitDispatched', session: RUN, ord: 2, attempt: 7 },
  { type: 'gateEvaluated', session: RUN, ord: 2, combined: false, denial: { source: 'repo_checks', reason: SUMMARY, claimId: null, ruleIds: [], deniedTool: null, phase: 'build' }, denialReason: SUMMARY, hasDeterministicFloor: true, deterministicPass: false, agentVerdict: 'pass', judgeCli: 'claude', judgeDistinct: true, evaluatorPolicies: [] },
  { type: 'gateEscalated', session: RUN, ord: 2, condition: 'floor_failed', denialSource: 'repo_checks', verdictSummary: SUMMARY },
  { type: 'awaitingHuman', session: RUN, ord: 2, prompt: PROMPT, gateKind: 'escalation' },
] as unknown as CoreEvent[];
const FLOOR_VERDICT = { ord: 2, outcome: 'fail', denial: { source: 'repo_checks', reason: SUMMARY } };
const gate = (prompt = PROMPT): OpenGate => ({ runId: RUN, ord: 2, prompt, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' });
const model = (prompt = PROMPT) =>
  sessionGateChoices({ runId: RUN, gate: gate(prompt), units: UNITS, events: EVENTS, pool: ['codex', 'claude', 'pi'], roster: null, rerun: null, fullVerdict: null, rejudge: null })!;

describe('the floor-failure gate model', () => {
  it('offers the operator judgment inline, consequence first, with the arm and a required note', () => {
    const m = model();
    const all = [...m.choices, ...m.overflow];
    const own = all.find((c) => c.key === FLOOR_OVERRIDE_KEY)!;
    expect(m.choices.map((c) => c.key)).toContain(FLOOR_OVERRIDE_KEY);
    expect(m.choices[m.choices.length - 1]!.key).toBe('stop');
    expect(own.label).toBe(OPERATOR_JUDGMENT_LABEL);
    expect(own.decision).toEqual({ approve: true, action: 'operator_judgment' });
    expect(own.needsNote).toBe(true);
    expect(own.title.startsWith(FLOOR_OVERRIDE_CONSEQUENCE)).toBe(true);
    expect(FLOOR_OVERRIDE_CONSEQUENCE).toBe('Overrides the failed floor; recorded on the run and delivery; QE acceptance still required.');
  });

  it('is not offered where the engine did not name it (an older engine, another floor, another layer denying)', () => {
    expect(offersFloorOverride(OLD_PROMPT, FLOOR_VERDICT, 2)).toBe(false);
    const m = model(OLD_PROMPT);
    expect([...m.choices, ...m.overflow].some((c) => c.key === FLOOR_OVERRIDE_KEY)).toBe(false);
  });

  it('needs the gate\'s own failed repo-checks floor: the same clause at another layer\'s gate is no offer (studio#869 review)', () => {
    expect(offersFloorOverride(PROMPT, FLOOR_VERDICT, 2)).toBe(true);
    expect(offersFloorOverride(PROMPT, { ...FLOOR_VERDICT, denial: { source: 'input_governance', reason: 'x' } }, 2)).toBe(false);
    expect(offersFloorOverride(PROMPT, FLOOR_VERDICT, 3)).toBe(false);
    expect(offersFloorOverride(PROMPT, null, 2)).toBe(false);
    // the clause quoted inside the denial reason of a real floor gate is not the engine's offer either
    const quoted = 'judge it yourself with a written rationale when the evidence shows the failures are not the work\'s (action `operator_judgment`: it overrides the failed floor';
    const p = `Unit 2 failed its deterministic floor (repo_checks): ${quoted} — confirm to retry the phase, or reject to cancel the run`;
    expect(offersFloorOverride(p, { ...FLOOR_VERDICT, denial: { source: 'repo_checks', reason: quoted } }, 2)).toBe(false);
  });

  it('a truncated or multi-line failure that quotes the clause is no offer when the engine left it out (studio#869 review r3)', () => {
    const clause = 'judge it yourself with a written rationale when the evidence shows the failures are not the work\'s '
      + '(action `operator_judgment`: it overrides the failed floor, labelled "floor overridden by operator" on the run and the '
      + 'delivery; every other layer still denies and QE acceptance is still required), or reject to cancel the run';
    const longReason = `assertion failed: prompt was "${clause}" and then 400 more characters of test output `.repeat(3);
    const head = longReason.slice(0, 240);
    const noOffer = `Unit 2 failed its deterministic floor (repo_checks): ${head} — confirm to retry the phase, or reject to cancel the run`;
    expect(offersFloorOverride(noOffer, { ...FLOOR_VERDICT, denial: { source: 'repo_checks', reason: longReason } }, 2)).toBe(false);
    const multi = `Unit 2 failed its deterministic floor (repo_checks): line one\n${clause}\nline three — confirm to retry the phase, or reject to cancel the run`;
    expect(offersFloorOverride(multi, FLOOR_VERDICT, 2)).toBe(false);
    // the real offer still counts with an engine note after the closer
    expect(offersFloorOverride(`${PROMPT} (launched unattended: this pause is the engine's deny contract)`, FLOOR_VERDICT, 2)).toBe(true);
  });

  it('is not offered when the arm name only appears in quoted failure text (studio#869 review)', () => {
    const diag = 'Unit 2 failed and triage escalated: triage judge failed: unsupported action `operator_judgment` '
      + '— confirm to retry the phase, or reject to cancel the run';
    expect(offersFloorOverride(diag, FLOOR_VERDICT, 2)).toBe(false);
    const m = model(diag);
    expect([...m.choices, ...m.overflow].some((c) => c.key === FLOOR_OVERRIDE_KEY)).toBe(false);
    const quotedInFloor = `Unit 2 failed its deterministic floor (repo_checks): test printed "action \`operator_judgment\`" `
      + '— confirm to retry the phase, or reject to cancel the run';
    expect(offersFloorOverride(quotedInFloor, FLOOR_VERDICT, 2)).toBe(false);
  });
});

describe('the floor-failure gate row', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setUndoWindowForTest(0);
    useGateStore.setState({ gates: { [RUN]: gate() } });
    useGateActionStore.setState({ byGate: {} });
    useRunEventStore.setState({ byRun: { [RUN]: EVENTS } });
    vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' } as never);
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '' } as never);
    vi.spyOn(client.api, 'getGate').mockResolvedValue({ runId: RUN, ord: 2, prompt: PROMPT, lifecycle: 'open', receivedAt: '' } as never);
  });
  afterEach(() => cleanup());

  const renderRow = () => render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human', clis: ['codex', 'claude', 'pi'] } as never, UNITS)} gate={gate()} navigate={vi.fn()} />);

  it('renders, requires the rationale, and submits the judgment with it', async () => {
    renderRow();
    const own = await screen.findByText(OPERATOR_JUDGMENT_LABEL, { selector: `[data-choice-key="${FLOOR_OVERRIDE_KEY}"]` });
    fireEvent.click(own);
    const note = await screen.findByTestId('session-gate-note') as HTMLTextAreaElement;
    // The consequence comes first, then the box — which opens empty and is required.
    const consequence = screen.getByTestId('session-gate-floor-override-consequence');
    expect(consequence.textContent).toBe(FLOOR_OVERRIDE_CONSEQUENCE);
    expect(consequence.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(note.value).toBe('');
    expect(note.getAttribute('aria-required')).toBe('true');
    expect(screen.getByTestId('session-gate-floor-override-label').textContent).toMatch(/required/);
    const send = screen.getByTestId('session-gate-send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(note, { target: { value: '   \n ' } });
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(client.api.confirmGate).not.toHaveBeenCalled();
    const why = '21 head-only failures are load flakes in untouched files; each passes alone';
    fireEvent.change(note, { target: { value: why } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(client.api.confirmGate).toHaveBeenCalledTimes(1));
    const [runId, body] = vi.mocked(client.api.confirmGate).mock.calls[0]!;
    expect(runId).toBe(RUN);
    expect(body).toMatchObject({ approve: true, action: 'operator_judgment', amend: why });
    expect(body).not.toHaveProperty('amendScope');
  });

  it("never pre-fills the rationale with another choice's draft", async () => {
    renderRow();
    const retry = await screen.findByText(/Retry this step with a note/, { selector: '[data-choice-key="steer"]' });
    fireEvent.click(retry);
    fireEvent.change(await screen.findByTestId('session-gate-note'), { target: { value: 'try again' } });
    fireEvent.click(screen.getByText(OPERATOR_JUDGMENT_LABEL, { selector: `[data-choice-key="${FLOOR_OVERRIDE_KEY}"]` }));
    await waitFor(() => expect(screen.getByTestId('session-gate-floor-override-consequence')).toBeTruthy());
    expect((screen.getByTestId('session-gate-note') as HTMLTextAreaElement).value).toBe('');
  });
});

describe('floor overridden by operator, on the gate and the delivery', () => {
  afterEach(() => cleanup());
  const overridden = {
    mode: 'full', required: ['judge', 'qe_acceptance'], ran: ['repo_checks', 'judge', 'operator_judge'], skipped: [],
    creator: 'codex', evaluator: null, judge: 'claude', tree: 'abc1234', attempt: 7,
    operatorJudges: [{ by: 'an-operator (user)', at: 1, note: 'load flakes in untouched files', reason: SUMMARY,
      floorOverride: { layer: 'repo_checks', resultId: 'r-floor:unit-2:attempt-7:repo_checks', ord: 2, attempt: 7, tree: 'abc1234', label: 'floor overridden by operator' } }],
  };

  it('the receipt says the floor was overridden, by whom and why — never that the operator judged the work', () => {
    const r = receiptOf(overridden)!;
    expect(r.operatorJudges?.[0]?.floorOverride?.resultId).toBe('r-floor:unit-2:attempt-7:repo_checks');
    expect(receiptWords(r, true).who).toBe('built by codex · judged by claude · floor overridden by operator (an-operator (user))');
    render(<ReceiptView passed receipt={r} />);
    expect(screen.getByTestId('assurance-floor-overridden').textContent).toBe('Floor overridden by operator');
    expect(screen.queryByTestId('assurance-operator-judged')).toBeNull();
    expect(screen.getByTestId('assurance-floor-overridden-line').textContent).toMatch(/repository checks failed and an-operator \(user\) overrode them: load flakes in untouched files\. Every other check still applied, and QE acceptance is still required\./);
  });

  it('two overrides on one delivery show each rationale, not just the count (studio#869 review)', () => {
    const two = {
      ...overridden,
      operatorJudges: [
        overridden.operatorJudges[0],
        { ...overridden.operatorJudges[0], by: 'second-operator (user)', note: 'fails on base too',
          floorOverride: { ...overridden.operatorJudges[0]!.floorOverride, resultId: 'r-floor:unit-4:attempt-2:repo_checks', ord: 4, attempt: 2 } },
      ],
    };
    render(<ReceiptView passed receipt={receiptOf(two)!} />);
    expect(screen.getByTestId('assurance-floor-overridden-line').textContent).toMatch(/At 2 gates/);
    const rows = screen.getAllByTestId('assurance-floor-override').map((li) => li.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/an-operator \(user\) at r-floor:unit-2:attempt-7:repo_checks: load flakes in untouched files/);
    expect(rows[1]).toMatch(/second-operator \(user\) at r-floor:unit-4:attempt-2:repo_checks: fails on base too/);
  });
});
