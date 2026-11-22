/**
 * crew#1775: a page load read `GET /runs/:id/gate` for EVERY waiting run (8 in one trace), from the runs list, on
 * every route. Behind a slow daemon those reads held the browser's six connections, so the page's own reads (the run's
 * gate, an editor's grants, `/health`) queued behind them. These pin:
 *  - the runs list reads no gate at all: a page reads only the gates it shows;
 *  - the visible run reads its own gate, and re-reads a cached one after a reconnect;
 *  - a list that shows waiting runs (the needs queue) reads their gates, in its order, through the shared slots;
 *  - the needs queue reads the gates of the decision rows it shows, and nothing else.
 */
import { act, cleanup, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import type { GateInfo } from '../src/api/types.js';
import { GATE_READS_IN_FLIGHT, reconcileGateRetries, resetGateSlotsForTest } from '../src/board/gateActions.js';
import type { NeedRow } from '../src/board/needsYou.js';
import { NeedsQueueSurface } from '../src/components/NeedsYouQueue.js';
import { gateRunIdsOf, useOwnGateRead, useShownGateReads } from '../src/hooks/useOwnGateRead.js';
import { useRuns } from '../src/hooks/useRuns.js';
import { useConnectionStore } from '../src/store/connection.js';
import { useGateStore } from '../src/store/gates.js';
import { makeView } from './factories.js';

const info = (runId: string, ord = 2): GateInfo => ({ runId, ord, prompt: 'Proceed?', lifecycle: 'open', receivedAt: new Date(200).toISOString() });

let n = 0;
const fresh = (tag: string): string => `r-1775-${tag}-${++n}`;

function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void } {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  useGateStore.getState().reconcile([]);
  useGateStore.setState({ gates: {}, approaching: {} });
  useConnectionStore.setState({ status: 'connected' } as never);
  vi.spyOn(api, 'getElicitation').mockResolvedValue(null);
});
afterEach(() => { cleanup(); reconcileGateRetries([]); resetGateSlotsForTest(); vi.restoreAllMocks(); });

describe('a page reads only the gates it shows (crew#1775)', () => {
  it('the runs list reads no gate, however many runs wait', async () => {
    const waiting = Array.from({ length: 8 }, (_, i) => makeView({ id: fresh(`list${i}`), status: 'awaiting_human' }));
    vi.spyOn(api, 'listRuns').mockResolvedValue({ runs: waiting });
    const getGate = vi.spyOn(api, 'getGate').mockImplementation(async (id: string) => info(id));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await new Promise((r) => setTimeout(r, 30));
    expect(getGate).not.toHaveBeenCalled();
  });

  it('the visible run reads its own gate, and a reconnect re-reads the one it has cached', async () => {
    const run = fresh('own');
    useGateStore.getState().setGate({ runId: run, ord: 2, prompt: 'Proceed?', lifecycle: 'open', receivedAt: 100 });
    const getGate = vi.spyOn(api, 'getGate').mockResolvedValue(info(run, 3));
    renderHook(() => useOwnGateRead(run, 'awaiting_human'));
    await new Promise((r) => setTimeout(r, 20));
    expect(getGate).not.toHaveBeenCalled(); // cached: nothing to read
    act(() => { useConnectionStore.setState({ status: 'disconnected' } as never); });
    act(() => { useConnectionStore.setState({ status: 'connected' } as never); });
    await waitFor(() => expect(useGateStore.getState().gates[run]?.ord).toBe(3));
    expect(getGate).toHaveBeenCalledTimes(1);
  });

  it('a list reads the gates of the waiting runs it shows, in its order, a few at a time, each once', async () => {
    const ids = Array.from({ length: 6 }, (_, i) => fresh(`shown${i}`));
    const pending: Array<() => void> = [];
    const asked: string[] = [];
    vi.spyOn(api, 'getGate').mockImplementation((id: string) => {
      asked.push(id);
      const d = deferred<GateInfo>();
      pending.push(() => d.resolve(info(id)));
      return d.promise;
    });
    const { rerender } = renderHook(({ shown }) => useShownGateReads(shown), { initialProps: { shown: ids } });
    await waitFor(() => expect(asked).toHaveLength(GATE_READS_IN_FLIGHT));
    expect(asked).toStrictEqual(ids.slice(0, GATE_READS_IN_FLIGHT));
    rerender({ shown: [...ids] }); // the same list again (a re-render) starts nothing new
    await waitFor(() => {
      while (pending.length > 0) pending.shift()!();
      expect(Object.keys(useGateStore.getState().gates).filter((id) => ids.includes(id))).toHaveLength(ids.length);
    });
    expect(asked).toStrictEqual(ids);
  });

  it('the needs queue reads the gates of its decision rows only', async () => {
    const a = fresh('qa');
    const b = fresh('qb');
    const failed = fresh('qf');
    const runs = [makeView({ id: a, status: 'awaiting_human' }), makeView({ id: b, status: 'awaiting_human' }), makeView({ id: failed, status: 'failed' })];
    const row = (key: string, kind: NeedRow['kind']): NeedRow => ({
      key, kind, severity: 1, stakes: 1, subject: key, text: key, tone: kind === 'gate' ? 'gate' : 'fail', at: null,
      action: { kind: 'open', path: '/x', label: 'Open' },
    } as unknown as NeedRow);
    const rows = [row(`gate:${a}`, 'gate'), row(`gate:${b}`, 'gate'), row(`failed:${failed}`, 'failed-run')];
    expect(gateRunIdsOf(rows)).toStrictEqual([a, b]);
    const getGate = vi.spyOn(api, 'getGate').mockImplementation(async (id: string) => info(id));
    render(<NeedsQueueSurface rows={rows} runs={runs} navigate={() => undefined} now={Date.now()} />);
    await waitFor(() => expect(getGate).toHaveBeenCalledTimes(2));
    expect(getGate.mock.calls.map(([id]) => id).sort()).toStrictEqual([a, b].sort());
  });
});
