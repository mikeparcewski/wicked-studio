import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import certLog from './fixtures/j6-t17-past-plan-1485.json';

/**
 * studio#1485 (part 1): a job whose run the engine took past its plan gate never reads "planning".
 *
 * The record is train-17 cert J6 v3 run B, the run's own events as GET /runs/:id/events served them, cut at the cert's
 * shot (tests/fixtures/j6-t17-past-plan-1485.json). The plan gate (`awaitingHuman` plan_approval ord 1) was answered
 * (`resumed`) and unit 1 was dispatched, but the team record held no plan decision, so the card kept saying "planning"
 * 40 minutes after Approve.
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useGateReadStore } = await import('../src/board/gateActions.js');
const { usePlanGateStore } = await import('../src/store/planGates.js');
const { useRunEventStore } = await import('../src/store/events.js');
const { useElicitationStore } = await import('../src/store/elicitations.js');
const { resetGateActionReadsForTest } = await import('../src/hooks/useGateActions.js');
const { resetJobLocal } = await import('../src/hooks/useJobStream.js');
const { resetDecisionsForTest } = await import('../src/board/undoQueue.js');
const { resetRunAcceptanceForTest } = await import('../src/store/runAcceptance.js');
const { makeUnit, makeView } = await import('./factories.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { jobProposal } = await import('./jobFixtures.js');
// A namespace import, so on a build without the reader the page tests still run (and fail on what the card says).
const jobStream = await import('../src/board/jobStream.js') as Record<string, unknown>;
const pastPlanOnLog = (events: readonly unknown[] | null): boolean => (jobStream['pastPlanOnLog'] as (e: readonly unknown[] | null) => boolean)(events);

const CERT = certLog as unknown as { runId: string; events: Array<Record<string, unknown>> };
const RUN = CERT.runId;
const CHAT = 'chat-j';
const T0 = 1_700_000_000_000;
const upTo = (seq: number) => CERT.events.filter((e) => (e['seq'] as number) <= seq);

const USER = { at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'extract the business rules' };
const SEAT = { at: T0 + 1, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, text: 'That is a domain job.' };
const P1 = { at: T0 + 2, turnId: 't1', kind: 'proposal', proposal: jobProposal() };
const decided = { at: T0 + 5, turnId: 't1', kind: 'proposal_decided', pid: `${CHAT}:t1`, decision: 'go', result: { runId: RUN, artifactRef: null, adopted: false, stub: false } };
// The run as the runs index drew it at the shot: executing step 1 (attempt 1), both steps distributed before the gate.
const run = (status = 'executing') => makeView({ id: RUN, status: status as never, unit_ix: 0, chat_id: CHAT, from_proposal: `${CHAT}:t1`, created_at: (T0 + 5) / 1000 } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'distributed', phase_ref: 'domain-run' }),
  makeUnit({ id: `${RUN}:u2`, session_id: RUN, ord: 2, status: 'distributed', phase_ref: 'domain-graph' }),
]);
// A team record that opened the plan gate but holds no decision for it (the cert did not capture the team read; this is
// the shape the card's check reads as "not decided").
const NO_DECISION = {
  teamed: true, units: [], planRev: 1, rows: [
    { event_id: 1, event_type: 'wicked.team.plan.proposed', payload: { steps: [{ id: 'domain-run', catalog: 'domain-run' }, { id: 'domain-graph', catalog: 'domain-graph' }] } },
    { event_id: 2, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g1', ord: 1, plan_rev: 1 } },
  ],
};

let team: () => Response;
let events: (id: string) => Response;
function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

beforeEach(() => {
  team = () => ok(NO_DECISION);
  events = () => ok({ events: CERT.events });
  resetJobLocal();
  resetGateActionReadsForTest();
  resetRunAcceptanceForTest();
  resetDecisionsForTest();
  useElicitationStore.setState({ elicitations: {}, generations: {} });
  useCapabilities.setState({ loaded: true, gateActions: false, runChatId: true, askPath: false, chatProposals: true, chatList: true, chatJobProposals: true, reshapeRun: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, chatClosed: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: {} });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useGateReadStore.setState({ failed: {} });
  usePlanGateStore.setState({ byRun: {}, readFor: {} });
  useRunEventStore.setState({ byRun: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') return Promise.resolve(ok({ view: {} }));
    if (path.startsWith('/chats/') && !path.includes('/considered')) return Promise.resolve(ok({ chatId: CHAT, seats: ['claude'], scope: { kind: 'none' }, messages: [USER, SEAT, P1, decided] }));
    if (path.endsWith('/team')) return Promise.resolve(team());
    const m = /^\/runs\/([^/]+)\/events$/.exec(path);
    if (m !== null) return Promise.resolve(events(decodeURIComponent(m[1]!)));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); resetDecisionsForTest(); resetRunAcceptanceForTest(); });

const page = (runs = [run()]) => render(<SessionPage sessionId={CHAT} runs={runs} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
const eventsRead = (): number => (fetch as unknown as { mock: { calls: Array<[string]> } }).mock.calls.filter(([u]) => /\/runs\/[^/]+\/events/.test(u)).length;

describe('studio#1485: past the engine plan gate is never "planning"', () => {
  it('the cert run (plan gate answered, step 1 dispatched, no decision on the team record) reads running', async () => {
    page();
    const passage = await screen.findByTestId('job-passage');
    await waitFor(() => expect(passage.getAttribute('data-phase')).toBe('running'));
    expect(screen.queryByTestId('job-passage-planning')).toBeNull();
    expect(passage.textContent).not.toContain('planning the real steps');
  });

  it('STALE READ: a log read before the step was dispatched (gate answered, nothing dispatched yet) still reads planning', async () => {
    events = () => ok({ events: upTo(1362) });
    page();
    expect((await screen.findByTestId('job-passage-planning')).textContent).toMatch(/is planning the real steps/);
    await waitFor(() => expect(eventsRead()).toBeGreaterThan(0));
    expect(screen.getByTestId('job-passage').getAttribute('data-phase')).toBe('planning');
  });

  it('IDENTITY: another run’s log (a predecessor version’s run) never decides this run’s plan', async () => {
    // The predecessor's whole log, past its plan gate, is in the shared store under ITS id (the store keeps only frames
    // whose `session` is the run: events.ts hydrate).
    const before = CERT.events.map((e) => ({ ...e, session: 'run-before-reshape' }));
    useRunEventStore.getState().hydrate('run-before-reshape', before as never);
    expect(pastPlanOnLog(useRunEventStore.getState().byRun['run-before-reshape'] ?? null)).toBe(true);
    events = (id) => ok({ events: id === RUN ? upTo(1360) : before });
    page();
    expect((await screen.findByTestId('job-passage-planning')).textContent).toMatch(/is planning/);
    await waitFor(() => expect(eventsRead()).toBeGreaterThan(0));
    expect(screen.getByTestId('job-passage').getAttribute('data-phase')).toBe('planning');
  });

  it('PARTIAL FAILURE: a failed events read is not proof (planning, no throw); a failed team read with the log past the gate reads running', async () => {
    events = () => new Response('{"error":"boom"}', { status: 500 });
    const first = page();
    expect(await screen.findByTestId('job-passage-planning')).not.toBeNull();
    await waitFor(() => expect(eventsRead()).toBeGreaterThan(0));
    expect(screen.getByTestId('job-passage').getAttribute('data-phase')).toBe('planning');
    first.unmount();
    useRunEventStore.setState({ byRun: {} });
    events = () => ok({ events: CERT.events });
    team = () => new Response('{"error":"down"}', { status: 503 });
    page();
    const passage = await screen.findByTestId('job-passage');
    await waitFor(() => expect(passage.getAttribute('data-phase')).toBe('running'));
  });

  it('a decision on the team record still reads running over an empty log (today’s route is kept)', async () => {
    team = () => ok({ ...NO_DECISION, rows: [...NO_DECISION.rows, { event_id: 3, event_type: 'wicked.team.gate.decided', payload: { kind: 'plan_approval', gate_id: 'g1', decision: 'human_approved' } }] });
    events = () => ok({ events: [] });
    page();
    const passage = await screen.findByTestId('job-passage');
    await waitFor(() => expect(passage.getAttribute('data-phase')).toBe('running'));
  });
});

describe('studio#1485: pastPlanOnLog', () => {
  it('reads the cert log as past its plan, and its prefix up to the answer as not', () => {
    expect(pastPlanOnLog(CERT.events)).toBe(true);
    expect(pastPlanOnLog(upTo(1361))).toBe(false);
    expect(pastPlanOnLog(upTo(1362))).toBe(false);
    expect(pastPlanOnLog(upTo(1363))).toBe(true);
  });
  it('not read, or no plan gate on the log, is not proof', () => {
    expect(pastPlanOnLog(null)).toBe(false);
    expect(pastPlanOnLog(CERT.events.filter((e) => e['type'] !== 'awaitingHuman'))).toBe(false);
  });
  it('the NEWEST plan gate decides: a dispatch from before a later plan gate does not count', () => {
    const later = [...CERT.events, { type: 'awaitingHuman', gateKind: 'plan_approval', ord: 2, reviewingOrd: null, seq: 1700 }, { type: 'resumed', ord: 2, seq: 1701 }];
    expect(pastPlanOnLog(later)).toBe(false);
    expect(pastPlanOnLog([...later, { type: 'unitDispatched', ord: 2, attempt: 0, seq: 1702 }])).toBe(true);
  });
  it('the step the gate stood before must be the one dispatched (reviewingOrd, else ord); a gate with no step is not proof', () => {
    const gate = { type: 'awaitingHuman', gateKind: 'plan_approval', ord: 1, reviewingOrd: 3 };
    expect(pastPlanOnLog([gate, { type: 'unitDispatched', ord: 1 }])).toBe(false);
    expect(pastPlanOnLog([gate, { type: 'unitDispatched', ord: 3 }])).toBe(true);
    expect(pastPlanOnLog([{ type: 'awaitingHuman', gateKind: 'plan_approval', ord: null, reviewingOrd: null }, { type: 'unitDispatched', ord: 1 }])).toBe(false);
  });
  it('a non-plan gate is not a plan gate', () => {
    expect(pastPlanOnLog([{ type: 'awaitingHuman', gateKind: 'deliver', ord: 1 }, { type: 'unitDispatched', ord: 1 }])).toBe(false);
  });
});
