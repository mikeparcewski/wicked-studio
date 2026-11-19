/**
 * studio#1197: a waiting run's plan gate stayed "reading the plan…" for good. The gate read has a 10 s deadline, crew
 * answers a 40 KB plan gate in ~15 s on a loaded host, and nothing read again until a live frame refreshed the runs
 * list: so the read was abandoned, never retried, and never given longer. These pin: a read that misses its deadline
 * is retried with backoff and a longer deadline until it lands; the failure is on `useGateReadStore` (the card says
 * so and offers a retry); a run that stops waiting stops the retries.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { GateInfo } from '../src/api/types.js';
import {
  GATE_READ_DEADLINE_MS, GATE_RETRY_BASE_MS, ensureGate, reconcileGateRetries, refreshGate, useGateReadStore,
} from '../src/board/gateActions.js';
import { useGateStore } from '../src/store/gates.js';

const NOW = 1_700_000_000_000;
let n = 0;
const fresh = (): string => `r-1197-${++n}`;
function planInfo(runId: string): GateInfo {
  return { runId, ord: 2, lifecycle: 'open', receivedAt: new Date(NOW).toISOString(), gateKind: 'plan_approval', prompt: 'Approve plan rev 2 before unit 2 runs' } as GateInfo;
}
/** A gate read that answers after `ms` and rejects when its signal aborts first. */
function slowGate(ms: number, runId: string): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(client.api, 'getGate').mockImplementation((_id: string, signal?: AbortSignal) => new Promise<GateInfo>((resolve, reject) => {
    const t = setTimeout(() => resolve(planInfo(runId)), ms);
    signal?.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); });
  }));
}

beforeEach(() => { vi.useFakeTimers(); useGateStore.setState({ gates: {}, approaching: {} }); useGateReadStore.setState({ failed: {} }); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('a gate read that misses its deadline', () => {
  it('lands on a later try: the deadline grows, so a 15 s gate is read where a fixed 10 s never would', async () => {
    const id = fresh();
    const spy = slowGate(15_000, id);
    void ensureGate(id);
    await vi.advanceTimersByTimeAsync(GATE_READ_DEADLINE_MS + 1);
    expect(useGateStore.getState().gates[id]).toBeUndefined();
    expect(useGateReadStore.getState().failed[id]).toBe(1);
    await vi.advanceTimersByTimeAsync(GATE_RETRY_BASE_MS + 20_000);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(useGateStore.getState().gates[id]?.gateKind).toBe('plan_approval');
    expect(useGateReadStore.getState().failed[id]).toBeUndefined();
  });

  it('is retried with a doubling wait until it lands', async () => {
    const id = fresh();
    const spy = vi.spyOn(client.api, 'getGate')
      .mockRejectedValueOnce(new Error('down')).mockRejectedValueOnce(new Error('down')).mockResolvedValue(planInfo(id));
    await refreshGate(id);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(GATE_RETRY_BASE_MS - 1);
    expect(spy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(GATE_RETRY_BASE_MS * 2 - 1);
    expect(spy).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(spy).toHaveBeenCalledTimes(3);
    expect(useGateStore.getState().gates[id]).toBeDefined();
  });

  it('stops being retried once the run no longer waits on a person', async () => {
    const id = fresh();
    const spy = vi.spyOn(client.api, 'getGate').mockRejectedValue(new Error('down'));
    await refreshGate(id);
    reconcileGateRetries([]);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(useGateReadStore.getState().failed[id]).toBeUndefined();
  });
});
