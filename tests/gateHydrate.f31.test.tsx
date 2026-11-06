/**
 * F31 (e2e-1105, rig :7721): after a reload, a chat-launched run's plan card came ~28 s late. The late-join pass read
 * `GET /runs/:id/gate` one run at a time, oldest first, over every parked run (98 on the rig), and the run's own
 * thread never read its gate. These pin:
 *  - a waiting run's thread reads its own gate when it opens, so the plan card shows without the runs list's pass;
 *  - the pass reads newest first, at most GATE_READS_IN_FLIGHT across passes; a hung read ends at its deadline;
 *  - a gate read that overlapped an answer, a live frame (gateDecided included), a prune or a reconnect never brings
 *    the old gate back; of two reads the later one wins, whichever lands first;
 *  - one read per run and generation while it is on its way.
 */
import { act, cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import type { CoreEvent, GateInfo, SessionView } from '../src/api/types.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { GATE_READ_DEADLINE_MS, IDLE_GATE_ACTION, ensureGate, refreshGate, useGateActionStore } from '../src/board/gateActions.js';
import { RunBlock } from '../src/components/session/RunConversation.js';
import { GATE_READS_IN_FLIGHT, inGateSlot, newestFirst, useRuns } from '../src/hooks/useRuns.js';
import { useConnectionStore } from '../src/store/connection.js';
import { useRunEventStore } from '../src/store/events.js';
import { invalidateGateReads, useGateStore, type OpenGate } from '../src/store/gates.js';
import { makeView } from './factories.js';

const NOW = 1_700_000_000_000;

function planInfo(runId: string, ord = 2): GateInfo {
  return {
    runId, ord, lifecycle: 'open', receivedAt: new Date(NOW).toISOString(), gateKind: 'plan_approval',
    prompt: `Approve plan rev 2 before unit ${ord} runs (manual mode; band 20-39; manual mode): pa-scope → fix → review → deliver. Approve, approve with an edited plan, or reject.`,
  } as GateInfo;
}
function openGate(runId: string, ord = 2): OpenGate {
  return { runId, ord, prompt: 'Approve plan rev 2', lifecycle: 'open', receivedAt: NOW, gateKind: 'plan_approval' };
}

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** `api.getGate` answered by hand, call by call. */
function heldGetGate(): { calls: Array<ReturnType<typeof deferred<GateInfo>>>; spy: ReturnType<typeof vi.spyOn> } {
  const calls: Array<ReturnType<typeof deferred<GateInfo>>> = [];
  const spy = vi.spyOn(client.api, 'getGate').mockImplementation(() => { const d = deferred<GateInfo>(); calls.push(d); return d.promise; });
  return { calls, spy };
}

let n = 0;
/** A fresh run id per test: the read bookkeeping is per run and lives for the module. */
const fresh = (tag: string): string => `r-f31-${tag}-${++n}`;

beforeEach(() => {
  useGateStore.setState({ gates: {}, approaching: {} });
  useGateActionStore.setState({ byGate: {} });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('a waiting run’s thread reads its own gate', () => {
  const RUN = 'r-f31-plan';

  beforeEach(() => {
    useRunEventStore.setState((s) => ({ byRun: { ...s.byRun, [RUN]: [] } }));
    useGateActionStore.setState({ byGate: { [RUN]: IDLE_GATE_ACTION } });
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ rows: [], units: [] } as never);
    vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [] } as never);
    vi.spyOn(client.api, 'getRunDiff').mockResolvedValue({ diff: '', truncated: false } as never);
    vi.spyOn(client.api, 'getWatch').mockResolvedValue({ coverage: [] } as never);
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] } as never);
    vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] } as never);
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] } as never);
  });

  it('with no gate cached (a reload), the plan card shows after the thread mounts, from one GET /runs/:id/gate', async () => {
    const getGate = vi.spyOn(client.api, 'getGate').mockResolvedValue(planInfo(RUN));
    render(<RunBlock view={makeView({ id: RUN, status: 'awaiting_human', problem: 'fix the sum bug' })} badge={1} sessionId={`run:${RUN}`} />);
    await waitFor(() => expect(screen.queryByTestId('session-proposal')).not.toBeNull());
    expect(screen.getAllByTestId('session-proposal-option').length).toBeGreaterThan(0);
    expect(getGate).toHaveBeenCalledTimes(1);
    expect(getGate).toHaveBeenCalledWith(RUN, expect.any(AbortSignal));
  });

  it('a run with its gate cached, or not waiting, reads nothing', async () => {
    const getGate = vi.spyOn(client.api, 'getGate').mockResolvedValue(planInfo(RUN));
    useGateStore.getState().setGate(openGate(RUN));
    const { unmount } = render(<RunBlock view={makeView({ id: RUN, status: 'awaiting_human', problem: 'x' })} badge={1} sessionId={`run:${RUN}`} />);
    unmount();
    useGateStore.setState({ gates: {}, approaching: {} });
    render(<RunBlock view={makeView({ id: RUN, status: 'executing', problem: 'x' })} badge={0} sessionId={`run:${RUN}`} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(getGate).not.toHaveBeenCalled();
  });
});

describe('a gate read that overlapped a newer write is dropped', () => {
  it('an answer sent while the read was on its way: the answered gate is not brought back', async () => {
    const RUN = fresh('answer');
    const { calls } = heldGetGate();
    useGateStore.getState().setGate(openGate(RUN));
    const read = refreshGate(RUN);
    useGateStore.getState().clearGate(RUN); // the decision path prunes the answered gate
    calls[0]!.resolve(planInfo(RUN));
    await read;
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
  });

  it('the run moved on by a live frame (no gate cached): the late read does not open the old gate', async () => {
    const RUN = fresh('resumed');
    const { calls } = heldGetGate();
    const read = ensureGate(RUN);
    useGateStore.getState().ingest({ type: 'resumed', session: RUN } as unknown as CoreEvent);
    calls[0]!.resolve(planInfo(RUN));
    await read;
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
  });

  it('a gateDecided frame (answered in another tab) drops the read on its way', async () => {
    const RUN = fresh('decided');
    const { calls } = heldGetGate();
    const read = ensureGate(RUN);
    useGateStore.getState().ingest({ type: 'gateDecided', session: RUN, ord: 2 } as unknown as CoreEvent);
    calls[0]!.resolve(planInfo(RUN));
    await read;
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
  });

  it('a newer gate from a live frame is kept: neither the older read nor its 404 replaces or clears it', async () => {
    const RUN = fresh('newer');
    const { calls } = heldGetGate();
    const read = refreshGate(RUN);
    useGateStore.getState().ingest({ type: 'awaitingHuman', session: RUN, ord: 5, prompt: 'Approve the hand-over', gateKind: 'deliver' } as unknown as CoreEvent);
    calls[0]!.reject(new ApiError(404, 'no open gate'));
    await read;
    expect(useGateStore.getState().gates[RUN]).toMatchObject({ ord: 5, gateKind: 'deliver' });
  });

  it('a prune by the runs list drops the read, with a gate cached or none (a reload)', async () => {
    const cachedRun = fresh('prune-cached');
    const emptyRun = fresh('prune-empty');
    const { calls } = heldGetGate();
    useGateStore.getState().setGate(openGate(cachedRun));
    const a = refreshGate(cachedRun);
    const b = ensureGate(emptyRun);
    useGateStore.getState().reconcile([]); // neither run waits any more
    calls[0]!.resolve(planInfo(cachedRun));
    calls[1]!.resolve(planInfo(emptyRun));
    await Promise.all([a, b]);
    expect(useGateStore.getState().gates[cachedRun]).toBeUndefined();
    expect(useGateStore.getState().gates[emptyRun]).toBeUndefined();
  });

  it('of two reads the later one wins, whichever lands first (a 409 refresh racing the hydration read)', async () => {
    for (const order of ['older-first', 'newer-first'] as const) {
      const RUN = fresh(order);
      const { calls } = heldGetGate();
      const hydrate = ensureGate(RUN);
      const forced = refreshGate(RUN);
      expect(calls).toHaveLength(2);
      const [older, newer] = [calls[0]!, calls[1]!];
      if (order === 'older-first') { older.resolve(planInfo(RUN, 2)); await hydrate; newer.resolve(planInfo(RUN, 3)); await forced; }
      else { newer.resolve(planInfo(RUN, 3)); await forced; older.resolve(planInfo(RUN, 2)); await hydrate; }
      expect(useGateStore.getState().gates[RUN], order).toMatchObject({ ord: 3 });
      vi.restoreAllMocks();
    }
  });
});

describe('one read per run, no re-read storm', () => {
  it('callers at one generation share the read on its way; a cached gate is not read again', async () => {
    const RUN = fresh('dedupe');
    const { calls, spy } = heldGetGate();
    const a = ensureGate(RUN);
    const b = ensureGate(RUN);
    expect(spy).toHaveBeenCalledTimes(1);
    calls[0]!.resolve(planInfo(RUN));
    await Promise.all([a, b]);
    expect(useGateStore.getState().gates[RUN]).toMatchObject({ ord: 2, gateKind: 'plan_approval' });
    await ensureGate(RUN);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('a caller after the run’s gate moved does not join the obsolete read: it gets a fresh one that lands', async () => {
    const RUN = fresh('obsolete');
    const { calls, spy } = heldGetGate();
    const first = ensureGate(RUN);
    useGateStore.getState().ingest({ type: 'resumed', session: RUN } as unknown as CoreEvent);
    const second = ensureGate(RUN); // e.g. a reconnect pass: the run parked again meanwhile
    expect(spy).toHaveBeenCalledTimes(2);
    calls[0]!.resolve(planInfo(RUN, 2));
    calls[1]!.resolve(planInfo(RUN, 6));
    await Promise.all([first, second]);
    expect(useGateStore.getState().gates[RUN]).toMatchObject({ ord: 6 });
  });

  it('a failed read (network) is tried again by the next caller', async () => {
    const RUN = fresh('neterr');
    const spy = vi.spyOn(client.api, 'getGate').mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValueOnce(planInfo(RUN));
    await ensureGate(RUN);
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
    await ensureGate(RUN);
    expect(spy).toHaveBeenCalledTimes(2);
    expect(useGateStore.getState().gates[RUN]).toMatchObject({ ord: 2 });
  });

  it('a reconnect makes every read begun before it obsolete: not applied, not joined', async () => {
    const RUN = fresh('reconnect');
    const { calls, spy } = heldGetGate();
    const before = ensureGate(RUN);
    invalidateGateReads();
    const after = ensureGate(RUN);
    expect(spy).toHaveBeenCalledTimes(2);
    calls[0]!.resolve(planInfo(RUN, 2)); // answered for a state a missed frame may have moved past
    await before;
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
    calls[1]!.resolve(planInfo(RUN, 7));
    await after;
    expect(useGateStore.getState().gates[RUN]).toMatchObject({ ord: 7 });
  });

  it('a hung read ends at its deadline: nothing applied, and the next caller reads again', async () => {
    const RUN = fresh('hung');
    vi.useFakeTimers();
    try {
      const signals: AbortSignal[] = [];
      const spy = vi.spyOn(client.api, 'getGate').mockImplementation((_id: string, signal?: AbortSignal) => new Promise<GateInfo>((_res, rej) => {
        signals.push(signal!);
        signal!.addEventListener('abort', () => rej(signal!.reason));
      }));
      const first = ensureGate(RUN);
      expect(signals[0]).toBeInstanceOf(AbortSignal);
      await vi.advanceTimersByTimeAsync(GATE_READ_DEADLINE_MS + 1);
      await first;
      expect(signals[0]!.aborted).toBe(true);
      expect(useGateStore.getState().gates[RUN]).toBeUndefined();
      void ensureGate(RUN);
      expect(spy).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(GATE_READ_DEADLINE_MS + 1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('the runs list’s late-join pass', () => {
  it('orders waiting runs newest first; a run with no created_at goes last', () => {
    const views = [
      makeView({ id: 'old', created_at: 100 } as never),
      makeView({ id: 'none', created_at: undefined } as never),
      makeView({ id: 'new', created_at: 300 } as never),
      makeView({ id: 'mid', created_at: 200 } as never),
    ];
    expect(newestFirst(views)).toStrictEqual(['new', 'mid', 'old', 'none']);
  });

  it('the shared slots keep at most GATE_READS_IN_FLIGHT on their way across callers, first in first served', async () => {
    let open = 0;
    let peak = 0;
    const started: number[] = [];
    const gates = Array.from({ length: 9 }, () => deferred<void>());
    const all = gates.map((g, i) => inGateSlot(async () => { started.push(i); open += 1; peak = Math.max(peak, open); await g.promise; open -= 1; }));
    await new Promise((r) => setTimeout(r, 0));
    expect(started).toStrictEqual([0, 1, 2, 3]);
    for (const g of gates) { g.resolve(); await new Promise((r) => setTimeout(r, 0)); }
    await Promise.all(all);
    expect(started).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(peak).toBe(GATE_READS_IN_FLIGHT);
  });

  it('a slot is held until its read ends, and a hung gate read ends at its deadline', async () => {
    vi.useFakeTimers();
    try {
      let open = 0;
      vi.spyOn(client.api, 'getGate').mockImplementation((_id: string, signal?: AbortSignal) => new Promise<GateInfo>((_res, rej) => {
        open += 1;
        signal!.addEventListener('abort', () => { open -= 1; rej(signal!.reason); });
      }));
      const hung = Array.from({ length: GATE_READS_IN_FLIGHT }, () => inGateSlot(() => ensureGate(fresh('slot'))));
      let ran = false;
      const next = inGateSlot(async () => { ran = true; });
      await vi.advanceTimersByTimeAsync(GATE_READ_DEADLINE_MS - 1);
      expect(ran).toBe(false); // every slot is still held by a request on its way
      expect(open).toBe(GATE_READS_IN_FLIGHT);
      await vi.advanceTimersByTimeAsync(2);
      await next;
      expect(ran).toBe(true);
      expect(open).toBe(0); // the hung requests were ended, not merely stopped waiting for
      await Promise.all(hung);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads the newest parked runs first, at most GATE_READS_IN_FLIGHT at once even when a refresh replaces the pass, and every gate lands', async () => {
    // The daemon lists the oldest first, as the rig did (98 parked; the run just launched was last).
    let views: SessionView[] = Array.from({ length: 10 }, (_, i) =>
      makeView({ id: `p${i + 1}`, status: 'awaiting_human', created_at: 1_000 + i } as never));
    const pending = new Map<string, () => void>();
    const asked: string[] = [];
    let open = 0;
    let peak = 0;
    useConnectionStore.setState({ status: 'connected' } as never);
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (path === '/runs') return ok({ runs: views });
      const m = /^\/runs\/([^/]+)\/gate$/.exec(path);
      if (m !== null) {
        const id = m[1]!;
        asked.push(id);
        open += 1; peak = Math.max(peak, open);
        return new Promise<Response>((res) => {
          pending.set(id, () => { open -= 1; res(okSync(planInfo(id))); });
        });
      }
      return Promise.resolve(new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } }));
    }));
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(asked.length).toBe(GATE_READS_IN_FLIGHT));
    expect(asked).toStrictEqual(['p10', 'p9', 'p8', 'p7']);
    // Four more runs park and a refresh replaces the pass while the first four reads are still on their way.
    views = [...views, ...Array.from({ length: 4 }, (_, i) => makeView({ id: `q${i + 1}`, status: 'awaiting_human', created_at: 2_000 + i } as never))];
    act(() => { result.current.refresh(); });
    await new Promise((r) => setTimeout(r, 600));
    expect(asked).toHaveLength(GATE_READS_IN_FLIGHT);
    // Settle reads as they come until every run's gate is in.
    await waitFor(() => {
      for (const [id, settle] of [...pending]) { pending.delete(id); settle(); }
      expect(Object.keys(useGateStore.getState().gates).length).toBe(14);
    }, { timeout: 4000 });
    expect(peak).toBe(GATE_READS_IN_FLIGHT);
    expect(asked).toHaveLength(14); // no run read twice
  });
});

function okSync(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function ok(body: unknown): Promise<Response> {
  return Promise.resolve(okSync(body));
}
