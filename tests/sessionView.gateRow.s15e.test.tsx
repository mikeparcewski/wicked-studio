/**
 * S15e: every gate kind answerable in the session thread.
 *
 * Checks that `RunBlock` (via `SessionView`) renders `session-gate-row` for non-plan / non-deliver
 * gates, renders `session-proposal` for plan and deliver gates, and that `GateRow` itself shows
 * the expected choices for a def gate and nothing for a deliver gate.
 *
 * Wire boundary: all decisions are pinned via `commitGateDecision` / `commitGateReassign` —
 * gateWireSingleCaller.test.ts guards the single confirmGate caller.
 */

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { ChainModel } from '../src/board/chainModel.js';
import { IDLE_GATE_ACTION, useGateActionStore } from '../src/board/gateActions.js';
import { setUndoWindowForTest, undoDecision, useUndoQueue } from '../src/board/undoQueue.js';
import { GateRow } from '../src/components/session/GateRow.js';
import { ProposalCard } from '../src/components/session/ProposalCard.js';
import { proposalKindOf } from '../src/board/proposalCard.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import type { OpenGate } from '../src/store/gates.js';
import type { SessionView } from '../src/api/types.js';
import { makeUnit, makeView } from './factories.js';
import { NOT_PASS_EVENTS, NOT_PASS_PROMPT, MOVE_RUN, MOVE_UNITS } from './fixtures/gateMove.js';

const RUN = 'r-s15e';
const NOW = 1_700_000_000_000;

function plainGate(over: Partial<OpenGate> = {}): OpenGate {
  return { runId: RUN, ord: 1, prompt: 'Approve the plan?', lifecycle: 'open', receivedAt: NOW, ...over };
}

function view(over: Partial<SessionView['session']> = {}): SessionView {
  return makeView({ id: RUN, status: 'awaiting_human', ...over });
}

beforeEach(() => {
  vi.restoreAllMocks();
  setUndoWindowForTest(0);
  useGateStore.setState({ gates: {} });
  useGateActionStore.setState({ byGate: {} });
  useRunEventStore.setState({ byRun: { [RUN]: [] } });
  vi.spyOn(client.api, 'confirmGate').mockResolvedValue({ status: 'ok' });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
});
afterEach(() => {
  for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
  cleanup();
});

describe('GateRow — def gate', () => {
  it('renders session-gate-row with 4 choices', () => {
    const gate = plainGate();
    render(<GateRow view={view()} gate={gate} />);
    expect(screen.getByTestId('session-gate-row')).toBeDefined();
    expect(screen.getByTestId('session-gate-question').textContent).toBe('Approve the plan?');
    const choices = screen.getAllByTestId('session-gate-choice');
    expect(choices.map((c) => c.dataset['choiceKey'])).toEqual(['approve', 'steer', 'send-back', 'stop']);
  });

  it('Approve sends {approve:true} immediately (no note field)', async () => {
    const confirm = vi.mocked(client.api.confirmGate);
    const gate = plainGate();
    render(<GateRow view={view()} gate={gate} />);
    fireEvent.click(screen.getAllByTestId('session-gate-choice')[0]!); // Approve
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(confirm).toHaveBeenCalledWith(RUN, expect.objectContaining({ approve: true }));
  });

  it('Approve and steer opens note field without sending', async () => {
    const confirm = vi.mocked(client.api.confirmGate);
    const gate = plainGate();
    render(<GateRow view={view()} gate={gate} />);
    fireEvent.click(screen.getAllByTestId('session-gate-choice')[1]!); // Approve and steer
    // Note field should appear
    expect(screen.getByTestId('session-gate-note')).toBeDefined();
    // Nothing sent yet
    expect(confirm).not.toHaveBeenCalled();
  });

  it('Stop sends {approve:false}', async () => {
    const confirm = vi.mocked(client.api.confirmGate);
    const gate = plainGate();
    render(<GateRow view={view()} gate={gate} />);
    const choices = screen.getAllByTestId('session-gate-choice');
    fireEvent.click(choices[choices.length - 1]!); // Stop
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(confirm).toHaveBeenCalledWith(RUN, expect.objectContaining({ approve: false }));
  });
});

describe('GateRow — render nothing for deliver gate', () => {
  it('returns null (no session-gate-row) for a deliver gate', () => {
    const gate = plainGate({ gateKind: 'deliver' });
    const { container } = render(<GateRow view={view()} gate={gate} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('GateRow — render nothing when gate is undefined', () => {
  it('returns null when no gate is open', () => {
    const { container } = render(<GateRow view={view()} gate={undefined} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('GateRow — free-text gate (choices:null)', () => {
  it('renders a Send choice that opens the note field', () => {
    const gate = plainGate({ choices: null });
    render(<GateRow view={view()} gate={gate} />);
    expect(screen.getByTestId('session-gate-row')).toBeDefined();
    const choices = screen.getAllByTestId('session-gate-choice');
    expect(choices.map((c) => c.dataset['choiceKey'])).toEqual(['free-text-send']);
  });

  it('clicking Send opens the note field without sending', async () => {
    const confirm = vi.mocked(client.api.confirmGate);
    const gate = plainGate({ choices: null });
    render(<GateRow view={view()} gate={gate} />);
    fireEvent.click(screen.getByTestId('session-gate-choice'));
    expect(screen.getByTestId('session-gate-note')).toBeDefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it('submitting the note sends {approve:true, amend}', async () => {
    const confirm = vi.mocked(client.api.confirmGate);
    const gate = plainGate({ choices: null });
    render(<GateRow view={view()} gate={gate} />);
    fireEvent.click(screen.getByTestId('session-gate-choice'));
    fireEvent.change(screen.getByTestId('session-gate-note'), { target: { value: 'My free-text answer' } });
    fireEvent.click(screen.getByTestId('session-gate-send'));
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(confirm).toHaveBeenCalledWith(RUN, expect.objectContaining({
      approve: true,
      amend: 'My free-text answer',
    }));
  });
});

describe('GateRow — escalation gate', () => {
  it('renders session-gate-row for NOT PASS escalation', () => {
    const escalationView = makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS);
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: NOW };
    useRunEventStore.setState({ byRun: { [MOVE_RUN]: NOT_PASS_EVENTS } });
    render(<GateRow view={escalationView} gate={gate} />);
    const row = screen.queryByTestId('session-gate-row');
    expect(row).not.toBeNull();
    expect(row!.dataset['reason']).toBe('escalation');
  });

  it('escalation gate has Send back and Stop choices', () => {
    const escalationView = makeView({ id: MOVE_RUN, status: 'awaiting_human' }, MOVE_UNITS);
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: NOW };
    useRunEventStore.setState({ byRun: { [MOVE_RUN]: NOT_PASS_EVENTS } });
    render(<GateRow view={escalationView} gate={gate} />);
    const keys = screen.getAllByTestId('session-gate-choice').map((c) => c.dataset['choiceKey']!);
    expect(keys).toContain('send-back');
    expect(keys).toContain('stop');
  });
});

describe('GateRow — steer note sends {approve:true, amend, amendScope:creator}', () => {
  it('sends correct steer decision when note is submitted', async () => {
    const confirm = vi.mocked(client.api.confirmGate);
    const gate = plainGate(); // ord:1 def gate
    // steerScopeTarget returns non-null when a non-creator sits at gate.ord and a creator sits higher.
    const units = [
      makeUnit({ id: `${RUN}:verify`, session_id: RUN, ord: 1, stage: 'review', role: 'evaluator', status: 'pending', assigned_cli: null }),
      makeUnit({ id: `${RUN}:create`, session_id: RUN, ord: 2, stage: 'build', role: 'creator', status: 'pending', assigned_cli: 'codex' }),
    ];
    render(<GateRow view={makeView({ id: RUN, status: 'awaiting_human' }, units)} gate={gate} />);
    fireEvent.click(screen.getAllByTestId('session-gate-choice')[1]!); // Approve and steer
    fireEvent.change(screen.getByTestId('session-gate-note'), { target: { value: 'Use TypeScript strict mode' } });
    fireEvent.click(screen.getByTestId('session-gate-send'));
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(confirm).toHaveBeenCalledWith(RUN, expect.objectContaining({
      approve: true,
      amend: 'Use TypeScript strict mode',
      amendScope: 'creator',
    }));
  });
});

describe('GateRow — send-back note sends {approve:false, action:request_changes, amend}', () => {
  it('sends correct send-back decision when note is submitted', async () => {
    const confirm = vi.mocked(client.api.confirmGate);
    const gate = plainGate();
    render(<GateRow view={view()} gate={gate} />);
    fireEvent.click(screen.getAllByTestId('session-gate-choice')[2]!); // Send back
    fireEvent.change(screen.getByTestId('session-gate-note'), { target: { value: 'Fix the tests first' } });
    fireEvent.click(screen.getByTestId('session-gate-send'));
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(confirm).toHaveBeenCalledWith(RUN, expect.objectContaining({
      approve: false,
      action: 'request_changes',
      amend: 'Fix the tests first',
    }));
  });
});

describe('RunBlock boundary — def gate routes to GateRow, not ProposalCard', () => {
  it('proposalKindOf returns null for def gate (RunBlock sends it to GateRow)', () => {
    expect(proposalKindOf(RUN, plainGate({ gateKind: 'def' }), [])).toBeNull();
  });

  it('def gate: session-gate-row with 4 choices; no session-proposal in the GateRow subtree', () => {
    const gate = plainGate({ gateKind: 'def' });
    render(<GateRow view={view()} gate={gate} />);
    expect(screen.getByTestId('session-gate-row')).toBeDefined();
    const choices = screen.getAllByTestId('session-gate-choice');
    expect(choices.map((c) => c.dataset['choiceKey'])).toEqual(['approve', 'steer', 'send-back', 'stop']);
    expect(screen.queryByTestId('session-proposal')).toBeNull();
  });
});

const EMPTY_CHAIN: ChainModel = { source: 'units', steps: [], proposed: false, transportLine: null, done: 0, total: 0, checked: null };
const DELIVER_DIFF = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1 +1,3 @@',
  '+export const x = 1;',
  '+export const y = 2;',
].join('\n');

describe('ProposalCard — deliver diffstat keyed by runId', () => {
  beforeEach(() => {
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] });
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  });

  it("a run change re-fetches the diff and shows run B's stat, not run A's", async () => {
    const RUN_A = 'r-deliver-a';
    const RUN_B = 'r-deliver-b';
    const getRunDiff = vi.spyOn(client.api, 'getRunDiff').mockImplementation((id) =>
      Promise.resolve({
        diff: id === RUN_A
          ? DELIVER_DIFF   // 1 file, +2
          : 'diff --git a/other.ts b/other.ts\n--- a/other.ts\n+++ b/other.ts\n+export const z = 3;',  // 1 file, +1
        truncated: false,
      }),
    );
    const gateA: OpenGate = { runId: RUN_A, ord: 1, prompt: 'Approve delivery before unit 1 runs.', lifecycle: 'open', receivedAt: NOW, gateKind: 'deliver' };
    const gateB: OpenGate = { runId: RUN_B, ord: 1, prompt: 'Approve delivery before unit 1 runs.', lifecycle: 'open', receivedAt: NOW, gateKind: 'deliver' };
    useGateStore.setState({ gates: { [RUN_A]: gateA }, approaching: {} });
    useRunEventStore.setState({ byRun: { [RUN_A]: [], [RUN_B]: [] } });
    const viewA = makeView({ id: RUN_A, status: 'awaiting_human' });
    const { rerender } = render(<ProposalCard view={viewA} chain={EMPTY_CHAIN} />);
    // Open the detail to see diffstat for run A
    const detail = await screen.findByTestId('session-proposal-deliver-detail');
    detail.setAttribute('open', '');
    // Run A: 1 file changed, +2
    await waitFor(() => expect(screen.getByTestId('session-proposal-deliver-diffstat').textContent).toBe('1 file changed, +2'));

    // Switch to run B
    useGateStore.setState({ gates: { [RUN_B]: gateB }, approaching: {} });
    const viewB = makeView({ id: RUN_B, status: 'awaiting_human' });
    await act(async () => { rerender(<ProposalCard view={viewB} chain={EMPTY_CHAIN} />); });
    // getRunDiff must have been called for run B
    await waitFor(() => expect(getRunDiff).toHaveBeenCalledWith(RUN_B, undefined, 'merge-base'));
    // Run B's diffstat: 1 file changed, +1 (not run A's +2)
    await waitFor(() => expect(screen.getByTestId('session-proposal-deliver-diffstat').textContent).toBe('1 file changed, +1'));
  });

  it('a {} diff response (no diff property) falls back to event-based file count', async () => {
    const RUN_EV = 'r-deliver-ev';
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({} as never);
    const gate: OpenGate = { runId: RUN_EV, ord: 1, prompt: 'Approve delivery before unit 1 runs.', lifecycle: 'open', receivedAt: NOW, gateKind: 'deliver' };
    useGateStore.setState({ gates: { [RUN_EV]: gate }, approaching: {} });
    useRunEventStore.setState({
      byRun: {
        [RUN_EV]: [{ type: 'repoChecksEvaluated', ord: 1, changed: ['src/a.ts', 'src/b.ts'] } as never],
      },
    });
    const v = makeView({ id: RUN_EV, status: 'awaiting_human' });
    render(<ProposalCard view={v} chain={EMPTY_CHAIN} />);
    const detail = await screen.findByTestId('session-proposal-deliver-detail');
    detail.setAttribute('open', '');
    await waitFor(() => expect(screen.getByTestId('session-proposal-deliver-diffstat').textContent).toContain('2 files changed'));
  });

  it('a {diff:""} response falls back to event-based file count', async () => {
    const RUN_EMPTY = 'r-deliver-empty';
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    const gate: OpenGate = { runId: RUN_EMPTY, ord: 1, prompt: 'Approve delivery before unit 1 runs.', lifecycle: 'open', receivedAt: NOW, gateKind: 'deliver' };
    useGateStore.setState({ gates: { [RUN_EMPTY]: gate }, approaching: {} });
    useRunEventStore.setState({
      byRun: {
        [RUN_EMPTY]: [{ type: 'repoChecksEvaluated', ord: 1, changed: ['src/c.ts'] } as never],
      },
    });
    const v = makeView({ id: RUN_EMPTY, status: 'awaiting_human' });
    render(<ProposalCard view={v} chain={EMPTY_CHAIN} />);
    const detail = await screen.findByTestId('session-proposal-deliver-detail');
    detail.setAttribute('open', '');
    await waitFor(() => expect(screen.getByTestId('session-proposal-deliver-diffstat').textContent).toContain('1 file changed'));
  });

  it('deliver card with repoChecksEvaluated lists each check by name with passed/failed/exit/time format', async () => {
    const RUN_FLOOR = 'r-deliver-floor';
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    const gate: OpenGate = { runId: RUN_FLOOR, ord: 1, prompt: 'Approve delivery before unit 1 runs.', lifecycle: 'open', receivedAt: NOW, gateKind: 'deliver' };
    useGateStore.setState({ gates: { [RUN_FLOOR]: gate }, approaching: {} });
    useRunEventStore.setState({
      byRun: {
        [RUN_FLOOR]: [
          { type: 'repoChecksEvaluated', ord: 1, attempt: 0, passed: true,
            criterion: 'repository checks pass on the head', skipped: [],
            checks: [
              { name: 'typecheck', argv: ['npm', 'run', 'typecheck'], source: 'declared', exitCode: 0, timedOut: false, spawnError: null, durationMs: 8200 },
              { name: 'lint', argv: ['npm', 'run', 'lint'], source: 'declared', exitCode: 0, timedOut: false, spawnError: null, durationMs: 4100 },
            ] } as never,
          { type: 'gateEvaluated', ord: 1, criterion: 'repository checks pass on the head',
            hasDeterministicFloor: true, deterministicPass: true, agentVerdict: null, agentReasoning: null,
            evaluatorPass: null, evaluatorPolicies: [], denialReason: null, denial: null,
            combined: true, judgeCli: null, judgeDistinct: null } as never,
        ],
      },
    });
    const v = makeView({ id: RUN_FLOOR, status: 'awaiting_human' });
    render(<ProposalCard view={v} chain={EMPTY_CHAIN} />);
    const detail = await screen.findByTestId('session-proposal-deliver-detail');
    detail.setAttribute('open', '');
    await waitFor(() => {
      const checks = screen.getAllByTestId('session-proposal-deliver-check');
      expect(checks.length).toBe(2);
      expect(checks[0]!.textContent).toMatch(/typecheck\s*·\s*passed\s*·\s*exit 0\s*·\s*8 s/);
      expect(checks[1]!.textContent).toMatch(/lint\s*·\s*passed\s*·\s*exit 0\s*·\s*4 s/);
    });
  });
});

describe('GateRow — empty note cannot be sent', () => {
  it('send button is disabled when note field is empty', () => {
    const gate = plainGate();
    render(<GateRow view={view()} gate={gate} />);
    fireEvent.click(screen.getAllByTestId('session-gate-choice')[1]!); // Approve and steer
    const sendBtn = screen.getByTestId('session-gate-send');
    expect((sendBtn as HTMLButtonElement).disabled).toBe(true);
  });

  it('send button enables once note has non-whitespace text', () => {
    const gate = plainGate();
    render(<GateRow view={view()} gate={gate} />);
    fireEvent.click(screen.getAllByTestId('session-gate-choice')[1]!); // Approve and steer
    fireEvent.change(screen.getByTestId('session-gate-note'), { target: { value: 'a note' } });
    const sendBtn = screen.getByTestId('session-gate-send');
    expect((sendBtn as HTMLButtonElement).disabled).toBe(false);
  });

  it('clicking send with empty note does not call confirmGate', async () => {
    const confirm = vi.mocked(client.api.confirmGate);
    const gate = plainGate();
    render(<GateRow view={view()} gate={gate} />);
    fireEvent.click(screen.getAllByTestId('session-gate-choice')[1]!); // Approve and steer
    // Attempt to click send while note is empty (button is disabled, but guard also fires)
    fireEvent.click(screen.getByTestId('session-gate-send'));
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('ProposalCard — receipt survives unmount+remount after plan gate answer (Rule 5)', () => {
  it('remount: session-proposal still renders from store receipt (plan gate)', async () => {
    const RUN_REM = 'r-remount-plan';
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] });
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false });
    useRunEventStore.setState({ byRun: { [RUN_REM]: [] } });
    const gate: OpenGate = { runId: RUN_REM, ord: 1, prompt: 'Approve plan rev 1.', lifecycle: 'open', receivedAt: NOW, gateKind: 'plan_approval' };
    useGateStore.setState({ gates: { [RUN_REM]: gate }, approaching: {} });
    useGateActionStore.setState({ byGate: { [RUN_REM]: IDLE_GATE_ACTION } });
    const v = makeView({ id: RUN_REM, status: 'awaiting_human' });

    // Initial render: gate open → ProposalCard renders and records lastKind.
    const { unmount } = render(<ProposalCard view={v} chain={EMPTY_CHAIN} />);
    await waitFor(() => expect(screen.queryByTestId('session-proposal')).not.toBeNull());

    // Click Go → commitGateDecision → sets answered + receipt in store, clears gate.
    fireEvent.click(screen.getByTestId('session-proposal-go'));
    await waitFor(() => {
      const st = useGateActionStore.getState().byGate[RUN_REM];
      return st?.answered === 'approved' && st?.receipt !== null;
    });

    // Unmount: component instance gone; lastKinds (module-level) and store receipt survive.
    unmount();

    // Remount fresh — store receipt (kind:'plan') keeps session-proposal visible.
    render(<ProposalCard view={v} chain={EMPTY_CHAIN} />);
    await waitFor(() => expect(screen.queryByTestId('session-proposal')).not.toBeNull());
  });
});

describe('GateRow — fold stays visible after gate clears', () => {
  it('session-gate-chosen remains after gate prop becomes undefined (same instance)', async () => {
    const gate = plainGate();
    const { rerender } = render(<GateRow view={view()} gate={gate} />);
    fireEvent.click(screen.getAllByTestId('session-gate-choice')[0]!); // Approve — no note needed
    // Wait for the decision to send (undo window = 0 in beforeEach)
    await new Promise<void>((r) => setTimeout(r, 50));
    // Simulate RunBlock keeping GateRow mounted but passing gate=undefined after clearGate
    rerender(<GateRow view={view()} gate={undefined} />);
    expect(screen.getByTestId('session-gate-chosen')).toBeDefined();
    expect(screen.getByTestId('session-gate-chosen').textContent).toMatch(/You chose: Approve/);
  });

  it('store-based fold survives unmount then remount (Rule 5, GateRow)', async () => {
    const gate = plainGate();
    useGateStore.setState({ gates: { [RUN]: gate }, approaching: {} });
    useGateActionStore.setState({ byGate: { [RUN]: IDLE_GATE_ACTION } });

    const { unmount } = render(<GateRow view={view()} gate={gate} />);
    fireEvent.click(screen.getAllByTestId('session-gate-choice')[0]!); // Approve
    // Wait for commitGateDecision to complete and store receipt to be written.
    await waitFor(() => {
      const st = useGateActionStore.getState().byGate[RUN];
      return st?.answered === 'approved' && st?.receipt !== null;
    });

    // Unmount: chosen state lost; store receipt survives.
    unmount();

    // Remount fresh with gate=undefined — store receipt provides fold.
    render(<GateRow view={view()} gate={undefined} />);
    const chosen = screen.getByTestId('session-gate-chosen');
    expect(chosen).toBeDefined();
    expect(chosen.textContent).toMatch(/You chose: Approve/);
  });
});

describe('GateRow — overflow disabled choice cannot be sent', () => {
  it('unknown engine choice in overflow renders disabled and does not POST', async () => {
    const confirm = vi.mocked(client.api.confirmGate);
    // 5 choices: first 4 inline (all known), 5th in overflow (unknown engine value → disabled)
    const gate = plainGate({ choices: ['approve', 'reject', 'request_changes', 'extend', 'custom-unknown'] });
    render(<GateRow view={view()} gate={gate} />);
    const overflowDetails = document.querySelector('.wk-session-gate-overflow') as HTMLDetailsElement | null;
    expect(overflowDetails).not.toBeNull();
    overflowDetails!.setAttribute('open', '');
    const overflowBtns = overflowDetails!.querySelectorAll('[data-testid="session-gate-choice"]');
    expect(overflowBtns.length).toBe(1);
    const btn = overflowBtns[0] as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.click(btn);
    await new Promise<void>((r) => setTimeout(r, 50));
    expect(confirm).not.toHaveBeenCalled();
  });
});
