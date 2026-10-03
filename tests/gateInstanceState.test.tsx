import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';

/**
 * studio#439: the shared gate action state (queued / busy / answered / error) is about ONE gate
 * INSTANCE — ord + receivedAt — not the run. A run can re-open a gate at the SAME ord (a new
 * `awaitingHuman`); that is a fresh question: a decision queued for the one before is not sent to
 * it, and a refusal or an answer on the one before does not show on it.
 */

vi.mock('../src/api/client.js', async (orig) => {
  const real = await orig<typeof import('../src/api/client.js')>();
  return { ...real, api: { ...real.api, confirmGate: vi.fn() } };
});

const { api } = await import('../src/api/client.js');
const { decideGate, useGateActionStore } = await import('../src/board/gateActions.js');
const { setUndoWindowForTest, undoDecision, useUndoQueue, UNDO_WINDOW_MS } = await import('../src/board/undoQueue.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useMembershipStore } = await import('../src/store/membership.js');

const confirmGate = vi.mocked(api.confirmGate);
const results = (): string[] => useUndoQueue.getState().results.map((r) => `${r.kind}: ${r.text}`);
const reask = (ord: number): void => {
  act(() => { useGateStore.getState().ingest({ type: 'awaitingHuman', session: 'b1', ord, prompt: 'Approve unit 3 again?' } as never); });
};

beforeEach(() => {
  setUndoWindowForTest(null);
  vi.useFakeTimers();
  confirmGate.mockReset().mockResolvedValue({ status: 'resumed' } as never);
  useGateStore.setState({ gates: {}, approaching: {} });
  useGateActionStore.setState({ byGate: {} });
  useMembershipStore.setState({ projectNameByRun: { b1: 'beta' } });
  useGateStore.getState().setGate({ runId: 'b1', ord: 3, prompt: 'Approve unit 3?', lifecycle: 'open', receivedAt: Date.now() });
});

afterEach(() => {
  for (const p of useUndoQueue.getState().pending) undoDecision(p.id);
  vi.useRealTimers();
});

describe('studio#439: gate state per gate instance', () => {
  it('a queued decision is not sent to a gate re-opened at the same ord', async () => {
    void decideGate('b1', { approve: true });
    await vi.advanceTimersByTimeAsync(4_000);
    reask(3);
    expect(results()[0]).toMatch(/^not-sent: Not sent: the gate on .* was asked again/);
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS);
    expect(confirmGate).not.toHaveBeenCalled();
    expect(useGateActionStore.getState().byGate['b1']).toBeUndefined();
  });

  it('a refusal on the gate before does not show on the same-ord gate that replaces it', async () => {
    confirmGate.mockRejectedValueOnce(new Error('plan refused: the budget is spent'));
    void decideGate('b1', { approve: true });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 10);
    expect(useGateActionStore.getState().byGate['b1']?.error).toMatch(/plan refused/);
    await vi.advanceTimersByTimeAsync(1_000);
    reask(3);
    expect(useGateActionStore.getState().byGate['b1']).toBeUndefined();
    // …and the fresh gate is answerable.
    void decideGate('b1', { approve: true });
    await vi.advanceTimersByTimeAsync(UNDO_WINDOW_MS + 10);
    expect(confirmGate).toHaveBeenCalledTimes(2);
  });

  it('re-reading the SAME gate instance (same ord, same receivedAt) keeps the state', async () => {
    void decideGate('b1', { approve: true });
    const g = useGateStore.getState().gates['b1']!;
    act(() => { useGateStore.getState().setGate({ ...g }); });
    expect(useGateActionStore.getState().byGate['b1']?.queued).toBe(true);
    expect(results()).toEqual([]);
  });
});
