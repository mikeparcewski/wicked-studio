import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import type { GateInfo } from '../src/api/types.js';
import { commitGateDecision, reconcileGateRetries, resetGateSlotsForTest } from '../src/board/gateActions.js';
import { flushDecisionsForTest, resetDecisionsForTest, setUndoWindowForTest } from '../src/board/undoQueue.js';
import { useOwnGateRead } from '../src/hooks/useOwnGateRead.js';
import { useConnectionStore } from '../src/store/connection.js';
import { useGateStore } from '../src/store/gates.js';
import { makeView } from './factories.js';

const R = 'reconnect-1023';
const gate = { runId: R, ord: 2, prompt: 'Proceed?', lifecycle: 'open', receivedAt: 100 };
const info = (ord = 2): GateInfo => ({ ...gate, ord, receivedAt: new Date(200).toISOString() });
beforeEach(() => {
  useGateStore.getState().reconcile([]);
  useGateStore.setState({ gates: {} });
  resetDecisionsForTest();
  useConnectionStore.setState({ status: 'disconnected' });
  vi.spyOn(api, 'listRuns').mockResolvedValue({ runs: [makeView({ id: R, status: 'awaiting_human' })] });
  vi.spyOn(api, 'getElicitation').mockResolvedValue(null);
});
afterEach(() => { cleanup(); resetDecisionsForTest(); reconcileGateRetries([]); resetGateSlotsForTest(); vi.restoreAllMocks(); });
/** The run on screen reads its own gate (crew#1775: the runs list reads none). */
const shown = (): ReturnType<typeof renderHook> => renderHook(() => useOwnGateRead(R, 'awaiting_human'));
function reconnect(): void {
  act(() => { useConnectionStore.setState({ status: 'disconnected' }); });
  act(() => { useConnectionStore.setState({ status: 'connected' }); });
}
it('A: reconnect rechecks a cached gate and reads a never-cached run once', async () => {
  useGateStore.getState().setGate(gate);
  const get = vi.spyOn(api, 'getGate').mockResolvedValue(info(3));
  shown();
  reconnect();
  await waitFor(() => expect(useGateStore.getState().gates[R]?.ord).toBe(3));
  expect(get).toHaveBeenCalledTimes(1);
  cleanup();
  useGateStore.getState().clearGate(R);
  shown();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
});
it('A: same gate recheck preserves receivedAt, refreshes fields and sends the queued decision', async () => {
  useGateStore.getState().setGate(gate);
  setUndoWindowForTest(60_000);
  const post = vi.spyOn(api, 'confirmGate').mockResolvedValue({ status: 'ok' } as never);
  const decision = commitGateDecision(R, { approve: true });
  const get = vi.spyOn(api, 'getGate').mockResolvedValue({ ...info(), choices: ['approve', 'reject'], recommended: 1 });
  shown();
  reconnect();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  await waitFor(() => expect(useGateStore.getState().gates[R]?.recommended).toBe(1));
  expect(useGateStore.getState().gates[R]?.receivedAt).toBe(100);
  await act(async () => { await flushDecisionsForTest(); });
  await expect(decision).resolves.toBe('sent');
  expect(post).toHaveBeenCalledTimes(1);
});
it('C: a 404 is read once until a frame or reconnect changes the generation', async () => {
  const { ApiError } = await import('../src/api/errors.js');
  const get = vi.spyOn(api, 'getGate').mockRejectedValue(new ApiError(404, 'no gate'));
  shown();
  reconnect();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
  cleanup();
  shown(); // the page shown again: the answer stands
  await new Promise((r) => setTimeout(r, 20));
  expect(get).toHaveBeenCalledTimes(1);
  cleanup();
  act(() => { useGateStore.getState().ingest({ type: 'awaitingHuman', session: R } as never); });
  shown();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  reconnect();
  await waitFor(() => expect(get).toHaveBeenCalledTimes(3));
});
