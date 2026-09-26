import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

/**
 * Wave 2a round 3 (independent review of #337): a queued decision is about ONE gate.
 * All timing here runs the REAL 10 s window (fake clock, real duration).
 *
 *  - answered elsewhere / run moved on mid-window  → not sent, and the toast says so;
 *  - a NEW gate on the same run mid-window         → not sent; never applied to the new gate;
 *  - the send names its gate (`ord`)                → the daemon can refuse a stale one (409);
 *  - an older daemon refusing `ord`                 → resent once without it;
 *  - a decision the guard refuses                   → a visible notice, never silence;
 *  - the gate card shows the shared queued state and disables its controls;
 *  - a reject note survives Undo; batch leaves already-decided gates out, and says so.
 */

vi.mock('../src/api/client.js', async (orig) => {
  const real = await orig<typeof import('../src/api/client.js')>();
  return { ...real, api: { ...real.api, confirmGate: vi.fn(), getRunDiff: vi.fn(), getCoverageReportForRepo: vi.fn() } };
});

const { api, ApiError } = await import('../src/api/client.js');
const { decideGate, useGateActionStore } = await import('../src/board/gateActions.js');
const { runBatchDecision, toggleBatchSelect, useBatchGateStore } = await import('../src/board/batchGates.js');
const { setUndoWindowForTest, undoDecision, useUndoQueue, UNDO_WINDOW_MS } = await import('../src/board/undoQueue.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useMembershipStore } = await import('../src/store/membership.js');
const { UndoToasts } = await import('../src/components/UndoToasts.js');
const { GateRejectNote } = await import('../src/components/GateRejectNote.js');
const { SteeringGate } = await import('../src/components/SteeringGate.js');

const confirmGate = vi.mocked(api.confirmGate);
const openGate = (runId: string, ord: number): void =>
  useGateStore.getState().setGate({ runId, ord, prompt: `gate ${runId}`, lifecycle: 'open', receivedAt: Date.now() });
const results = (): string[] => useUndoQueue.getState().results.map((r) => `${r.kind}: ${r.text}`);

beforeEach(() => {
  setUndoWindowForTest(null); // the REAL window
  vi.useFakeTimers();
  confirmGate.mockReset().mockResolvedValue({ status: 'resumed' } as never);
  useGateStore.setState({ gates: {}, approaching: {} });
  useMembershipStore.setState({ projectNameByRun: { b1: 'beta' } });
  useBatchGateStore.setState({
    selected: [], running: false, queued: false, done: 0, total: 0, failures: [], lastDecision: null,
  });
});

afterEach(() => {
  for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
  vi.useRealTimers();
});

describe('the gate moves under a queued decision', () => {
  it('answered elsewhere mid-window: nothing is sent and the notice says so', async () => {
    openGate('b1', 3);
    void decideGate('b1', { approve: true });
    await vi.advanceTimersByTimeAsync(4_000);
    act(() => { useGateStore.getState().ingest({ type: 'resumed', session: 'b1' } as never); });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(confirmGate).not.toHaveBeenCalled();
    expect(useUndoQueue.getState().pending).toEqual([]);
    expect(results()).toEqual(['not-sent: Not sent: the gate on beta · b1 was answered elsewhere or the run moved on.']);
    expect(useGateActionStore.getState().byGate['b1']?.queued ?? false).toBe(false);
  });

  it('a NEW gate on the same run mid-window: the old decision is never applied to it', async () => {
    openGate('b1', 3);
    void decideGate('b1', { approve: true });
    await vi.advanceTimersByTimeAsync(4_000);
    act(() => {
      useGateStore.getState().ingest({ type: 'awaitingHuman', session: 'b1', ord: 4, prompt: 'Approve unit 4?' } as never);
    });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(confirmGate).not.toHaveBeenCalled();
    expect(results()[0]).toMatch(/^not-sent: Not sent: a new gate opened on beta · b1/);
    // The new gate is answerable afresh.
    void decideGate('b1', { approve: true });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(confirmGate).toHaveBeenCalledTimes(1);
    expect(confirmGate.mock.calls[0]![1]).toEqual({ approve: true, ord: 4 });
  });

  it('the send names the gate it was made on (ord) — nothing before 10 s, once at 10 s', async () => {
    openGate('b1', 3);
    void decideGate('b1', { approve: false, amend: 'wrong branch' });
    await vi.advanceTimersByTimeAsync(9_999);
    expect(confirmGate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(confirmGate).toHaveBeenCalledWith('b1', { approve: false, amend: 'wrong branch', ord: 3 });
    expect(results()).toEqual(['sent: Rejected beta · b1.']);
  });

  it("a failed send is a visible result (the daemon's 409 gate_changed)", async () => {
    openGate('b1', 3);
    confirmGate.mockRejectedValueOnce(new ApiError(409, 'Gate changed: this decision was made on the gate before unit 3, but the open gate is before unit 4'));
    void decideGate('b1', { approve: true });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(results()[0]).toMatch(/^failed: Not sent: beta · b1 — .*Gate changed/);
  });
});

describe('never silent', () => {
  it('a second decision on a queued gate is refused WITH a notice', async () => {
    openGate('b1', 3);
    void decideGate('b1', { approve: true });
    void decideGate('b1', { approve: false });
    expect(useUndoQueue.getState().pending).toHaveLength(1);
    expect(results()).toEqual(['not-sent: Not sent: beta · b1 already has a decision that is waiting to send (see its Undo toast).']);
  });

  it('the gate card shows the shared queued state with its controls disabled', () => {
    openGate('b1', 3);
    render(<><SteeringGate runId="b1" ord={3} prompt="gate b1" /><UndoToasts /></>);
    act(() => { void decideGate('b1', { approve: true }); }); // decided on the board chip
    expect(screen.getByTestId('steering-queued').textContent).toBe('queued · undo in toast');
    expect(screen.getByTestId('steering-approve')).toBeDisabled();
    expect(screen.getByTestId('steering-reject')).toBeDisabled();
    expect(screen.getByTestId('undo-toast').textContent).toContain('Approving beta · b1 in 10 s');
  });
});

describe('what survives an Undo', () => {
  it('the reject reason is handed back to the note', async () => {
    openGate('b1', 3);
    const { unmount } = render(<GateRejectNote runId="b1" onClose={() => {}} />);
    const input = screen.getByTestId('gate-reject-note');
    fireEvent.change(input, { target: { value: 'needs the Q3 numbers' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    unmount();
    act(() => { undoDecision(useUndoQueue.getState().pending[0]!.id); });
    render(<GateRejectNote runId="b1" onClose={() => {}} />);
    expect((screen.getByTestId('gate-reject-note') as HTMLInputElement).value).toBe('needs the Q3 numbers');
  });
});

describe('batch counts only what it will send', () => {
  it('a gate with a decision already queued cannot be selected, and is left out (with a notice) if it was', async () => {
    openGate('b1', 3);
    openGate('r-b', 1);
    void decideGate('b1', { approve: true });
    toggleBatchSelect('b1');
    expect(useBatchGateStore.getState().selected).toEqual([]);
    useBatchGateStore.setState({ selected: ['b1', 'r-b'] }); // selected BEFORE b1 was decided
    void runBatchDecision({ approve: true });
    expect(useUndoQueue.getState().pending.map((p) => p.runIds)).toEqual([['b1'], ['r-b']]);
    expect(results()).toContain('not-sent: 1 selected gate already has a decision — left out of the batch.');
  });
});

describe('an older daemon refuses ord', () => {
  it('resends once without it, and stops sending it', async () => {
    openGate('b1', 3);
    confirmGate.mockRejectedValueOnce(new ApiError(400, 'Invalid request body: unknown field `ord` — this endpoint does not accept it'));
    void decideGate('b1', { approve: true });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(confirmGate.mock.calls.map((c) => c[1])).toEqual([{ approve: true, ord: 3 }, { approve: true }]);
    expect(results()).toEqual(['sent: Approved beta · b1.']);
  });
});
