import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamRow } from '../src/api/teamPlan.js';

/**
 * ASK-S1 (DES-ASK-TEAM-CHAT-001 §4.8): the session thread renders an ask as ONE thread — the
 * operator's turn, the PA's reply as the only bubble on the agent side, and the path's quiet lines
 * folded between them in time order (who answers, the reviewer, a finding, help, a re-pick, the end),
 * each expandable to its row; the ask run's own block stays hidden while the plan has no creator
 * step; an older daemon says so. The rows are the shapes captured live on the proof daemon.
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
const { useGateStore } = await import('../src/store/gates.js');
const { useSheets } = await import('../src/store/sheets.js');
const { makeUnit, makeView } = await import('./factories.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');

const T0 = 1_700_000_000_000;
const RUN = 'r-ask';
let eid = 10;
function row(type: string, payload: Record<string, unknown>, at: number): TeamRow {
  eid += 1;
  return { event_id: eid, event_type: `wicked.team.${type}`, emitted_at: at, payload: { run_id: RUN, ord: null, attempt: null, by: 'engine', re: null, at, ...payload } };
}
const ROWS = {
  started: row('path.started', { cli: 'claude', selection: 'random', roster: ['claude', 'codex'], request: 'why no trim?', workflow: null, plan: true }, T0 + 100),
  accepted: row('plan.accepted', { plan_rev: 1, workflow_id: `${RUN}:plan-1`, band: '0-19', high_risk: false, mode: 'auto', override: null, proposal_id: 'p-1', touch: [], steps: [{ added_by: 'plan', catalog: 'understand', id: 'answer-1', gate: { human_confirm: { unconditional: true } } }] }, T0 + 120),
  scored: row('path.scored', { basis: 'intent', score: 0, deterministic: 0, reasons: ['no creator step and no declared scope'], model: null, score_source: 'intent:p-1', signals: null, plan: { depth: 'none', monitors: 0, post_hoc_other_cli: false, post_hoc_reviewer: false }, tree: null }, T0 + 110),
  claimed: row('step.claimed', { by: 'claude', ord: 1, attempt: 0, step_id: 'answer-1', role: 'creator', kind: 'agent', phase: 'understand', criterion: '', baseline_tree: null, repo: null, code_graph_db: null }, T0 + 200),
  reviewing: row('member.joined', { by: 'codex', ord: 1, attempt: 0, member_id: 'm1', open_seq: 1, seat: 'codex', role: 'monitor', status: 'attached', reason: 'team plan monitors=1', error: null }, T0 + 300),
  completed: row('step.completed', { by: 'claude', ord: 1, attempt: 0, step_id: 'answer-1', status: 'ok', tree: null, output_bytes: 40, output_ref: `unit:${RUN}:1:0`, answers_presented: true }, T0 + 900),
  finding: row('finding.raised', { by: 'codex', ord: 1, attempt: 0, raise_seq: 1, finding_id: 'f-1', member_id: 'm1', line_key: null, anchor: null, anchor_source: 'none', severity: 'medium', target: 'output', path: 'answer-1', line: 1, evidence: 'greet.js:2', claim: 'the line cited is the signature', suggestion: 'cite line 3', tree: '', in_diff: false, corroborated_by: [] }, T0 + 1200),
};

const ASK_RUN = makeView({ id: RUN, status: 'awaiting_human', problem: 'why no trim?', unit_ix: 1, chat_id: 'chat-ask', created_at: T0 / 1000 } as never, [
  makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'done', assigned_cli: 'claude', description: 'answer-1 — why no trim?' }),
]);

const TRANSCRIPT = [
  { at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'why no trim?' },
  { at: T0 + 1000, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, usage: null, text: 'greet() does not trim its input (src/greet.js:2).' },
];

let chatBody: Record<string, unknown> = {};
let teamBody: Record<string, unknown> | null = null;
let chatReads = 0;

beforeEach(() => {
  chatReads = 0;
  chatBody = { chatId: 'chat-ask', seats: ['claude', 'codex'], scope: { kind: 'none' }, messages: TRANSCRIPT, path: { runId: RUN, pa: 'claude', selection: 'random', reviewer: 'codex', helpers: [], stepId: 'answer-1' } };
  teamBody = { runId: RUN, teamed: true, transport: 'bus', reason: null, planRev: 1, ended: false, units: [], rows: [ROWS.started, ROWS.scored, ROWS.accepted, ROWS.claimed, ROWS.reviewing, ROWS.completed, ROWS.finding] };
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, turnGates: {}, replySeq: {}, paByChat: {} });
  // The corpus is "the reply landed, the run waits at its turn gate": the gate store recorded that
  // turn gate when its frame arrived (the positive fact the thread acts on — codex #2).
  useAskThreadStore.getState().recordTurnGate(RUN, 1);
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude', binary: 'claude', enabled_for_council: true } as never, { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (path.includes('/considered')) return Promise.resolve(new Response('{}', { status: 404 }));
    if (path.startsWith('/chats/')) { chatReads += 1; return ok(chatBody); }
    if (path.endsWith('/team')) return teamBody === null ? new Response('{}', { status: 404 }) : ok(teamBody);
    if (path.endsWith('/events')) return ok({ events: [] });
    if (path === '/catalog') return ok({ entries: [] });
    return ok({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } }));
}

function page(runs = [ASK_RUN]) {
  return render(<SessionPage sessionId="chat-ask" runs={runs} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
}

const texts = (testid: string): string[] => screen.queryAllByTestId(testid).map((e) => e.textContent?.replace(/\s+/g, ' ').trim() ?? '');

describe('one thread, one voice', () => {
  it('folds the turns and the quiet lines in time order; the reply is the only agent bubble; the ask run has no block', async () => {
    page();
    await screen.findByText(/greet\(\) does not trim its input/);
    await waitFor(() => expect(screen.queryAllByTestId('ask-line').length).toBeGreaterThan(0));
    const order = [...document.querySelectorAll('[data-testid="session-turn"], [data-testid="ask-line"], [data-testid="session-run"]')]
      .map((el) => el.getAttribute('data-testid') === 'ask-line' ? `line:${el.getAttribute('data-kind')}` : el.getAttribute('data-testid') === 'session-turn' ? `turn:${el.getAttribute('data-who')}` : 'run');
    expect(order).toStrictEqual(['turn:you', 'line:who', 'line:reviewer', 'turn:helper', 'line:finding']);
    expect(screen.queryByTestId('session-run')).toBeNull();
    expect(screen.queryByTestId('chain')).toBeNull();
    expect(texts('ask-line')).toStrictEqual([
      'claude answers · picked at random',
      'codex is reviewing',
      'reviewer · 1 finding: the line cited is the signature',
    ]);
    expect(screen.getByTestId('session-ask-shape').textContent).toBe('Shape: answer · claude answers · codex reviews');
  });

  it('a quiet line expands to its row: the pick, the score and the shape under who answers; evidence and suggestion under a finding', async () => {
    page();
    await waitFor(() => expect(screen.queryAllByTestId('ask-line-toggle').length).toBeGreaterThan(1));
    const toggles = screen.getAllByTestId('ask-line-toggle');
    fireEvent.click(toggles[0]!);
    expect(texts('ask-line-detail')).toStrictEqual(['Picked claude at random from claude, codex.Score 0 · band 0–19 · no creator step and no declared scope.Shape: answer.']);
    fireEvent.click(toggles[toggles.length - 1]!);
    expect(screen.getAllByTestId('ask-line-detail').at(-1)!.textContent).toBe('Evidence: greet.js:2Suggestion: cite line 3');
  });

  it('the typing line stands while the answer step is claimed and no reply has landed, then leaves', async () => {
    chatBody = { ...chatBody, messages: [TRANSCRIPT[0]] };
    teamBody = { ...teamBody!, rows: [ROWS.started, ROWS.accepted, ROWS.claimed] };
    page();
    await screen.findByTestId('ask-typing');
    expect(screen.getByTestId('ask-typing').textContent).toContain('claude is thinking');
    // The reply streams in: the typing line yields to the pending bubble, then the bubble finishes.
    act(() => useAskThreadStore.getState().ingest({ type: 'chatDelta', chat: 'chat-ask', cliKey: 'claude', text: 'greet() does', turn_id: 't1' } as never));
    expect(screen.queryByTestId('ask-typing')).toBeNull();
    expect(document.querySelector('[data-testid="session-turn"][data-pending="true"]')?.textContent).toContain('claude · answering');
    act(() => useAskThreadStore.getState().ingest({ type: 'chatReply', chat: 'chat-ask', cliKey: 'claude', text: 'greet() does not trim.', ok: true, run_id: RUN, ord: 1, turn_id: 't1' } as never));
    expect(document.querySelector('[data-testid="session-turn"][data-pending="true"]')).toBeNull();
    expect(screen.getByText('greet() does not trim.')).toBeTruthy();
    // …and the finished reply re-reads the transcript (its citations and decisions land there).
    await waitFor(() => expect(chatReads).toBeGreaterThanOrEqual(2));
  });

  it('a turn the transcript now carries is rendered once, never beside its live copy', async () => {
    useAskThreadStore.getState().sent('chat-ask', { turnId: 't1', text: 'why no trim?', runId: RUN, at: T0 });
    useAskThreadStore.getState().ingest({ type: 'chatReply', chat: 'chat-ask', cliKey: 'claude', text: 'greet() does not trim its input (src/greet.js:2).', ok: true, run_id: RUN, ord: 1, turn_id: 't1' } as never);
    page();
    await screen.findByText(/greet\(\) does not trim its input/);
    expect(screen.getAllByTestId('session-turn')).toHaveLength(2);
  });
});

describe('the absent reviewer, a re-pick, the one-seat refusal, the end', () => {
  it('no reviewer on a one-seat roster offers Sign in, which opens the session sheet on Sign-ins; a re-pick and a refusal read as problems; the end is said', async () => {
    const none = row('member.joined', { by: 'engine', ord: 1, attempt: 0, member_id: 'm1', open_seq: 1, seat: null, role: 'monitor', status: 'failed', reason: 'team plan monitors=1', error: 'no seat distinct from the PA' }, T0 + 300);
    const repicked = row('path.repicked', { from: 'claude', to: 'codex', reason: 'timed_out', selection: 'random', pick_seq: 1, ord: 1, attempt: 0 }, T0 + 700);
    const refused = row('plan.refused', { proposal_id: 'p-2', base_rev: 1, reason: 'NoEligibleSeat: no seat distinct from the creator seat' }, T0 + 1300);
    const ended = row('path.ended', { status: 'cancelled' }, T0 + 1400);
    teamBody = { ...teamBody!, rows: [ROWS.started, ROWS.accepted, none, repicked, ROWS.completed, refused, ended] };
    page();
    await waitFor(() => expect(screen.queryAllByTestId('ask-line').length).toBe(5));
    expect(texts('ask-line')).toStrictEqual([
      'claude answers · picked at random',
      'No reviewer — only claude is signed in. Sign in', // the PA of THAT moment (the re-pick came after — codex #10)
      'codex takes over — claude stopped answering',
      'Can’t build from here: only codex is signed in; sign in another helper so review can run. Sign in',
      'Conversation ended',
    ]);
    expect(screen.getAllByTestId('ask-line')[2]!.getAttribute('data-tone')).toBe('problem');
    fireEvent.click(screen.getAllByTestId('ask-line-signin')[0]!);
    expect(useSheets.getState().open).toStrictEqual({ ref: { kind: 'session', sessionId: 'chat-ask' }, tab: 'signins' });
  });
});

describe('rule 3 — the thread is the chain until a creator step is accepted', () => {
  it('once a change adding build is accepted, the ask run’s block (and chain line) appears', async () => {
    const change = row('plan.proposed', { by: 'claude', proposal_id: 'p-2', base_rev: 1, kind: 'change', preset: null, monitors: { asked: 1 }, asks: [], touch: ['src/greet.js'], override: null, rationale: '', steps: [{ catalog: 'build', id: 'build-1' }] }, T0 + 1500);
    const accepted2 = row('plan.accepted', { plan_rev: 2, workflow_id: `${RUN}:plan-2`, band: '20-39', high_risk: false, mode: 'auto', override: null, proposal_id: 'p-2', touch: ['src/greet.js'], steps: [{ added_by: 'plan', catalog: 'understand', id: 'answer-1' }, { added_by: 'plan', catalog: 'build', id: 'build-1' }, { added_by: 'floor', catalog: 'review', id: 'review' }] }, T0 + 1600);
    teamBody = { ...teamBody!, planRev: 2, rows: [...(teamBody!.rows as TeamRow[]), change, accepted2] };
    page([{ ...ASK_RUN, session: { ...ASK_RUN.session, status: 'executing' } }]);
    await screen.findByTestId('session-run');
    expect(screen.getByTestId('session-run').getAttribute('data-run-id')).toBe(RUN);
    expect(screen.queryByTestId('session-ask-shape')).toBeNull();
    expect(texts('ask-line')).toContain('claude proposes to build: build');
  });

  it('a gate the composer cannot answer (a hand-over) brings the block back even without a creator step', async () => {
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 2, prompt: 'Approve delivery before unit 2 runs.', lifecycle: 'open', receivedAt: 1, gateKind: 'deliver' } }, approaching: {} });
    page();
    await screen.findByTestId('session-run');
  });

  it('the turn gate (def / terminal) draws nothing: no block, no gate — and it is RECORDED as the one positive fact', async () => {
    useAskThreadStore.getState().linkRun('chat-ask', RUN);
    act(() => useGateStore.getState().ingest({ type: 'awaitingHuman', session: RUN, ord: 2, prompt: 'Approve unit 2 before it runs.', gateKind: 'def' } as never));
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
    expect(useAskThreadStore.getState().turnGates[RUN]).toMatchObject({ ord: 2 });
    page();
    await waitFor(() => expect(screen.queryAllByTestId('ask-line').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('session-run')).toBeNull();
  });

  it('a late join’s kind-less gate is classified by its words: the turn gate stays undrawn, a hand-over is kept (codex #3)', () => {
    useAskThreadStore.getState().linkRun('chat-ask', RUN);
    act(() => useGateStore.getState().setGate({ runId: RUN, ord: 1, prompt: 'Approve the output of unit 1 (answer-1) — the plan is complete.', lifecycle: 'open', receivedAt: 1 }));
    expect(useGateStore.getState().gates[RUN]).toBeUndefined();
    expect(useAskThreadStore.getState().turnGates[RUN]).toMatchObject({ ord: 1 });
    act(() => useGateStore.getState().setGate({ runId: RUN, ord: 2, prompt: 'Approve delivery before unit 2 runs. Pushes branch wicked/x to origin.', lifecycle: 'open', receivedAt: 2 }));
    expect(useGateStore.getState().gates[RUN]).toMatchObject({ ord: 2 });
  });

  it('after a creator step is accepted, a def gate on the ask run is REAL work’s and is drawn (codex #1)', () => {
    useAskThreadStore.getState().linkRun('chat-ask', RUN);
    useAskThreadStore.getState().setCreatorAccepted(RUN, true);
    act(() => useGateStore.getState().ingest({ type: 'awaitingHuman', session: RUN, ord: 3, prompt: 'Approve unit 3 before it runs. The work: migration — apply it', gateKind: 'def' } as never));
    expect(useGateStore.getState().gates[RUN]).toMatchObject({ ord: 3, gateKind: 'def' });
  });

  it('an UNKNOWN gate on a waiting ask run shows the block — nothing mandatory is hidden on missing evidence (codex #2)', async () => {
    useAskThreadStore.getState().linkRun('chat-ask', RUN);
    useAskThreadStore.getState().clearTurnGate(RUN); // no turn-gate frame was ever seen for this pause
    page(); // ASK_RUN is awaiting_human with no gate in the store
    await screen.findByTestId('session-run');
  });
});

describe('§8 F7 — the un-teamed path says so in the thread', () => {
  it('transport none renders a problem line with the reason; a failed team read offers Try again', async () => {
    teamBody = { ...teamBody!, transport: 'none', reason: 'the team bus was unreachable at launch', rows: [] };
    page();
    const line = await screen.findByText(/Un-teamed: the team transport was unavailable — the team bus was unreachable at launch/);
    expect(line.closest('[data-testid="ask-line"]')!.getAttribute('data-kind')).toBe('transport');
  });
});

describe('under-the-reply lines attach by UNIT, not by time (codex #4)', () => {
  it('answer-1’s finding sits under answer-1’s reply even when answer-2’s reply has landed', async () => {
    const claimed2 = row('step.claimed', { by: 'claude', ord: 2, attempt: 0, step_id: 'answer-2', role: 'creator', kind: 'agent', phase: 'understand', criterion: '', baseline_tree: null, repo: null, code_graph_db: null }, T0 + 2000);
    const completed2 = row('step.completed', { by: 'claude', ord: 2, attempt: 0, step_id: 'answer-2', status: 'ok', tree: null, output_bytes: 10, output_ref: `unit:${RUN}:2:0` }, T0 + 2900);
    // The finding on answer-1 is published LATE (after answer-2's reply) — the final pass ran slow.
    const lateFinding = { ...ROWS.finding, event_id: 999, emitted_at: T0 + 4000, payload: { ...ROWS.finding.payload, at: T0 + 4000 } };
    teamBody = { ...teamBody!, rows: [ROWS.started, ROWS.accepted, ROWS.claimed, ROWS.reviewing, ROWS.completed, claimed2, completed2, lateFinding] };
    chatBody = { ...chatBody, messages: [...TRANSCRIPT, { at: T0 + 2000, turnId: 't2', kind: 'user', seats: ['claude'], text: 'and?' }, { at: T0 + 3000, turnId: 't2', kind: 'seat', cliKey: 'claude', ok: true, usage: null, text: 'second answer' }] };
    page();
    await screen.findByText('second answer');
    await waitFor(() => expect(screen.queryAllByTestId('ask-line').some((l) => l.getAttribute('data-kind') === 'finding')).toBe(true));
    const order = [...document.querySelectorAll('[data-testid="session-turn"], [data-testid="ask-line"]')]
      .map((el) => el.getAttribute('data-testid') === 'ask-line' ? `line:${el.getAttribute('data-kind')}` : `turn:${el.getAttribute('data-who')}`);
    expect(order).toStrictEqual(['turn:you', 'line:who', 'line:reviewer', 'turn:helper', 'line:finding', 'turn:you', 'turn:helper']);
  });
});

describe('§8 F13 — an older daemon', () => {
  it('without capabilities.askPath the thread renders as before and says every helper answers', async () => {
    useCapabilities.setState({ askPath: false });
    chatBody = { ...chatBody, path: undefined };
    teamBody = null;
    page();
    await screen.findByText(/greet\(\) does not trim its input/);
    expect(screen.getByTestId('session-ask-older').textContent).toContain('Older daemon: every helper answers at once');
    expect(screen.queryAllByTestId('ask-line')).toHaveLength(0);
  });
});
