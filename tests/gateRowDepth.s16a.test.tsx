// S16a-1b: the gate card's depth in the session thread's GateRow — the recommended move's
// consequence, the source line, "Why it failed", "Rerun from <step>" (one more ⋯ choice), the
// creator seat's record on Approve and the "make it a rule" offer. Every gate answer still goes
// through commitGateDecision (one POST /runs/:id/gate); the rule offer sends no gate decision.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as client from '../src/api/client.js';
import * as gateHistory from '../src/api/gateHistory.js';
import type { CoreEvent, SessionView, WorkUnit } from '../src/api/types.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateActionStore } from '../src/board/gateActions.js';
import { useUndoQueue } from '../src/board/undoQueue.js';
import { makeUnit, makeView } from './factories.js';
import { NOW, history } from './fixtures/gateTrust.js';
import { MOVE_RUN, MOVE_UNITS, NOT_PASS_EVENTS, NOT_PASS_PROMPT } from './fixtures/gateMove.js';

vi.mock('../src/api/gateHistory.js', () => ({
  getDecidedGates: vi.fn(),
  getStandingOrders: vi.fn(),
  createStandingOrder: vi.fn(),
  getWhoami: vi.fn(),
}));

const T = 1_700_000_000_000;

describe('S16a-1b — the row model carries the depth', () => {
  it('an evaluator escalation: the consequence rides the suggested Send back; the failing criteria are kept for "Why it failed"', () => {
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: T };
    const m = sessionGateChoices({ runId: MOVE_RUN, gate, units: MOVE_UNITS, events: NOT_PASS_EVENTS, pool: [], roster: null })!;
    expect(m.choices[m.recommended!]!.key).toBe('send-back');
    expect(m.consequence).toBe('produce reruns with 2 items; critique re-reviews');
    expect(m.failing).toEqual(['the regression test is missing', 'src/app.ts still reads `buggy`']);
    expect(m.reviewedOrd).toBe(2);
  });

  it('a plain def gate: no consequence (nothing recommended beyond Approve), the source line from its kind', () => {
    const gate: OpenGate = { runId: 'r', ord: 1, prompt: 'Approve unit 1?', lifecycle: 'open', receivedAt: T, gateKind: 'def' };
    const m = sessionGateChoices({ runId: 'r', gate, units: [], events: [], pool: [], roster: null })!;
    expect(m.consequence).toBeNull();
    expect(m.source).toBe('Workflow-declared gate: the workflow gates this phase, whatever the run-level human-confirm setting says.');
    // S15e's choice set is unchanged.
    expect(m.choices.map((c) => c.key)).toEqual(['approve', 'steer', 'send-back', 'stop']);
  });

  it('a rerun offer adds "Rerun from <step>" to ⋯ only — the inline choices stay', () => {
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: T };
    const offer = { ord: 1, phase: 'produce', kept: [], redone: ['produce', 'critique'], minutes: null, untimed: ['produce'], consequence: 'Keeps nothing, redoes produce → critique', decision: { approve: false, action: 'request_changes' as const } };
    const without = sessionGateChoices({ runId: MOVE_RUN, gate, units: MOVE_UNITS, events: NOT_PASS_EVENTS, pool: [], roster: null })!;
    const withRerun = sessionGateChoices({ runId: MOVE_RUN, gate, units: MOVE_UNITS, events: NOT_PASS_EVENTS, pool: [], roster: null, rerun: offer })!;
    expect(withRerun.choices).toEqual(without.choices);
    const rerun = withRerun.overflow.find((c) => c.key === 'rerun')!;
    expect(rerun.label).toBe('Rerun from produce');
    expect(rerun.title).toBe('Keeps nothing, redoes produce → critique');
    expect(rerun.decision).toEqual({ approve: false, action: 'request_changes' });
  });

  it('an engine choice with no wire says "send a note instead", never "the run page"', () => {
    const gate: OpenGate = { runId: 'r', ord: 1, prompt: 'Pick one', lifecycle: 'open', receivedAt: T, gateKind: 'team', choices: ['frobnicate'] } as OpenGate;
    const m = sessionGateChoices({ runId: 'r', gate, units: [], events: [], pool: [], roster: null });
    const all = m === null ? [] : [...m.choices, ...m.overflow];
    const unwired = all.find((c) => c.disabled === true);
    if (unwired !== undefined) {
      expect(unwired.title).toBe('No wire for this choice yet — send a note instead');
      expect(unwired.title).not.toContain('run page');
    }
  });
});

const TRUST_RUN = 'run-trust';
function trustView(seat: string): SessionView {
  const units: WorkUnit[] = [
    makeUnit({ id: `${TRUST_RUN}:build`, session_id: TRUST_RUN, ord: 1, stage: 'build', role: 'creator', status: 'done', assigned_cli: seat, phase_ref: 'build' }),
    makeUnit({ id: `${TRUST_RUN}:review`, session_id: TRUST_RUN, ord: 2, stage: 'review', role: 'evaluator', status: 'pending', assigned_cli: 'codex', phase_ref: 'review' }),
  ];
  const v = makeView({ id: TRUST_RUN, status: 'awaiting_human', problem: 'Review the importer', project_id: 'northwind' }, units);
  (v.session as unknown as { team_plan: unknown }).team_plan = { accepted: { band: '0-19' } };
  return v;
}

describe('S16a-1b — GateRow renders the depth', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.restoreAllMocks();
    useGateStore.setState({ gates: {} });
    useGateActionStore.setState({ byGate: {} });
    useUndoQueue.setState({ pending: [] });
    vi.mocked(gateHistory.getDecidedGates).mockResolvedValue({ gates: history() });
    vi.mocked(gateHistory.getStandingOrders).mockResolvedValue({ orders: [] });
    vi.mocked(gateHistory.getWhoami).mockResolvedValue({ actor: { id: 'local' } });
    vi.mocked(gateHistory.createStandingOrder).mockImplementation(async (text, rule) => ({ order: { id: 'o-new', text, rule, createdAt: 1 } }));
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('the creator seat’s record rides Approve; the rule offer makes ONE standing order and sends no gate decision', async () => {
    const confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
    const gate: OpenGate = { runId: TRUST_RUN, ord: 2, prompt: 'Approve unit 2 before it runs: review', lifecycle: 'open', receivedAt: T, gateKind: 'def' };
    useGateStore.setState({ gates: { [TRUST_RUN]: gate } });
    useRunEventStore.setState({ byRun: { [TRUST_RUN]: [] } });
    const user = userEvent.setup();
    render(<GateRow view={trustView('claude')} gate={gate} />);
    await waitFor(() => expect(screen.getByTestId('session-gate-track-record')).toHaveTextContent('claude: 8/10 approvals held · 2 sent back'));
    const approve = screen.getAllByTestId('session-gate-choice').find((b) => b.dataset.choiceKey === 'approve')!;
    expect(approve).toContainElement(screen.getByTestId('session-gate-track-record'));
    const offer = await screen.findByTestId('session-gate-rule-offer');
    expect(within(offer).getByTestId('session-gate-rule-question')).toHaveTextContent('Always approve band 0-19 unit reviews on northwind?');
    const preview = screen.getByTestId('session-gate-rule-preview');
    expect(preview).toHaveAttribute('data-would-approve', '8');
    expect(preview.compareDocumentPosition(screen.getByTestId('session-gate-rule-make')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await user.click(screen.getByTestId('session-gate-rule-make'));
    await screen.findByTestId('session-gate-rule-made');
    expect(gateHistory.createStandingOrder).toHaveBeenCalledTimes(1);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('"Rerun from <step>" shows its consequence first, then sends ONE POST /runs/:id/gate {approve:false, action:request_changes, ord}', async () => {
    vi.useRealTimers();
    const confirm = vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
    const RUN = 'run-rerun';
    const units: WorkUnit[] = [
      makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 1, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
      makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 2, stage: 'review', role: 'evaluator', status: 'rejected', assigned_cli: 'codex' }),
    ];
    const view = makeView({ id: RUN, status: 'awaiting_human', problem: 'Fix it' }, units);
    const prompt = 'Unit 2 verdict is NOT PASS — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run.';
    const gate: OpenGate = { runId: RUN, ord: 2, prompt, lifecycle: 'open', receivedAt: Date.now(), gateKind: 'escalation' };
    useGateStore.setState({ gates: { [RUN]: gate } });
    const events = [{ type: 'awaitingHuman', session: RUN, ord: 2, gateKind: 'escalation', prompt, ts: Date.now() }] as unknown as CoreEvent[];
    useRunEventStore.setState({ byRun: { [RUN]: events } });
    const user = userEvent.setup();
    render(<GateRow view={view} gate={gate} />);
    const rerun = await waitFor(() => {
      const b = screen.getAllByTestId('session-gate-choice').find((x) => x.dataset.choiceKey === 'rerun');
      expect(b).toBeDefined();
      return b!;
    });
    expect(rerun).toHaveTextContent('Rerun from build');
    await user.click(rerun);
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('session-gate-rerun-consequence').textContent).toMatch(/redoes build/);
    await user.click(screen.getByTestId('session-gate-rerun-confirm'));
    // The 10 s undo window: the decision is queued, then sent once.
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1), { timeout: 15_000 });
    const [runId, decision] = confirm.mock.calls[0]!;
    expect(runId).toBe(RUN);
    expect(decision).toMatchObject({ approve: false, action: 'request_changes', ord: 2 });
  }, 20_000);
});

describe('S16a-1b — the rewind is offered only where Send back is an arm', () => {
  it('a denied unit’s escalation (no Send back, studio#573) gets no "Rerun from"', () => {
    const offer = { ord: 1, phase: 'build', kept: [], redone: ['build'], minutes: null, untimed: [], consequence: 'redoes build', decision: { approve: false, action: 'request_changes' as const } };
    const gate: OpenGate = { runId: 'r', ord: 2, prompt: 'Unit 2 was DENIED by input governance: write outside the roots', lifecycle: 'open', receivedAt: T, gateKind: 'escalation' };
    const m = sessionGateChoices({ runId: 'r', gate, units: [], events: [], pool: [], roster: null, rerun: offer })!;
    expect([...m.choices, ...m.overflow].map((c) => c.key)).not.toContain('rerun');
    expect([...m.choices, ...m.overflow].map((c) => c.key)).not.toContain('send-back');
  });
});
