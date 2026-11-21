import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import type { GateInfo, SessionView } from '../src/api/types.js';
import { GATE_READS_IN_FLIGHT, inGateSlot, reconcileGateRetries, resetGateSlotsForTest, useGateActionStore, useGateReadStore } from '../src/board/gateActions.js';
import { foldJobLineages } from '../src/board/jobStream.js';
import { flushDecisionsForTest, queueDecision, resetDecisionsForTest, setUndoWindowForTest, useUndoQueue } from '../src/board/undoQueue.js';
import { JobPassage } from '../src/components/session/JobPassage.js';
import { resetGateActionReadsForTest } from '../src/hooks/useGateActions.js';
import { resetJobLocal } from '../src/hooks/useJobStream.js';
import { useRuns } from '../src/hooks/useRuns.js';
import { useAskThreadStore } from '../src/store/askThread.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useConnectionStore } from '../src/store/connection.js';
import { useElicitationStore } from '../src/store/elicitations.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { usePlanGateStore } from '../src/store/planGates.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import { useTeamPlanStore } from '../src/store/teamPlan.js';
import { makeUnit, makeView } from './factories.js';
import { CHAT, jobProposal } from './jobFixtures.js';

const pending: Array<() => void> = [];
let serial = 0;
const fresh = () => `t20-${++serial}`;
const actions = [
  { action: 'approve', intent: 'complete', note: 'optional' },
  { action: 'amend_intent', intent: 'amend_intent', note: 'required' },
  { action: 'reject', intent: 'stop', note: 'none' },
] as const;
function terminal(run: SessionView): GateInfo {
  const last = run.units.at(-1)!;
  return {
    runId: run.session.id, ord: last.ord, lifecycle: 'open', receivedAt: new Date(7).toISOString(), gateKind: 'terminal',
    prompt: `Approve completion after the final phase (unit ${last.ord}): ${last.phase_ref} — the plan is complete.`,
    actions: [...actions],
  } as GateInfo;
}
function job(kind: 'demo' | 'feature' = 'demo'): SessionView {
  const id = fresh();
  const steps = kind === 'demo' ? ['pa-scope', 'probe', 'plan', 'record', 'review'] : ['scope', 'build', 'review'];
  return makeView({ id, workflow_id: kind, status: 'awaiting_human', unit_ix: steps.length - 1, chat_id: CHAT } as never,
    steps.map((step, i) => makeUnit({ id: `${id}:u${i + 1}`, session_id: id, ord: i + 1, phase_ref: step, description: step, status: 'done' })));
}
function passage(run: SessionView): void {
  const p = jobProposal();
  const lineage = foldJobLineages([
    { kind: 'proposal', at: 1, turnId: 't1', proposal: p },
    { kind: 'proposal_decided', at: 2, turnId: 't1', pid: p.pid, decision: 'go', result: { runId: run.session.id, artifactRef: null, adopted: false, stub: false } },
  ])[0]!;
  render(<JobPassage chatId={CHAT} lineage={lineage} runs={[run]} sessionId={CHAT} say={() => {}} onChanged={() => {}} />);
}

beforeEach(() => {
  resetJobLocal();
  resetGateActionReadsForTest();
  useGateStore.setState({ gates: {}, approaching: {} });
  useGateReadStore.setState({ failed: {} });
  useGateActionStore.setState({ byGate: {} });
  usePlanGateStore.setState({ byRun: {}, readFor: {} });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useRunEventStore.setState({ byRun: {} });
  useElicitationStore.setState({ elicitations: {}, generations: {} });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, chatClosed: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: {} });
  useCapabilities.setState({ loaded: true, gateActions: true, askPath: true, chatJobProposals: true });
  useConnectionStore.setState({ status: 'connected' } as never);
  setCachedRoster([]);
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] } as never);
  vi.spyOn(api, 'getRunEvents').mockResolvedValue({ events: [] } as never);
  vi.spyOn(api, 'getElicitation').mockResolvedValue(null);
  vi.spyOn(api, 'getRoster').mockResolvedValue({ roster: [] } as never);
  vi.spyOn(api, 'listWorkflows').mockResolvedValue({ workflows: [] } as never);
  vi.spyOn(api, 'listRepos').mockResolvedValue({ repos: [] } as never);
});
afterEach(async () => {
  cleanup();
  resetDecisionsForTest();
  await act(async () => { for (const settle of pending.splice(0)) settle(); });
  reconcileGateRetries([]);
  resetGateSlotsForTest();
  vi.restoreAllMocks();
});

describe('terminal gates in the job passage', () => {
  for (const kind of ['demo', 'feature'] as const) {
    it(`${kind}: reads its own terminal gate without waiting for the late-join slots and draws Approve completion`, async () => {
      // Every background slot is held by a slow read of another run.
      const background = Array.from({ length: GATE_READS_IN_FLIGHT }, () => inGateSlot(() => new Promise<void>((resolve) => { pending.push(resolve); })));
      const run = job(kind);
      const getGate = vi.spyOn(api, 'getGate').mockResolvedValue(terminal(run));
      passage(run);
      await waitFor(() => expect(getGate).toHaveBeenCalledWith(run.session.id, expect.any(AbortSignal)));
      expect(await screen.findByRole('button', { name: 'Approve completion' })).toBeTruthy();
      expect(getGate).toHaveBeenCalledTimes(1);
      await act(async () => { for (const settle of pending.splice(0)) settle(); await Promise.all(background); });
    });
  }

  it('says Reading the question while a gate read is still on its way, then replaces it with the card', async () => {
    const run = job();
    vi.spyOn(api, 'getGate').mockImplementation(() => new Promise<GateInfo>((resolve) => { pending.push(() => resolve(terminal(run))); }));
    passage(run);
    expect((await screen.findByTestId('job-passage-gate-reading')).textContent).toBe('Reading the question…');
    expect(screen.queryByTestId('job-passage-gate-unread')).toBeNull();
    await act(async () => { for (const settle of pending.splice(0)) settle(); });
    expect(await screen.findByRole('button', { name: 'Approve completion' })).toBeTruthy();
    expect(screen.queryByTestId('job-passage-gate-reading')).toBeNull();
  });

  it('a failed read shows an alert with Retry, which reads the gate and replaces the alert', async () => {
    const run = job();
    const getGate = vi.spyOn(api, 'getGate').mockRejectedValueOnce(new TypeError('fetch failed')).mockResolvedValue(terminal(run));
    passage(run);
    const alert = await screen.findByTestId('job-passage-gate-unread');
    expect(alert.getAttribute('role')).toBe('alert');
    expect(alert.textContent).toContain('The question hasn’t loaded yet (the daemon is slow); it is trying again.');
    expect(screen.queryByTestId('job-passage-gate-reading')).toBeNull();
    fireEvent.click(within(alert).getByTestId('job-passage-gate-retry'));
    await waitFor(() => expect(getGate).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole('button', { name: 'Approve completion' })).toBeTruthy();
    expect(screen.queryByTestId('job-passage-gate-unread')).toBeNull();
  });

  it('keeps the gate passage when a queued batch covers a run whose gate is cleared', async () => {
    const run = job();
    const other = fresh();
    const info = terminal(run);
    setUndoWindowForTest(null);
    useGateStore.getState().setGate({ ...info, receivedAt: 7, actionsRead: true });
    passage(run);
    await screen.findByRole('button', { name: 'Approve completion' });
    // A batch queue can cover the run without the single-gate watcher owning its decision.
    await act(async () => {
      queueDecision({ verb: 'approve', runIds: [run.session.id, other], keys: [`gate:${run.session.id}`, `gate:${other}`], preview: 'Approve completion', commit: vi.fn() });
      useGateStore.getState().clearGate(run.session.id);
    });
    expect(useUndoQueue.getState().pending).toHaveLength(1);
    expect(screen.queryByTestId('job-passage-gate-reading')).toBeNull();
    expect(screen.getByTestId('job-passage-gate')).toBeTruthy();
  });

  it('keeps the passage through the undo window, sending and the receipt before the runs refresh', async () => {
    const run = job();
    const info = terminal(run);
    setUndoWindowForTest(null);
    useGateStore.getState().setGate({ ...info, receivedAt: 7, actionsRead: true });
    const confirmGate = vi.spyOn(api, 'confirmGate').mockImplementation(() => new Promise((resolve) => { pending.push(() => resolve({ status: 'ok' })); }));
    passage(run);
    fireEvent.click(await screen.findByRole('button', { name: 'Approve completion' }));
    expect(useUndoQueue.getState().pending).toHaveLength(1);
    expect(within(screen.getByTestId('job-passage-gate')).getByRole('button', { name: 'Undo' })).toBeTruthy();
    expect(confirmGate).not.toHaveBeenCalled();

    let sending: Promise<void>;
    act(() => { sending = flushDecisionsForTest(); });
    expect(confirmGate).toHaveBeenCalledTimes(1);
    act(() => { useGateStore.getState().clearGate(run.session.id); });
    expect(screen.queryByTestId('job-passage-gate-reading')).toBeNull();
    expect(screen.getByTestId('job-passage-gate')).toBeTruthy();

    await act(async () => {
      for (const settle of pending.splice(0)) settle();
      await sending;
    });
    expect(screen.queryByTestId('job-passage-gate-reading')).toBeNull();
    expect(within(screen.getByTestId('job-passage-gate')).getByTestId('session-gate-chosen').textContent).toContain('You chose: Approve completion');
  });

  it('numbers a waiting step by its position: ord 5 in a five-step demo is 5 Review', async () => {
    const run = job();
    const info = terminal(run);
    useGateStore.getState().setGate({ ...info, receivedAt: 7, actionsRead: true });
    passage(run);
    const now = await screen.findByTestId('job-passage-now');
    expect(now.querySelector('.n')?.textContent).toBe('5');
    expect(within(now).getByText('Review')).toBeTruthy();
  });
});

it('the late-join pass reads real decisions before parked chat turns, and still records both turn gates', async () => {
  const asks = [fresh(), fresh()].map((id) => makeView({ id, status: 'awaiting_human', unit_ix: 0, chat_id: `chat-${id}`, ask_turn: true } as never,
    [makeUnit({ id: `${id}:u1`, session_id: id, ord: 1, phase_ref: 'answer-1', description: 'answer-1 — hello', status: 'done' })]));
  const real = job('feature');
  vi.spyOn(api, 'listRuns').mockResolvedValue({ runs: [...asks, real] });
  const byId = new Map([...asks, real].map((r) => [r.session.id, r]));
  const getGate = vi.spyOn(api, 'getGate').mockImplementation(async (id) => terminal(byId.get(id)!));
  renderHook(() => useRuns());
  await waitFor(() => expect(getGate).toHaveBeenCalledTimes(3));
  expect(getGate.mock.calls.map(([id]) => id)).toEqual([real.session.id, ...asks.map((r) => r.session.id)]);
  await waitFor(() => {
    for (const ask of asks) {
      expect(useAskThreadStore.getState().turnGates[ask.session.id]).toMatchObject({ ord: 1 });
      expect(useGateStore.getState().gates[ask.session.id]).toBeUndefined();
    }
  });
  expect(useGateStore.getState().gates[real.session.id]).toMatchObject({ gateKind: 'terminal' });
});
