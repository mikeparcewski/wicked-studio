/**
 * F31 (e2e-1105, rig :7721): after a reload, a chat-launched run's plan card came ~28 s late. The late-join pass read
 * `GET /runs/:id/gate` one run at a time, oldest first, over every parked run (98 on the rig), and the run's own
 * thread never read its gate. These pin:
 *  - a waiting run's thread reads its own gate when it opens, so the plan card shows without the runs list's pass;
 *  - the pass reads newest first, a few at a time;
 *  - a gate read that overlapped an answer, a live frame or a prune never brings the old gate back;
 *  - one read per run while it is on its way.
 */
import { cleanup, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import type { CoreEvent, GateInfo, SessionView } from '../src/api/types.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { IDLE_GATE_ACTION, ensureGate, refreshGate, useGateActionStore } from '../src/board/gateActions.js';
import { RunBlock } from '../src/components/session/RunConversation.js';
import { GATE_READS_IN_FLIGHT, eachLimited, newestFirst, useRuns } from '../src/hooks/useRuns.js';
import { useConnectionStore } from '../src/store/connection.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { makeView } from './factories.js';

const NOW = 1_700_000_000_000;

function planInfo(runId: string, ord = 2): GateInfo {
  return {
    runId, ord, lifecycle: 'open', receivedAt: new Date(NOW).toISOString(), gateKind: 'plan_approval',
    prompt: `Approve plan rev 2 before unit ${ord} runs (manual mode; band 20-39; manual mode): pa-scope → fix → review → deliver. Approve, approve with an edited plan, or reject.`,
  } as GateInfo;
}

/** A promise the test settles by hand. */
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

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
    expect(getGate).toHaveBeenCalledWith(RUN);
  });

  it('a run with its gate cached, or not waiting, reads nothing', async () => {
    const getGate = vi.spyOn(client.api, 'getGate').mockResolvedValue(planInfo(RUN));
    useGateStore.getState().setGate({ runId: RUN, ord: 2, prompt: planInfo(RUN).prompt, lifecycle: 'open', receivedAt: NOW, gateKind: 'plan_approval' });
    const { unmount } = render(<RunBlock view={makeView({ id: RUN, status: 'awaiting_human', problem: 'x' })} badge={1} sessionId={`run:${RUN}`} />);
    unmount();
    useGateStore.setState({ gates: {}, approaching: {} });
    render(<RunBlock view={makeView({ id: RUN, status: 'executing', problem: 'x' })} badge={0} sessionId={`run:${RUN}`} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(getGate).not.toHaveBeenCalled();
  });
});

describe('a gate read that overlapped a newer write is dropped', () => {
  const RUN = 'r-f31-cas';

  it('an answer sent while the read was on its way: the answered gate is not brought back', async () => {
    const d = deferred<GateInfo>();
    vi.spyOn(client.api, 'getGate').mockReturnValue(d.promise);
    useGateStore.getState().setGate({ runId: RUN, ord: 2, prompt: 'Approve plan rev 2', lifecycle: 'open', receivedAt: NOW, gateKind: 'plan_approval' });
    const read = refreshGate(RUN);
    useGateStore.getState().clearGate(RUN); // the decision path prunes the answered gate
    d.resolve(planInfo(RUN));
    await read;
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
  });

  it('the run moved on by a live frame (no gate cached): the late read does not open the old gate', async () => {
    const d = deferred<GateInfo>();
    vi.spyOn(client.api, 'getGate').mockReturnValue(d.promise);
    const read = ensureGate(RUN);
    useGateStore.getState().ingest({ type: 'resumed', session: RUN } as unknown as CoreEvent);
    d.resolve(planInfo(RUN));
    await read;
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
  });

  it('a newer gate from a live frame is kept: neither the older read nor its 404 replaces or clears it', async () => {
    const d = deferred<GateInfo>();
    vi.spyOn(client.api, 'getGate').mockReturnValue(d.promise);
    const read = refreshGate(RUN);
    useGateStore.getState().ingest({ type: 'awaitingHuman', session: RUN, ord: 5, prompt: 'Approve the hand-over', gateKind: 'deliver' } as unknown as CoreEvent);
    d.reject(new ApiError(404, 'no open gate'));
    await read;
    expect(useGateStore.getState().gates[RUN]).toMatchObject({ ord: 5, gateKind: 'deliver' });
  });

  it('a prune by the runs list (the run no longer waits) also drops the read', async () => {
    const d = deferred<GateInfo>();
    vi.spyOn(client.api, 'getGate').mockReturnValue(d.promise);
    useGateStore.getState().setGate({ runId: RUN, ord: 2, prompt: 'Approve plan rev 2', lifecycle: 'open', receivedAt: NOW, gateKind: 'plan_approval' });
    const read = refreshGate(RUN);
    useGateStore.getState().reconcile([]);
    d.resolve(planInfo(RUN));
    await read;
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
  });

  it('a read nothing overlapped applies, and one read per run is on its way at a time', async () => {
    const d = deferred<GateInfo>();
    const getGate = vi.spyOn(client.api, 'getGate').mockReturnValue(d.promise);
    const a = ensureGate(RUN);
    const b = ensureGate(RUN);
    expect(getGate).toHaveBeenCalledTimes(1);
    d.resolve(planInfo(RUN));
    await Promise.all([a, b]);
    expect(useGateStore.getState().gates[RUN]).toMatchObject({ ord: 2, gateKind: 'plan_approval' });
    await ensureGate(RUN); // cached now: no second read
    expect(getGate).toHaveBeenCalledTimes(1);
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

  it('eachLimited keeps at most `limit` on their way, in order', async () => {
    let open = 0;
    let peak = 0;
    const seen: number[] = [];
    await eachLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      seen.push(n);
      open += 1; peak = Math.max(peak, open);
      await new Promise((r) => setTimeout(r, 2));
      open -= 1;
    });
    expect(seen).toStrictEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(peak).toBe(3);
  });

  it('reads the newest parked runs first, GATE_READS_IN_FLIGHT at a time, and every gate lands', async () => {
    // The daemon lists the oldest first, as the rig did (98 parked; the run just launched was last).
    const N = 10;
    const views: SessionView[] = Array.from({ length: N }, (_, i) =>
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
    renderHook(() => useRuns());
    await waitFor(() => expect(asked.length).toBe(GATE_READS_IN_FLIGHT));
    expect(asked).toStrictEqual(['p10', 'p9', 'p8', 'p7']);
    // Settle reads as they come until every run's gate is in.
    await waitFor(() => {
      for (const [id, settle] of [...pending]) { pending.delete(id); settle(); }
      expect(Object.keys(useGateStore.getState().gates).length).toBe(N);
    });
    expect(asked).toStrictEqual(['p10', 'p9', 'p8', 'p7', 'p6', 'p5', 'p4', 'p3', 'p2', 'p1']);
    expect(peak).toBe(GATE_READS_IN_FLIGHT);
  });
});

function okSync(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
}
function ok(body: unknown): Promise<Response> {
  return Promise.resolve(okSync(body));
}
