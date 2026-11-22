import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * ASK-S1 × a slow `/health` (codex r4 #1): the runs list can land before the capabilities do. When
 * `askPath` arrives, the list already in hand is classified and a gate cached meanwhile — the ask's
 * turn gate, drawn until then — is reclassified and recorded, so an idle late join does not keep the
 * approval card and the Desk's gate row for a question that is answered by typing.
 */

const { useRuns } = await import('../src/hooks/useRuns.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useConnectionStore } = await import('../src/store/connection.js');
const { makeUnit, makeView } = await import('./factories.js');

const RUN = 'r-ask-late';
const VIEW = makeView({ id: RUN, status: 'awaiting_human', problem: 'why no trim?', unit_ix: 0, chat_id: 'chat-late' } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'done', assigned_cli: 'claude', description: 'answer-1 — why no trim?' }),
]);

beforeEach(() => {
  useCapabilities.setState({ loaded: false, askPath: false });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useConnectionStore.setState({ status: 'connected' } as never);
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (path === '/runs') return ok({ runs: [VIEW] });
    if (path === `/runs/${RUN}/gate`) return ok({ runId: RUN, ord: 1, prompt: 'Approve the output of unit 1 (answer-1) — the plan is complete.', lifecycle: 'open', receivedAt: new Date(1_700_000_000_000).toISOString() });
    if (path.endsWith('/elicitations')) return ok({ elicitations: [] });
    return ok({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

describe('the capability lands after the runs list', () => {
  it('until then the gate is drawn; when askPath arrives the run is classified and the cached turn gate is recorded, not drawn', async () => {
    const { result } = renderHook(() => useRuns());
    await waitFor(() => expect(result.current.loaded).toBe(true));
    await waitFor(() => expect(useGateStore.getState().gates[RUN]).toMatchObject({ ord: 1 }));
    expect(useAskThreadStore.getState().runs.has(RUN)).toBe(false);
    act(() => { useCapabilities.setState({ loaded: true, askPath: true }); });
    await waitFor(() => expect(useAskThreadStore.getState().runs.has(RUN)).toBe(true));
    await waitFor(() => expect(useGateStore.getState().gates[RUN]).toBeUndefined());
    expect(useAskThreadStore.getState().turnGates[RUN]).toMatchObject({ ord: 1 });
    expect(useAskThreadStore.getState().answerOrds[RUN]).toStrictEqual([1]);
  });
});
