import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DES-CATALOG-002 §2.7.6: a run launched from a chat proposal takes a plan answer only with the plan revision the person
 * was shown — on every path, not only the passage: the command palette's Approve gate (`decideGate`), the session
 * sheet's plan card (`commitGateDecision`) and batch approval (`runBatchDecision`). Unknown → refused unsent.
 */

const { decideGate, commitGateDecision } = await import('../src/board/gateActions.js');
const { runBatchDecision, toggleBatchSelect, useBatchGateStore } = await import('../src/board/batchGates.js');
const { flushDecisionsForTest, resetDecisionsForTest, useUndoQueue } = await import('../src/board/undoQueue.js');
const { useGateStore } = await import('../src/store/gates.js');
const { usePlanGateStore } = await import('../src/store/planGates.js');
const { markProposalRunForTest, seenPlanRev } = await import('../src/board/planRevBinding.js');

const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
const ok = (b: unknown): Response => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } });
const gate = (runId: string, prompt: string, gateKind?: string): void => useGateStore.setState((s) => ({
  gates: { ...s.gates, [runId]: { runId, ord: 1, prompt, lifecycle: 'open', receivedAt: 5, ...(gateKind !== undefined ? { gateKind } : {}) } },
}));

beforeEach(() => {
  posts.length = 0;
  resetDecisionsForTest();
  useGateStore.setState({ gates: {}, approaching: {} });
  usePlanGateStore.setState({ byRun: {}, readFor: {} });
  useBatchGateStore.setState({ selected: [], running: false, queued: false, done: 0, total: 0, failures: [], lastDecision: null });
  markProposalRunForTest('r-job');
  markProposalRunForTest('r-plain', false);
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') { posts.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> }); return Promise.resolve(ok({ status: 'ok' })); }
    if (path.endsWith('/team')) return Promise.resolve(new Response('{}', { status: 500 }));
    return Promise.resolve(ok({}));
  }));
});
afterEach(() => { vi.unstubAllGlobals(); resetDecisionsForTest(); });

describe('planRev on every approve path', () => {
  it('the palette’s Approve gate names the revision the gate showed', async () => {
    gate('r-job', 'Approve plan rev 3 before unit 2 runs: build → review', 'plan_approval');
    void decideGate('r-job', { approve: true });
    await flushDecisionsForTest();
    expect(posts).toEqual([{ path: '/runs/r-job/gate', body: { approve: true, planRev: 3, ord: 1 } }]);
  });

  it('the sheet’s plan card names the plan read for this gate when the prompt doesn’t', async () => {
    gate('r-job', 'Approve the plan', 'plan_approval');
    usePlanGateStore.setState({ byRun: { 'r-job': { gateId: 'g', ord: 1, planRev: 4, band: '', highRisk: false, reason: '', score: null, reasons: [], floorAdded: [], editSeed: [], planSteps: [] } }, readFor: { 'r-job': '1:5' } });
    void commitGateDecision('r-job', { approve: false, action: 'request_changes', amend: 'add a rollback' } as never);
    await flushDecisionsForTest();
    expect(posts[0]?.body).toMatchObject({ action: 'request_changes', planRev: 4, ord: 1 });
  });

  it('a plan whose version wasn’t read here is refused unsent, said', async () => {
    gate('r-job', 'Approve the plan', 'plan_approval');
    const outcome = await commitGateDecision('r-job', { approve: true });
    expect(outcome).toBe('cancelled');
    await flushDecisionsForTest();
    expect(posts).toEqual([]);
    expect(useUndoQueue.getState().results.at(-1)?.text).toMatch(/plan hasn’t been read here/);
  });

  it('a run not launched from a proposal, a plain reject and another gate kind are unchanged', () => {
    gate('r-plain', 'Approve plan rev 3 before unit 2 runs', 'plan_approval');
    expect(seenPlanRev('r-plain', { approve: true })).toBeUndefined();
    gate('r-job', 'Approve plan rev 3', 'plan_approval');
    expect(seenPlanRev('r-job', { approve: false })).toBeUndefined();
    gate('r-job', 'Cut over?', 'run_level');
    expect(seenPlanRev('r-job', { approve: true })).toBeUndefined();
  });

  it('batch approval binds each job’s plan to its revision and leaves out one it can’t name', async () => {
    gate('r-job', 'Approve plan rev 2 before unit 2 runs', 'plan_approval');
    gate('r-job2', 'Approve the plan', 'plan_approval');
    markProposalRunForTest('r-job2');
    toggleBatchSelect('r-job');
    toggleBatchSelect('r-job2');
    const done = runBatchDecision({ approve: true });
    await flushDecisionsForTest();
    await done;
    expect(posts).toEqual([{ path: '/runs/r-job/gate', body: { approve: true, planRev: 2, ord: 1 } }]);
  });
});
