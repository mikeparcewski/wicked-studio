/**
 * studio#1319: after crew#1775 the late-join pass reads waiting runs' gates through one background slot, and a failed
 * read's retry (deadline up to 60 s) went through that same slot: one slow gate's retry held every other waiting run's
 * first read for its whole deadline. These pin: a retry waits in its own slot, so with 5+ waiting runs and one slow
 * gate the others hydrate within one normal read each; and a run whose retry is queued for its slot is left to that
 * retry, never read again with a long deadline in a first read's slot.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { GateInfo } from '../src/api/types.js';
import {
  GATE_READ_DEADLINE_MS, GATE_READS_IN_FLIGHT, GATE_RETRY_BASE_MS, GATE_RETRY_READS_IN_FLIGHT, hydrateGate, inGateSlot,
  reconcileGateRetries, resetGateSlotsForTest, useGateReadStore,
} from '../src/board/gateActions.js';
import { useGateStore } from '../src/store/gates.js';

const NOW = 1_700_000_000_000;
/** One normal gate read on a healthy daemon. */
const READ_MS = 100;

function info(runId: string): GateInfo {
  return { runId, ord: 2, lifecycle: 'open', receivedAt: new Date(NOW).toISOString(), gateKind: 'plan_approval', prompt: 'Approve plan rev 2' } as GateInfo;
}

/** `slow` runs hang until their deadline aborts them; every other run answers in READ_MS. Counts reads per run and
 *  the most reads on their way at once. */
function daemon(slow: ReadonlySet<string>): { calls: Map<string, number>; peak: () => number } {
  const calls = new Map<string, number>();
  let open = 0;
  let peak = 0;
  vi.spyOn(client.api, 'getGate').mockImplementation((id: string, signal?: AbortSignal) => {
    calls.set(id, (calls.get(id) ?? 0) + 1);
    open += 1; peak = Math.max(peak, open);
    return new Promise<GateInfo>((resolve, reject) => {
      const t = slow.has(id) ? undefined : setTimeout(() => { open -= 1; resolve(info(id)); }, READ_MS);
      signal?.addEventListener('abort', () => { if (t !== undefined) clearTimeout(t); open -= 1; reject(new Error('aborted')); });
    });
  });
  return { calls, peak: () => peak };
}

/** The late-join pass as `useRuns` runs it: every waiting run, in order, through the first-read slots. */
const pass = (ids: readonly string[]): Promise<void[]> => Promise.all(ids.map((id) => inGateSlot(() => hydrateGate(id))));

let n = 0;
const fresh = (p: string): string => `r-1319-${p}-${++n}`;

beforeEach(() => { vi.useFakeTimers(); useGateStore.setState({ gates: {}, approaching: {} }); useGateReadStore.setState({ failed: {} }); });
afterEach(() => { reconcileGateRetries([]); resetGateSlotsForTest(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('a slow gate’s retry does not hold the first-read slot (studio#1319)', () => {
  it('with 5+ waiting runs and one slow gate retrying, the others hydrate within one normal read each', async () => {
    const slow = fresh('slow');
    const d = daemon(new Set([slow]));
    // The slow gate's first read misses its deadline; its retry (a 20 s deadline) comes due and starts.
    void pass([slow]);
    await vi.advanceTimersByTimeAsync(GATE_READ_DEADLINE_MS + 1);
    expect(useGateReadStore.getState().failed[slow]).toBe(1);
    await vi.advanceTimersByTimeAsync(GATE_RETRY_BASE_MS + 1);
    expect(d.calls.get(slow)).toBe(2);

    // Five more runs start waiting while that retry is on its way: the next pass reads them.
    const others = Array.from({ length: 5 }, () => fresh('ok'));
    void pass([slow, ...others]);
    await vi.advanceTimersByTimeAsync(others.length * READ_MS + 1);
    for (const id of others) expect(useGateStore.getState().gates[id]?.gateKind).toBe('plan_approval');
    // The slow run was left to its retry, not read again.
    expect(d.calls.get(slow)).toBe(2);
    expect(d.peak()).toBeLessThanOrEqual(GATE_READS_IN_FLIGHT + GATE_RETRY_READS_IN_FLIGHT);
  });

  it('a run whose retry waits for a retry slot is left to it: no long-deadline read in a first read’s slot', async () => {
    const a = fresh('slow-a');
    const b = fresh('slow-b');
    const d = daemon(new Set([a, b]));
    void pass([a, b]);
    await vi.advanceTimersByTimeAsync(2 * GATE_READ_DEADLINE_MS + 1);
    expect(useGateReadStore.getState().failed[a]).toBe(1);
    expect(useGateReadStore.getState().failed[b]).toBe(1);
    // a's retry came due at 12 s and holds the retry slot (a 20 s deadline); b's comes due now and waits behind it.
    await vi.advanceTimersByTimeAsync(GATE_RETRY_BASE_MS + 1);
    expect(d.calls.get(a)).toBe(2);
    expect(d.calls.get(b)).toBe(1);
    // A pass now: b's retry is queued, so the pass leaves b alone.
    const ok = fresh('ok');
    void pass([a, b, ok]);
    await vi.advanceTimersByTimeAsync(READ_MS + 1);
    expect(useGateStore.getState().gates[ok]).toBeDefined();
    expect(d.calls.get(b)).toBe(1);
    // a's retry ends at its deadline; b's retry then takes the retry slot, once.
    await vi.advanceTimersByTimeAsync(2 * GATE_READ_DEADLINE_MS);
    expect(d.calls.get(b)).toBe(2);
  });
});
