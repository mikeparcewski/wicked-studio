/**
 * crew#1775: a page load read `GET /runs/:id/gate` for every waiting run, four at a time (8 in one trace). Behind a
 * slow daemon those reads held most of the browser's six connections, so the page's own reads (the shown run's gate,
 * an editor's grants, `/health`) queued behind gates nobody was looking at. The late-join pass is lazy now:
 *  - it holds one connection at most, reading the waiting runs one at a time in its order, and every gate still lands;
 *  - the run on screen reads its own gate at once, outside the pass's slot;
 *  - a run whose read keeps hanging does not hold the one slot on every pass (review r2).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import type { GateInfo } from '../src/api/types.js';
import { reconcileGateRetries, resetGateSlotsForTest } from '../src/board/gateActions.js';
import { useOwnGateRead } from '../src/hooks/useOwnGateRead.js';
import { useRuns } from '../src/hooks/useRuns.js';
import { useConnectionStore } from '../src/store/connection.js';
import { useGateStore } from '../src/store/gates.js';
import { makeView } from './factories.js';

const info = (runId: string): GateInfo => ({ runId, ord: 2, prompt: 'Proceed?', lifecycle: 'open', receivedAt: new Date(200).toISOString() });

let n = 0;
const fresh = (tag: string): string => `r-1775-${tag}-${++n}`;

beforeEach(() => {
  useGateStore.getState().reconcile([]);
  useGateStore.setState({ gates: {}, approaching: {} });
  useConnectionStore.setState({ status: 'connected' } as never);
  vi.spyOn(api, 'getElicitation').mockResolvedValue(null);
});
afterEach(() => { reconcileGateRetries([]); resetGateSlotsForTest(); vi.restoreAllMocks(); });

describe('the late-join gate pass is lazy (crew#1775)', () => {
  it('reads the waiting runs one at a time, in order, and every gate lands', async () => {
    const ids = Array.from({ length: 8 }, (_, i) => fresh(`list${i}`));
    vi.spyOn(api, 'listRuns').mockResolvedValue({ runs: ids.map((id) => makeView({ id, status: 'awaiting_human' })) });
    const asked: string[] = [];
    const pending: Array<() => void> = [];
    let open = 0;
    let peak = 0;
    vi.spyOn(api, 'getGate').mockImplementation((id: string) => {
      asked.push(id);
      open += 1;
      peak = Math.max(peak, open);
      return new Promise<GateInfo>((resolve) => { pending.push(() => { open -= 1; resolve(info(id)); }); });
    });
    renderHook(() => useRuns());
    await waitFor(() => expect(asked).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 30));
    expect(asked).toHaveLength(1); // the rest wait for the one slot
    await waitFor(() => {
      while (pending.length > 0) pending.shift()!();
      expect(Object.keys(useGateStore.getState().gates).filter((id) => ids.includes(id))).toHaveLength(ids.length);
    });
    expect(peak).toBe(1);
    expect(asked).toStrictEqual(ids);
  });

  it('the run on screen reads its own gate while the pass holds its slot', async () => {
    const ids = Array.from({ length: 3 }, (_, i) => fresh(`own${i}`));
    vi.spyOn(api, 'listRuns').mockResolvedValue({ runs: ids.map((id) => makeView({ id, status: 'awaiting_human' })) });
    const asked: string[] = [];
    vi.spyOn(api, 'getGate').mockImplementation((id: string) => {
      asked.push(id);
      return id === ids[2] ? Promise.resolve(info(id)) : new Promise<GateInfo>(() => undefined);
    });
    renderHook(() => { useRuns(); useOwnGateRead(ids[2]!, 'awaiting_human'); });
    await waitFor(() => expect(useGateStore.getState().gates[ids[2]!]?.ord).toBe(2));
    expect(asked).toContain(ids[0]);
    expect(asked).not.toContain(ids[1]); // still waiting for the pass's one slot
  });

  it('a run whose gate read keeps hanging does not keep the runs after it unread while the list refreshes', async () => {
    vi.useFakeTimers();
    try {
      const hung = fresh('hung');
      const ok = fresh('ok');
      vi.spyOn(api, 'listRuns').mockResolvedValue({ runs: [hung, ok].map((id) => makeView({ id, status: 'awaiting_human' })) });
      vi.spyOn(api, 'getGate').mockImplementation((id: string, signal?: AbortSignal) => id === ok
        ? Promise.resolve(info(id))
        : new Promise<GateInfo>((_, reject) => { signal?.addEventListener('abort', () => reject(new Error('deadline'))); }));
      const { result } = renderHook(() => useRuns());
      await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      // Lifecycle events keep refreshing the list, faster than the hung read's deadline.
      for (let t = 0; t < 30_000; t += 2_000) {
        act(() => { result.current.refresh(); });
        await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
      }
      expect(useGateStore.getState().gates[ok]?.ord).toBe(2);
      expect(useGateStore.getState().gates[hung]).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});

