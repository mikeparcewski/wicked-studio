import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

/**
 * S18a — two gate-answering ports land on the Desk (DES-STUDIO-REBUILD-001 Amendment 5):
 *
 *  - the approvals GROUP row answers in place — Approve all / Reject all, plus an optional
 *    reject-with-a-reason — fanning out one `POST /runs/:id/gate` per member through the shared
 *    batch path (the one 10 s undo window, per-id failures, retry-just-this-one);
 *  - the Desk QUESTION row's Reject choice opens an OPTIONAL one-line reason that upgrades the
 *    decision to {approve:false, amend} — while the keyboard fast path (a digit) still commits the
 *    bare reject at once (boundary 2).
 *
 * Timing runs a SHORT undo window on a fake clock (the window itself is proven in
 * desk_answer / undoQueue; here the interest is the fan-out and the bodies).
 */

vi.mock('../src/api/client.js', async (orig) => {
  const real = await orig<typeof import('../src/api/client.js')>();
  return { ...real, api: { ...real.api, confirmGate: vi.fn(), getRunEvents: vi.fn() } };
});

const { api } = await import('../src/api/client.js');
const { useBatchGateStore } = await import('../src/board/batchGates.js');
const { setUndoWindowForTest, undoDecision, useUndoQueue } = await import('../src/board/undoQueue.js');
const { useGateStore } = await import('../src/store/gates.js');
const { NeedsQueueSurface } = await import('../src/components/NeedsYouQueue.js');
const { QuestionRow } = await import('../src/components/desk/QuestionRow.js');
const { useGateActionStore } = await import('../src/board/gateActions.js');
type NeedRow = import('../src/board/needsYou.js').NeedRow;

const confirmGate = vi.mocked(api.confirmGate);
const getRunEvents = vi.mocked(api.getRunEvents);
const NOW = 1_700_000_000_000;

/** A simple approve/reject gate NeedRow that folds into the approvals group. */
const gateRow = (id: string): NeedRow => ({
  key: `gate:${id}`, kind: 'gate', severity: 100, stakes: 1, groupKey: 'approval',
  subject: id, text: `gate ${id}`, tone: 'gate', at: NOW,
  subjectPath: `/runs/${id}`, action: { kind: 'open', path: `/runs/${id}#gate`, label: 'Open gate ›' },
});

const bodies = (): unknown[] => confirmGate.mock.calls.map((c) => c[1]);
const runIdsSent = (): string[] => confirmGate.mock.calls.map((c) => c[0]);

function renderGroup(): void {
  render(
    <NeedsQueueSurface
      rows={[gateRow('g1'), gateRow('g2')]}
      runs={[]}
      navigate={() => {}}
      now={NOW}
    />,
  );
}

beforeEach(() => {
  setUndoWindowForTest(20); // a short window; advance past it to fire the fan-out
  vi.useFakeTimers();
  confirmGate.mockReset().mockResolvedValue({ status: 'resumed' } as never);
  getRunEvents.mockReset().mockResolvedValue({ events: [] } as never);
  useGateStore.setState({ gates: {}, approaching: {} });
  useGateActionStore.setState({ byGate: {} });
  useBatchGateStore.setState({
    selected: [], running: false, queued: false, done: 0, total: 0, failures: [], lastDecision: null,
  });
});

afterEach(() => {
  for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
  cleanup();
  vi.useRealTimers();
});

/** Advance past the short window and settle the fan-out's async sends. */
async function fireWindow(): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(40); });
}

describe('approval group row — Approve all', () => {
  it('seeds the selection with the members and POSTs {approve:true} to each, in order', async () => {
    renderGroup();
    fireEvent.click(screen.getByTestId('need-group-approve-all'));
    expect(useBatchGateStore.getState().selected).toEqual(['g1', 'g2']); // seeded, frozen while queued
    await fireWindow();
    expect(runIdsSent()).toEqual(['g1', 'g2']);
    expect(bodies()).toEqual([{ approve: true }, { approve: true }]);
    expect(useBatchGateStore.getState().selected).toEqual([]); // each success leaves the selection
  });

  it('clicking Approve all again while queued is a no-op (one decision, not two)', async () => {
    renderGroup();
    fireEvent.click(screen.getByTestId('need-group-approve-all'));
    await act(async () => { await vi.advanceTimersByTimeAsync(5); }); // still inside the window
    fireEvent.click(screen.getByTestId('need-group-approve-all'));
    expect(useUndoQueue.getState().pending).toHaveLength(1);
    await fireWindow();
    expect(confirmGate).toHaveBeenCalledTimes(2); // g1 + g2 once each, not four times
  });
});

describe('approval group row — Reject all (bare)', () => {
  it('POSTs {approve:false} to each member, in order', async () => {
    renderGroup();
    fireEvent.click(screen.getByTestId('need-group-reject-all'));
    await fireWindow();
    expect(runIdsSent()).toEqual(['g1', 'g2']);
    expect(bodies()).toEqual([{ approve: false }, { approve: false }]);
  });

  it('Undo within the window sends nothing', async () => {
    renderGroup();
    fireEvent.click(screen.getByTestId('need-group-reject-all'));
    const id = useUndoQueue.getState().pending[0]!.id;
    act(() => { undoDecision(id); });
    await fireWindow();
    expect(confirmGate).not.toHaveBeenCalled();
  });
});

describe('approval group row — Reject with a reason', () => {
  it('a typed reason POSTs {approve:false, amend} to each member', async () => {
    renderGroup();
    fireEvent.click(screen.getByTestId('need-group-reject'));
    const input = screen.getByTestId('need-group-reject-reason');
    fireEvent.change(input, { target: { value: 'wrong branch' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await fireWindow();
    expect(runIdsSent()).toEqual(['g1', 'g2']);
    expect(bodies()).toEqual([
      { approve: false, amend: 'wrong branch' },
      { approve: false, amend: 'wrong branch' },
    ]);
  });

  it('an empty reason on Enter commits the BARE reject — no amend key', async () => {
    renderGroup();
    fireEvent.click(screen.getByTestId('need-group-reject'));
    fireEvent.keyDown(screen.getByTestId('need-group-reject-reason'), { key: 'Enter' });
    await fireWindow();
    expect(bodies()).toEqual([{ approve: false }, { approve: false }]);
  });

  it('Escape closes the reason input and sends nothing', async () => {
    renderGroup();
    fireEvent.click(screen.getByTestId('need-group-reject'));
    const input = screen.getByTestId('need-group-reject-reason');
    fireEvent.change(input, { target: { value: 'typed then cancelled' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('need-group-reject-reason')).toBeNull();
    await fireWindow();
    expect(confirmGate).not.toHaveBeenCalled();
  });
});

describe('approval group row — per-id failure + retry', () => {
  it('a failed id is listed with a retry that fires ONLY that id', async () => {
    confirmGate.mockImplementation((runId: string) =>
      runId === 'g2' && confirmGate.mock.calls.filter((c) => c[0] === 'g2').length === 1
        ? Promise.reject(new Error('network error'))
        : (Promise.resolve({ status: 'resumed' }) as never));
    renderGroup();
    fireEvent.click(screen.getByTestId('need-group-approve-all'));
    await fireWindow();
    // g2 failed: its row and a retry button are shown; g1 landed.
    const failure = screen.getByTestId('need-group-failure');
    expect(failure.getAttribute('data-run-id')).toBe('g2');
    expect(useBatchGateStore.getState().failures.map((f) => f.runId)).toEqual(['g2']);
    confirmGate.mockClear();
    fireEvent.click(screen.getByTestId('need-group-retry'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(runIdsSent()).toEqual(['g2']); // retry fires only g2, never g1
  });
});

describe('QuestionRow — Reject with an optional reason (boundary 2)', () => {
  const openGate = (runId: string): void =>
    useGateStore.getState().setGate({ runId, ord: 0, prompt: `gate ${runId}`, lifecycle: 'open', receivedAt: NOW });

  function renderRow(runId: string): void {
    render(<QuestionRow runId={runId} units={[]} openPath={`/runs/${runId}#gate`} openLabel="Open gate ›" onOpen={() => {}} />);
  }

  async function openChoices(): Promise<void> {
    fireEvent.click(screen.getByTestId('need-answer'));
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); // settle the events read
  }

  it('a digit still commits the bare reject at once — no amend, no reason input', async () => {
    openGate('q1');
    renderRow('q1');
    await openChoices();
    fireEvent.keyDown(screen.getByTestId('need-choices'), { key: '2' }); // reject digit
    expect(screen.queryByTestId('need-choice-reason')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    expect(confirmGate).toHaveBeenCalledTimes(1);
    expect(confirmGate.mock.calls[0]![1]).toEqual({ approve: false, ord: 0 });
  });

  it('clicking Reject reveals a reason input; a typed reason upgrades the body to {approve:false, amend}', async () => {
    openGate('q2');
    renderRow('q2');
    await openChoices();
    fireEvent.click(screen.getByTestId('need-choices').querySelector('[data-choice="reject"]')!);
    const input = screen.getByTestId('need-choice-reason');
    fireEvent.change(input, { target: { value: 'needs the Q3 numbers' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    expect(confirmGate).toHaveBeenCalledTimes(1);
    expect(confirmGate.mock.calls[0]![1]).toEqual({ approve: false, amend: 'needs the Q3 numbers', ord: 0 });
  });

  it('clicking Reject then Escape sends nothing and hides the reason input', async () => {
    openGate('q3');
    renderRow('q3');
    await openChoices();
    fireEvent.click(screen.getByTestId('need-choices').querySelector('[data-choice="reject"]')!);
    const input = screen.getByTestId('need-choice-reason');
    fireEvent.change(input, { target: { value: 'never mind' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByTestId('need-choice-reason')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(40); });
    expect(confirmGate).not.toHaveBeenCalled();
  });
});
