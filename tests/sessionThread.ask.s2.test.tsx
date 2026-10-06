import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamRow } from '../src/api/teamPlan.js';

/**
 * ASK-S2 (DES-ASK-TEAM-CHAT-001 §4.7): Continue in Build IN the thread. The PA's pending proposal to
 * build renders as the proposal card where it landed (the run's own block stays hidden until the
 * work is accepted); its three answers go through the ONE decision path (`POST /runs/:id/gate`):
 * Continue = approve; Not now = approve with the ACCEPTED rev's steps (nothing accepted is removed)
 * and the card keeps the proposal with "Bring it back", which prefills the composer; End = reject.
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useGateActionStore } = await import('../src/board/gateActions.js');
const { flushDecisionsForTest, resetDecisionsForTest } = await import('../src/board/undoQueue.js');
const { useSessionDrafts } = await import('../src/store/sessionDrafts.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { makeUnit, makeView } = await import('./factories.js');

// Now-based: the thread's bridges read the rows' age (an open proposal with no cached gate holds the
// block for a grace; a decided one for 15 s), so the corpus is "a moment ago", as a live one is.
const T0 = Date.now() - 5_000;
const RUN = 'r-ask';
let eid = 500;
function row(type: string, payload: Record<string, unknown>, at: number): TeamRow {
  eid += 1;
  return { event_id: eid, event_type: `wicked.team.${type}`, emitted_at: at, payload: { run_id: RUN, ord: null, attempt: null, by: 'engine', re: null, at, ...payload } };
}
const ROWS: TeamRow[] = [
  row('path.started', { cli: 'claude', selection: 'random', roster: ['claude', 'codex'], request: 'q', workflow: null, plan: true }, T0 + 100),
  row('plan.accepted', { plan_rev: 1, workflow_id: `${RUN}:plan-1`, band: '0-19', high_risk: false, mode: 'auto', override: null, proposal_id: 'p-1', touch: [], steps: [{ added_by: 'plan', catalog: 'understand', id: 'answer-1' }] }, T0 + 120),
  row('step.completed', { by: 'claude', ord: 1, attempt: 0, step_id: 'answer-1', status: 'ok', tree: null, output_bytes: 10, output_ref: `unit:${RUN}:1:0` }, T0 + 900),
  row('plan.proposed', { by: 'claude', proposal_id: 'p-2', base_rev: 1, kind: 'change', preset: null, monitors: { asked: 1 }, asks: [], touch: ['src/greet.js'], override: null, rationale: '', steps: [{ catalog: 'build', id: 'build-1' }] }, T0 + 1500),
  row('path.scored', { basis: 'intent', score: 25, deterministic: 25, reasons: [], model: null, score_source: 'intent:p-2', signals: { changed_symbols: 1, dependents: 3, products: 1, contract_change: false, test_gap: 0, critical: false, destructive: false, truncated: false }, plan: { depth: 'build', monitors: 1, post_hoc_reviewer: true, post_hoc_other_cli: false }, tree: null }, T0 + 1501),
  // The floor's fill names its addition (`added_by: floor`): the card marks Check "(required)".
  row('plan.revised', { plan_rev: 1, proposal_id: 'p-2', reason: 'floor_raised', from_band: '0-19', to_band: '20-39', high_risk: false, added: [{ catalog: 'review', id: 'review', added_by: 'floor', floor_reason: 'band 20+ always reviews' }] }, T0 + 1502),
  row('gate.opened', { gate_id: 'g-2', kind: 'plan_approval', reviewing_ord: 2, plan_rev: 2, band: '20-39', high_risk: false, mode: 'auto', reason: 'first_creator', diff: { from_rev: 1, added: ['build-1', 'review'] } }, T0 + 1503),
];
const ASK_RUN = makeView({ id: RUN, status: 'awaiting_human', problem: 'q', unit_ix: 2, chat_id: 'chat-ask', created_at: T0 / 1000 } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'done', assigned_cli: 'claude', description: 'answer-1 — q' }),
]);
const TRANSCRIPT = [
  { at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'q' },
  { at: T0 + 1000, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, usage: null, text: 'greet() does not trim.' },
];

const posts: Array<{ path: string; body: unknown }> = [];

beforeEach(() => {
  posts.length = 0;
  resetDecisionsForTest();
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set([RUN]), replySeq: {}, paByChat: {} });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useGateActionStore.setState({ byGate: {} });
  useSessionDrafts.setState({ drafts: {}, scroll: {} } as never);
  useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 2, prompt: 'Approve plan rev 2 before unit 2 runs: build-1 → review.', lifecycle: 'open', receivedAt: 1, gateKind: 'plan_approval' } }, approaching: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true } as never, { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') { posts.push({ path, body: JSON.parse(String(init.body)) }); return ok({ status: 'resumed' }); }
    if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.startsWith('/chats/')) return ok({ chatId: 'chat-ask', seats: ['claude', 'codex'], scope: { kind: 'none' }, messages: TRANSCRIPT, path: { runId: RUN, pa: 'claude', selection: 'random', reviewer: 'codex', helpers: [], stepId: 'answer-1' } });
    if (path.endsWith('/team')) return ok({ runId: RUN, teamed: true, transport: 'bus', reason: null, planRev: 1, ended: false, units: [], rows: ROWS });
    if (path.endsWith('/events')) return ok({ events: [] });
    if (path === '/catalog') return ok({ entries: [] });
    return ok({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

function page() {
  return render(<SessionPage sessionId="chat-ask" runs={[ASK_RUN]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
}

async function card(): Promise<HTMLElement> {
  const c = await screen.findByTestId('session-ask-proposal');
  await waitFor(() => expect(c.querySelector('[data-testid="session-proposal-go"]')).not.toBeNull());
  // The card answers only a gate the store holds (the handlers bail without one): wait for it.
  await waitFor(() => expect(useGateStore.getState().gates[RUN]).toBeDefined());
  return c;
}

/** The POSTs the one decision path made to the run's gate — flushed as they queue, however the
 *  runner schedules the click's work (the undo window is a timer the test drains). */
async function gatePosts(n: number): Promise<Array<{ path: string; body: unknown }>> {
  await waitFor(async () => {
    await flushDecisionsForTest();
    expect(posts.filter((p) => p.path === `/runs/${RUN}/gate`)).toHaveLength(n);
  }, { timeout: 4000 });
  return posts.filter((p) => p.path === `/runs/${RUN}/gate`);
}

describe('the proposal card in the thread', () => {
  it('renders the first-creator card after the reply with its three answers; the run block and chain stay hidden', async () => {
    page();
    const c = await card();
    expect(c.getAttribute('data-first-creator')).toBe('true');
    expect(c.querySelector('[data-testid="session-proposal-text"]')!.textContent).toBe('Continue in Build? claude proposes: Build → Check (required).');
    expect(c.querySelector('[data-testid="session-proposal-why"]')!.textContent).toContain('band 20–39 · touches 1 declared path · 3 dependents');
    expect([...c.querySelectorAll('.wk-prop-btns button')].map((b) => b.textContent)).toStrictEqual(['Continue in Build', 'Not now', 'End']);
    expect(screen.queryByTestId('session-run')).toBeNull();
    expect(screen.queryByTestId('chain')).toBeNull();
    // After the reply bubble, in time order.
    const order = [...document.querySelectorAll('[data-testid="session-turn"], [data-testid="session-ask-proposal"]')].map((el) => el.getAttribute('data-testid'));
    expect(order).toStrictEqual(['session-turn', 'session-turn', 'session-ask-proposal']);
  });

  it('Continue in Build posts ONE approve with no plan', async () => {
    page();
    const c = await card();
    fireEvent.click(c.querySelector('[data-testid="session-proposal-go"]') as HTMLElement);
    const gate = await gatePosts(1);
    expect(gate[0]!.body).toMatchObject({ approve: true });
    expect('plan' in (gate[0]!.body as object)).toBe(false);
  });

  it('Not now posts the ACCEPTED rev’s steps (no build); the card keeps the proposal and Bring it back prefills the composer', async () => {
    page();
    const c = await card();
    fireEvent.click(c.querySelector('[data-testid="session-proposal-not-now"]') as HTMLElement);
    const gate = await gatePosts(1);
    expect(gate[0]!.body).toMatchObject({ approve: true, plan: { steps: [{ catalog: 'understand', id: 'answer-1' }] } });
    await waitFor(() => expect(screen.getByTestId('session-proposal-no').textContent).toContain('Not now — the conversation goes on'));
    fireEvent.click(screen.getByTestId('session-proposal-bring-back'));
    expect(useSessionDrafts.getState().drafts['chat-ask']).toBe('Go ahead with the plan you proposed.');
  });

  it('End posts ONE reject', async () => {
    page();
    const c = await card();
    fireEvent.click(c.querySelector('[data-testid="session-proposal-end"]') as HTMLElement);
    const gate = await gatePosts(1);
    expect(gate[0]!.body).toMatchObject({ approve: false });
  });

  it('a refused answer keeps the THREE explicit choices — nothing re-sends an approve for a Not now or an End (codex on ASK-S2 #3)', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (init?.method === 'POST') { posts.push({ path, body: JSON.parse(String(init.body)) }); return Promise.resolve(new Response(JSON.stringify({ error: 'bad_request', message: 'the plan names a step the catalog does not know' }), { status: 400, headers: { 'content-type': 'application/json' } })); }
      if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
      if (path.startsWith('/chats/')) return ok({ chatId: 'chat-ask', seats: ['claude', 'codex'], scope: { kind: 'none' }, messages: TRANSCRIPT, path: { runId: RUN, pa: 'claude', selection: 'random', reviewer: 'codex', helpers: [], stepId: 'answer-1' } });
      if (path.endsWith('/team')) return ok({ runId: RUN, teamed: true, transport: 'bus', reason: null, planRev: 1, ended: false, units: [], rows: ROWS });
      if (path.endsWith('/events')) return ok({ events: [] });
      if (path === '/catalog') return ok({ entries: [] });
      return ok({});
    }));
    page();
    const c = await card();
    fireEvent.click(c.querySelector('[data-testid="session-proposal-not-now"]') as HTMLElement);
    await act(async () => { await flushDecisionsForTest(); });
    await waitFor(() => expect(c.querySelector('[data-testid="session-proposal"]')!.getAttribute('data-state')).toBe('fail'));
    expect([...c.querySelectorAll('.wk-prop-btns button')].map((b) => b.textContent)).toStrictEqual(['Continue in Build', 'Not now', 'End']);
    expect(c.querySelector('[data-testid="session-proposal-reason"]')!.textContent).toContain('refused');
  });

  it('a deliver or escalation gate cached on the run takes precedence over an open proposal: the run’s block shows (codex on ASK-S2 #2)', async () => {
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 2, prompt: 'Approve delivery before unit 2 runs. Pushes branch wicked/x to origin.', lifecycle: 'open', receivedAt: 1, gateKind: 'deliver' } }, approaching: {} });
    page();
    await screen.findByText(/greet\(\) does not trim/);
    await screen.findByTestId('session-run');
    expect(screen.queryByTestId('session-ask-proposal')).toBeNull();
    cleanup();
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 2, prompt: 'The run stalled; escalate?', lifecycle: 'open', receivedAt: 1, gateKind: 'escalation' } }, approaching: {} });
    page();
    await screen.findByText(/greet\(\) does not trim/);
    await screen.findByTestId('session-run');
    expect(screen.queryByTestId('session-ask-proposal')).toBeNull();
  });

  it('with NO cached gate the open proposal keeps the block away only for a grace; past it the run’s block shows (r2 #9)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      // The proposal's rows are old: the grace is spent on arrival.
      const old = ROWS.map((r) => ({ ...r, payload: { ...r.payload, at: Date.now() - 120_000 } }));
      vi.stubGlobal('fetch', vi.fn((url: string) => {
        const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
        if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
        if (path.startsWith('/chats/')) return ok({ chatId: 'chat-ask', seats: ['claude', 'codex'], scope: { kind: 'none' }, messages: TRANSCRIPT, path: { runId: RUN, pa: 'claude', selection: 'random', reviewer: 'codex', helpers: [], stepId: 'answer-1' } });
        if (path.endsWith('/team')) return ok({ runId: RUN, teamed: true, transport: 'bus', reason: null, planRev: 1, ended: false, units: [], rows: old });
        if (path.endsWith('/events')) return ok({ events: [] });
        if (path === '/catalog') return ok({ entries: [] });
        return ok({});
      }));
      useGateStore.setState({ gates: {}, approaching: {} });
      page();
      await screen.findByText(/greet\(\) does not trim/);
      await screen.findByTestId('session-run');
    } finally {
      vi.useRealTimers();
    }
  });

  it('a decided proposal keeps the block away for 15 s while the daemon catches up, then the run shows (r2 #2 timer)', async () => {
    const decided = { ...ROWS[0]!, event_id: 999, event_type: 'wicked.team.gate.decided', payload: { run_id: RUN, ord: null, attempt: null, by: 'human', re: null, at: Date.now() - 14_500, gate_id: 'g-2', kind: 'plan_approval', decision: 'human_amended', combined: false, team_pause: false, unresolved: [] } };
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
      if (path.startsWith('/chats/')) return ok({ chatId: 'chat-ask', seats: ['claude', 'codex'], scope: { kind: 'none' }, messages: TRANSCRIPT, path: { runId: RUN, pa: 'claude', selection: 'random', reviewer: 'codex', helpers: [], stepId: 'answer-1' } });
      if (path.endsWith('/team')) return ok({ runId: RUN, teamed: true, transport: 'bus', reason: null, planRev: 1, ended: false, units: [], rows: [...ROWS.map((r) => ({ ...r, payload: { ...r.payload, at: Date.now() - 20_000 } })), decided] });
      if (path.endsWith('/events')) return ok({ events: [] });
      if (path === '/catalog') return ok({ entries: [] });
      return ok({});
    }));
    useGateStore.setState({ gates: {}, approaching: {} });
    page();
    await screen.findByTestId('session-ask-proposal');
    expect(screen.queryByTestId('session-run')).toBeNull();
    // ~500 ms later the bridge expires and the run's block returns.
    await waitFor(() => expect(screen.queryByTestId('session-run')).not.toBeNull(), { timeout: 3000 });
  });

  it('a reload after Not now: the gate read back with no kind is the engine’s terminal prompt — the retained card stays, no run block (codex on ASK-S2 r4)', async () => {
    const decided = { ...ROWS[0]!, event_id: 998, event_type: 'wicked.team.gate.decided', payload: { run_id: RUN, ord: null, attempt: null, by: 'human', re: null, at: T0 + 1600, gate_id: 'g-2', kind: 'plan_approval', decision: 'human_amended', combined: false, team_pause: false, unresolved: [] } };
    const reaccepted = { ...ROWS[0]!, event_id: 999, event_type: 'wicked.team.plan.accepted', payload: { run_id: RUN, ord: null, attempt: null, by: 'engine', re: null, at: T0 + 1601, plan_rev: 2, workflow_id: `${RUN}:plan-2`, band: '0-19', high_risk: false, mode: 'auto', override: null, proposal_id: null, touch: [], steps: [{ added_by: 'plan', catalog: 'understand', id: 'answer-1' }] } };
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
      if (path.startsWith('/chats/')) return ok({ chatId: 'chat-ask', seats: ['claude', 'codex'], scope: { kind: 'none' }, messages: TRANSCRIPT, path: { runId: RUN, pa: 'claude', selection: 'random', reviewer: 'codex', helpers: [], stepId: 'answer-1' } });
      if (path.endsWith('/team')) return ok({ runId: RUN, teamed: true, transport: 'bus', reason: null, planRev: 2, ended: false, units: [], rows: [...ROWS, decided, reaccepted] });
      if (path.endsWith('/events')) return ok({ events: [] });
      if (path === '/catalog') return ok({ entries: [] });
      return ok({});
    }));
    // The late join's gate read: the engine's own words, no kind, at the answer unit.
    useAskThreadStore.setState({ answerOrds: { [RUN]: [1] } });
    useGateStore.setState({ gates: {}, approaching: {} });
    useGateStore.getState().setGate({ runId: RUN, ord: 1, prompt: 'Approve completion after the final phase (unit 1): answer-1 — q', lifecycle: 'open', receivedAt: 1 });
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
    page();
    await screen.findByTestId('session-proposal-no');
    expect(screen.getByTestId('session-proposal-no').textContent).toContain('Not now — the conversation goes on');
    expect(screen.queryByTestId('session-run')).toBeNull();
    expect(screen.getByTestId('session-proposal-bring-back')).toBeTruthy();
  });

  it('a double click sends once', async () => {
    page();
    const c = await card();
    const go = c.querySelector('[data-testid="session-proposal-go"]') as HTMLElement;
    fireEvent.click(go);
    fireEvent.click(go);
    await gatePosts(1);
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts.filter((p) => p.path === `/runs/${RUN}/gate`)).toHaveLength(1);
  });
});
