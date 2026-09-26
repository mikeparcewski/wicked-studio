import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

/**
 * Wave 2a, behaviour 5: preview, then commit, with an undo window. A gate decision is
 * QUEUED for 10 s (never POSTed on the spot), Undo takes it back with nothing sent, and
 * a batch is ONE window then the sequential fan-out. The toast says what will happen
 * and that closing the tab sends nothing.
 */

vi.mock('../src/api/client.js', () => ({
  api: { confirmGate: vi.fn() },
}));

const { api } = await import('../src/api/client.js');
const { decideGate, useGateActionStore } = await import('../src/board/gateActions.js');
const { runBatchDecision, toggleBatchSelect, useBatchGateStore } = await import('../src/board/batchGates.js');
const {
  CLOSE_NOTE, UNDO_WINDOW_MS, decisionPreview, isQueued, undoDecision, undoHeadline, useUndoQueue,
} = await import('../src/board/undoQueue.js');
const { UndoToasts } = await import('../src/components/UndoToasts.js');
const { GateChip } = await import('../src/components/GateChip.js');

const confirmGate = vi.mocked(api.confirmGate);

beforeEach(() => {
  vi.useFakeTimers();
  confirmGate.mockReset().mockResolvedValue({ status: 'resumed' });
  useGateActionStore.setState({ byGate: {} });
  useUndoQueue.setState({ pending: [] });
  useBatchGateStore.setState({
    selected: [], running: false, queued: false, done: 0, total: 0, failures: [], lastDecision: null,
  });
});

afterEach(() => {
  for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
  vi.useRealTimers();
});

describe('a single decision waits out the window', () => {
  it('sends nothing for the first 9 s, exactly one POST at 10 s', async () => {
    const done = decideGate('r1', { approve: true });
    expect(isQueued('r1')).toBe(true);
    expect(useGateActionStore.getState().byGate['r1']?.queued).toBe(true);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(confirmGate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    await done;
    expect(confirmGate).toHaveBeenCalledTimes(1);
    expect(confirmGate).toHaveBeenCalledWith('r1', { approve: true });
    expect(useGateActionStore.getState().byGate['r1']).toMatchObject({ queued: false, answered: 'approved' });
    expect(useUndoQueue.getState().pending).toEqual([]);
  });

  it('Undo sends nothing, ever, and leaves the gate answerable', async () => {
    const done = decideGate('r1', { approve: true });
    const id = useUndoQueue.getState().pending[0]!.id;
    undoDecision(id);
    await done;
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2);
    expect(confirmGate).not.toHaveBeenCalled();
    expect(useGateActionStore.getState().byGate['r1']).toMatchObject({ queued: false, answered: null, busy: false });
    // …and a fresh decision is accepted again.
    void decideGate('r1', { approve: false });
    expect(isQueued('r1')).toBe(true);
  });

  it('a second decision while one is queued is dropped (double-submit guard)', async () => {
    void decideGate('r1', { approve: true });
    void decideGate('r1', { approve: false });
    expect(useUndoQueue.getState().pending).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(confirmGate).toHaveBeenCalledTimes(1);
    expect(confirmGate.mock.calls[0]![1]).toEqual({ approve: true });
  });
});

describe('a batch is one window, then the sequential fan-out', () => {
  it('queues ONE entry for every selected id and sends them in order after 10 s', async () => {
    toggleBatchSelect('r-a');
    toggleBatchSelect('r-b');
    const done = runBatchDecision({ approve: true });
    const pending = useUndoQueue.getState().pending;
    expect(pending).toHaveLength(1);
    expect(pending[0]!.runIds).toEqual(['r-a', 'r-b']);
    expect(useBatchGateStore.getState().queued).toBe(true);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(confirmGate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(confirmGate.mock.calls.map((c) => c[0])).toEqual(['r-a', 'r-b']);
    expect(useBatchGateStore.getState()).toMatchObject({ queued: false, running: false, selected: [] });
  });

  it('Undo on a batch sends nothing and keeps the selection', async () => {
    toggleBatchSelect('r-a');
    const done = runBatchDecision({ approve: false, amend: 'wrong branch' });
    undoDecision(useUndoQueue.getState().pending[0]!.id);
    await done;
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2);
    expect(confirmGate).not.toHaveBeenCalled();
    expect(useBatchGateStore.getState()).toMatchObject({ queued: false, selected: ['r-a'] });
    expect(useGateActionStore.getState().byGate['r-a']?.queued).toBe(false);
  });
});

describe('the copy', () => {
  it('headline counts down and names a batch', () => {
    const p = { id: 1, verb: 'approve' as const, runIds: ['r1'], preview: '', queuedAt: 10_000, dueAt: 20_000 };
    expect(undoHeadline(p, 10_000)).toBe('Approving in 10 s');
    expect(undoHeadline(p, 9_000)).toBe('Approving in 10 s'); // a stale clock never reads 11 s
    expect(undoHeadline(p, 15_500)).toBe('Approving in 5 s');
    expect(undoHeadline({ ...p, verb: 'reject', runIds: ['a', 'b', 'c'] }, 10_000)).toBe('Rejecting 3 gates in 10 s');
  });

  it('says what will happen, and that a reject cancels the run', () => {
    expect(decisionPreview('approve', 1)).toBe('The run resumes past this gate.');
    expect(decisionPreview('approve', 3)).toBe('3 runs resume past their gates.');
    expect(decisionPreview('reject', 1)).toMatch(/cancelled/);
    expect(decisionPreview('reject', 1, true)).toMatch(/your note/);
    expect(CLOSE_NOTE).toMatch(/nothing is sent/);
    expect(CLOSE_NOTE).toMatch(/stays open/);
  });
});

describe('the toast and the chip render the queue', () => {
  it('shows "Approving in 10 s" with Undo; Undo clears it and the chip is answerable again', async () => {
    const gate = { runId: 'r1', ord: 0, prompt: 'Ship it?', lifecycle: 'open', receivedAt: Date.now() };
    render(
      <>
        <GateChip runId="r1" projectId="p1" gate={gate} navigate={() => {}} />
        <UndoToasts />
      </>,
    );
    act(() => { fireEvent.click(screen.getByTestId('gate-approve-r1')); });
    const toast = screen.getByTestId('undo-toast');
    expect(toast.textContent).toContain('Approving in 10 s');
    expect(screen.getByTestId('undo-preview').textContent).toBe('The run resumes past this gate.');
    expect(screen.getByTestId('undo-close-note').textContent).toBe(CLOSE_NOTE);
    expect(screen.getByTestId('gate-queued-r1')).toBeTruthy();
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
    expect(screen.queryByTestId('undo-toast')).toBeNull();
    expect(screen.getByTestId('gate-approve-r1')).toBeTruthy();
    await act(async () => { await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS * 2); });
    expect(confirmGate).not.toHaveBeenCalled();
  });
});
