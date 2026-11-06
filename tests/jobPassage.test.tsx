import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DES-CATALOG-002 rev 7 §2.8 (E1a): wicked's passage in the session thread, under `capabilities.chatJobProposals`.
 *  - It draws crew's records only (no optimistic text): a swap shows "…" and holds Start until crew's new version.
 *  - `revising` holds Start; a press whose target changed between down and up sends nothing; a reply that kept focus
 *    through a version change ignores Enter.
 *  - A held plan's Approve names its version and carries `ord` + `planRev`; it waits in the undo window as studio's
 *    receipt, and Undo sends nothing. Change binds the composer and sends the plan back with `planRev`.
 *  - An older daemon (no capability) draws no passage: today's flow.
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
const { useGateStore } = await import('../src/store/gates.js');
const { usePlanGateStore } = await import('../src/store/planGates.js');
const { useSheets } = await import('../src/store/sheets.js');
const { useJobBinding } = await import('../src/store/jobBinding.js');
const { useElicitationStore } = await import('../src/store/elicitations.js');
const { useSessionDrafts } = await import('../src/store/sessionDrafts.js');
const { resetJobLocal, useJobLocal } = await import('../src/hooks/useJobStream.js');
const { flushDecisionsForTest, resetDecisionsForTest, setUndoWindowForTest } = await import('../src/board/undoQueue.js');
const { makeUnit, makeView } = await import('./factories.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { jobProposal } = await import('./jobFixtures.js');

const CHAT = 'chat-j';
const T0 = 1_700_000_000_000;
let messages: unknown[] = [];
let team: unknown = { teamed: false, rows: [], units: [] };
const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
let reviseAnswer: () => Response = () => ok({ view: {} }, 201);
let reads = 0;

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const v2 = () => jobProposal({
  pid: `${CHAT}:t2`, turnId: 't2', revises: `${CHAT}:t1`, answers: 't2',
  sentence: { ...jobProposal().sentence!, tokens: jobProposal().sentence!.tokens.map((t) => (t.id === 'option' ? { ...t, label: 'a move' } : t)) },
});
const USER = { at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'get reporting off .NET Framework' };
const SEAT = { at: T0 + 1, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, text: 'That is a framework change.' };
const P1 = { at: T0 + 2, turnId: 't1', kind: 'proposal', proposal: jobProposal() };

beforeEach(() => {
  posts.length = 0;
  reads = 0;
  messages = [USER, SEAT, P1];
  team = { teamed: false, rows: [], units: [] };
  reviseAnswer = () => ok({ view: {} }, 201);
  resetJobLocal();
  resetDecisionsForTest();
  useJobBinding.setState({ binding: null });
  useElicitationStore.setState({ elicitations: {}, generations: {} });
  useSessionDrafts.setState({ drafts: {}, scroll: {} });
  useCapabilities.setState({ loaded: true, runChatId: true, askPath: false, chatProposals: true, chatList: true, chatJobProposals: true, reshapeRun: true });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), creatorAccepted: {}, chatClosed: {}, turnGates: {}, replySeq: {}, paByChat: {}, retiredByChat: {}, answerOrds: {} });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  usePlanGateStore.setState({ byRun: {}, readFor: {} });
  useSheets.setState({ open: null, pointed: null, stopping: {} });
  setCachedRoster([{ key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true } as never, { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true } as never]);
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    if (init?.method === 'POST') {
      posts.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> });
      if (path === `/chats/${CHAT}/proposals`) return Promise.resolve(reviseAnswer());
      return Promise.resolve(ok({ view: {} }));
    }
    if (path.startsWith('/chats/') && !path.includes('/considered')) {
      reads += 1;
      return Promise.resolve(ok({ chatId: CHAT, seats: ['claude'], scope: { kind: 'none' }, messages }));
    }
    if (path.endsWith('/team')) return Promise.resolve(ok(team));
    if (path.endsWith('/events')) return Promise.resolve(ok({ events: [] }));
    return Promise.resolve(new Response('{}', { status: 404 }));
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); resetDecisionsForTest(); });

const page = (runs: ReturnType<typeof makeView>[] = []) => render(<SessionPage sessionId={CHAT} runs={runs} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
const reply = (id: string): HTMLButtonElement => screen.getAllByTestId('job-passage-reply').find((b) => b.dataset['reply'] === id) as HTMLButtonElement;
/** Crew's frame arrived: the transcript gains records and the page re-reads it. */
async function frame(...more: unknown[]): Promise<void> {
  messages = [...messages, ...more];
  const before = reads;
  act(() => { useAskThreadStore.setState((s) => ({ replySeq: { ...s.replySeq, [CHAT]: (s.replySeq[CHAT] ?? 0) + 1 } })); });
  await waitFor(() => expect(reads).toBeGreaterThan(before));
}

describe('wicked’s passage (proposal half)', () => {
  it('draws crew’s sentence under wicked’s mark, as a region, with Start naming the version; no proposal card', async () => {
    page();
    const passage = await screen.findByTestId('job-passage');
    expect(passage.getAttribute('role')).toBe('region');
    expect(passage.getAttribute('aria-label')).toMatch(/^wicked, what Start runs: Migrate · Upgrade, version 1/);
    expect(within(passage).getByTestId('job-passage-margin').textContent).toBe('wicked what Start runs v1');
    expect(within(passage).getByTestId('job-passage-sentence').textContent).toBe('I’ll port reporting-api as an in-place upgrade, with Codex and Claude, checked by QE acceptance and a parity check. Start?');
    expect(reply('start').textContent).toBe('Start v1 →');
    expect(within(passage).getByTestId('job-passage-sketch').textContent).toContain('Deliver (asks you)');
    expect(screen.queryByTestId('artifact-proposal')).toBeNull();
  });

  it('an older daemon draws no passage', async () => {
    useCapabilities.setState({ chatJobProposals: false });
    page();
    await screen.findByText('That is a framework change.');
    expect(screen.queryByTestId('job-passage')).toBeNull();
  });

  it('Start posts Go for the proposal it was pressed on', async () => {
    page();
    await screen.findByTestId('job-passage');
    fireEvent.click(reply('start'));
    await waitFor(() => expect(posts.length).toBeGreaterThan(0));
    expect(JSON.stringify(posts)).toBe(JSON.stringify([{ path: `/chats/${CHAT}/proposals/${CHAT}%3At1`, body: { decision: 'go' } }]));
  });

  it('revising holds Start: nothing is sent, and it says why', async () => {
    messages = [USER, SEAT, P1, { at: T0 + 3, turnId: 't2', kind: 'proposal_revising', pid: `${CHAT}:t1` }];
    page();
    await screen.findByTestId('job-passage');
    expect(reply('start').disabled).toBe(true);
    expect(reply('start').textContent).toBe('Updating…');
    expect(screen.getByTestId('job-passage-held').textContent).toBe('waiting for your change to settle');
    fireEvent.click(reply('start'));
    expect(posts).toEqual([]);
  });

  it('a swap is never optimistic: the token shows "…" and Start holds until crew’s version arrives', async () => {
    page();
    await screen.findByTestId('job-passage');
    const tok = screen.getAllByTestId('job-passage-token').find((t) => t.dataset['token'] === 'option')!;
    expect(tok.getAttribute('aria-haspopup')).toBe('listbox');
    fireEvent.click(tok);
    fireEvent.click(screen.getAllByTestId('job-passage-swap-option')[0]!);
    await waitFor(() => expect(posts[0]).toMatchObject({ path: `/chats/${CHAT}/proposals`, body: { revises: `${CHAT}:t1`, edits: { option: 'move' }, source: 'swap' } }));
    expect(document.querySelector('[data-token="option"]')!.textContent).toBe('…');
    expect(screen.getByTestId('job-passage-sentence').textContent).not.toContain('a move');
    expect(reply('start').disabled).toBe(true);
    await frame({ at: T0 + 4, turnId: 't2', kind: 'proposal', proposal: v2() });
    await waitFor(() => expect(screen.getByTestId('job-passage-sentence').textContent).toContain('as a move'));
    expect(reply('start').disabled).toBe(false);
    expect(reply('start').textContent).toBe('Start v2 →');
  });

  it('a refused swap restores the unchanged proposal and says crew’s words', async () => {
    reviseAnswer = () => ok({ error: 'That parent was replaced', code: 'proposal_stale' }, 409);
    page();
    await screen.findByTestId('job-passage');
    fireEvent.click(screen.getAllByTestId('job-passage-token').find((t) => t.dataset['token'] === 'option')!);
    fireEvent.click(screen.getAllByTestId('job-passage-swap-option')[0]!);
    await screen.findByTestId('job-passage-error');
    expect(reply('start').disabled).toBe(false);
    expect(document.querySelector('[data-token="option"]')!.textContent).toBe('an in-place upgrade');
  });

  it('a press whose target changes between pointer-down and pointer-up sends nothing', async () => {
    page();
    await screen.findByTestId('job-passage');
    fireEvent.pointerDown(reply('start'));
    await frame({ at: T0 + 4, turnId: 't2', kind: 'proposal', proposal: v2() });
    await waitFor(() => expect(reply('start').textContent).toBe('Start v2 →'));
    fireEvent.click(reply('start'));
    expect(posts).toEqual([]);
    expect(screen.getByTestId('job-passage-press-note').textContent).toBe('The job changed while you pressed. Nothing was sent.');
  });

  it('a reply that kept focus through a version change ignores Enter until a fresh focus', async () => {
    page();
    await screen.findByTestId('job-passage');
    fireEvent.focus(reply('start'));
    await frame({ at: T0 + 4, turnId: 't2', kind: 'proposal', proposal: v2() });
    await waitFor(() => expect(reply('start').textContent).toBe('Start v2 →'));
    fireEvent.keyDown(reply('start'), { key: 'Enter' });
    fireEvent.click(reply('start'));
    expect(posts).toEqual([]);
    expect(screen.getByTestId('job-passage-press-note').textContent).toMatch(/changed to v2\. Read it, then press again\. Nothing was sent\./);
    fireEvent.blur(reply('start'));
    fireEvent.focus(reply('start'));
    fireEvent.keyDown(reply('start'), { key: 'Enter' });
    fireEvent.click(reply('start'));
    await waitFor(() => expect(posts).toEqual([{ path: `/chats/${CHAT}/proposals/${CHAT}%3At2`, body: { decision: 'go' } }]));
  });

  it('marks the person’s message that changed the job, from crew’s record', async () => {
    messages = [USER, SEAT, P1, { at: T0 + 3, turnId: 't2', kind: 'user', text: 'make it a move' }, { at: T0 + 4, turnId: 't2', kind: 'proposal', proposal: v2() }];
    page();
    expect((await screen.findByTestId('job-change-mark')).textContent).toBe('↳ Changed the job to v2: a move');
  });
});

describe('wicked’s passage (the held plan)', () => {
  const RUN = 'run-1';
  const decided = { at: T0 + 5, turnId: 't1', kind: 'proposal_decided', pid: `${CHAT}:t1`, decision: 'go', result: { runId: RUN, artifactRef: null, adopted: false, stub: false } };
  const run = () => makeView({ id: RUN, status: 'awaiting_human', unit_ix: 1, chat_id: CHAT, from_proposal: `${CHAT}:t1`, created_at: (T0 + 5) / 1000 } as never, [
    makeUnit({ id: `${RUN}:u0`, session_id: RUN, ord: 0, status: 'done', phase_ref: 'pa-scope' }),
    makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'pending', phase_ref: 'build' }),
  ]);
  const planTeam = (rev: number) => ({
    teamed: true, rows: [
      { event_id: 1, event_type: 'wicked.team.plan.proposed', payload: { steps: [{ id: 'build', catalog: 'build' }, { id: 'review', catalog: 'review' }] } },
      { event_id: 2 + rev, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: `g${rev}`, ord: 1, plan_rev: rev } },
    ], units: [], planRev: rev,
  });
  beforeEach(() => {
    messages = [USER, SEAT, P1, decided];
    team = planTeam(2);
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 1, prompt: 'Approve the plan', lifecycle: 'open', receivedAt: 7, gateKind: 'plan_approval' } }, approaching: {} });
    // The real undo window: the receipt is studio's own until the answer is sent.
    setUndoWindowForTest(10_000);
  });
  afterEach(() => { setUndoWindowForTest(0); });

  it('draws the plan held now inside the passage (no run block, no dock), with Approve plan v2 bound to ord and planRev', async () => {
    page([run()]);
    await waitFor(() => expect(reply('approve').disabled).toBe(false));
    expect(screen.getByTestId('job-passage-version').textContent).toBe('plan v2');
    expect(reply('approve').textContent).toBe('Approve plan v2');
    expect(screen.queryByTestId('session-run')).toBeNull();
    fireEvent.click(reply('approve'));
    // Studio's receipt while it waits in the undo window: never a tick, nothing sent.
    expect((await screen.findByTestId('job-passage-queued')).textContent).toMatch(/^Approve: queued, not sent yet · sends in \d+ s/);
    expect(posts).toEqual([]);
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toEqual([{ path: `/runs/${RUN}/gate`, body: { approve: true, planRev: 2, ord: 1 } }]);
  });

  it('Undo in the receipt sends nothing and reopens the plan', async () => {
    page([run()]);
    await waitFor(() => expect(reply('approve').disabled).toBe(false));
    fireEvent.click(reply('approve'));
    fireEvent.click(await screen.findByTestId('job-passage-undo'));
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toEqual([]);
    expect(screen.queryByTestId('job-passage-queued')).toBeNull();
    expect(reply('approve').disabled).toBe(false);
  });

  it('Change binds the composer; Send sends the plan back with the person’s words and planRev', async () => {
    page([run()]);
    await waitFor(() => expect(reply('change').disabled).toBe(false));
    fireEvent.click(reply('change'));
    expect(screen.getByTestId('job-binding-label').textContent).toBe('Answering: what should change in plan v2');
    expect(reply('change').textContent).toBe('Change · answering');
    const box = screen.getByTestId('session-composer-input');
    fireEvent.change(box, { target: { value: 'add a rollback step' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toEqual([{ path: `/runs/${RUN}/gate`, body: { approve: false, action: 'request_changes', amend: 'add a rollback step', planRev: 2, ord: 1 } }]);
  });
});

describe('review round 1 folds (the passage)', () => {
  it('a same-pid re-resolution disarms a Start that kept focus', async () => {
    page();
    await screen.findByTestId('job-passage');
    fireEvent.focus(reply('start'));
    const re = jobProposal({ blocked: null, suggestions: [] });
    await frame({ at: T0 + 3, turnId: 't1', kind: 'proposal', proposal: re });
    await waitFor(() => expect(screen.queryAllByTestId('job-passage-reply').some((b) => b.dataset['reply'] === 'suggestion:0')).toBe(false));
    fireEvent.keyDown(reply('start'), { key: 'Enter' });
    fireEvent.click(reply('start'));
    expect(posts).toEqual([]);
  });

  it('a swap picked on a listbox opened on v1 sends nothing once v2 landed, and focus stays on the token', async () => {
    page();
    await screen.findByTestId('job-passage');
    fireEvent.click(document.querySelector('[data-token="repo"]')!);
    expect(screen.getByTestId('job-passage-swap')).toBeTruthy();
    // crew's v2 lands while the listbox is open: it closes (its choices were v1's)
    await frame({ at: T0 + 4, turnId: 't2', kind: 'proposal', proposal: v2() });
    await waitFor(() => expect(screen.queryByTestId('job-passage-swap')).toBeNull());
    expect(posts).toEqual([]);
    // a fresh open on v2 picks for v2
    const tok = document.querySelector<HTMLElement>('[data-token="repo"]')!;
    fireEvent.click(tok);
    fireEvent.click(screen.getAllByTestId('job-passage-swap-option')[0]!);
    await waitFor(() => expect(posts[0]?.body).toMatchObject({ revises: `${CHAT}:t2`, source: 'swap' }));
    await waitFor(() => expect(document.activeElement?.getAttribute('data-token')).toBe('repo'));
  });

  it('a late refusal of an earlier swap never releases a newer swap’s hold', async () => {
    let n = 0;
    const answers: Array<(r: Response) => void> = [];
    reviseAnswer = () => { n += 1; return ok({}, 201); };
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (init?.method === 'POST') { posts.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> }); return new Promise<Response>((res) => answers.push(res)); }
      if (path.startsWith('/chats/') && !path.includes('/considered')) { reads += 1; return Promise.resolve(ok({ chatId: CHAT, seats: ['claude'], scope: { kind: 'none' }, messages })); }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    page();
    await screen.findByTestId('job-passage');
    fireEvent.click(document.querySelector('[data-token="option"]')!);
    fireEvent.click(screen.getAllByTestId('job-passage-swap-option')[0]!);
    await waitFor(() => expect(posts).toHaveLength(1));
    await frame({ at: T0 + 4, turnId: 't2', kind: 'proposal', proposal: v2() });
    await waitFor(() => expect(reply('start').disabled).toBe(false));
    fireEvent.click(document.querySelector('[data-token="option"]')!);
    fireEvent.click(screen.getAllByTestId('job-passage-swap-option')[0]!);
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(reply('start').disabled).toBe(true);
    // the FIRST request's refusal arrives late
    await act(async () => { answers[0]!(ok({ error: 'stale', code: 'proposal_stale' }, 409)); await Promise.resolve(); });
    await screen.findByTestId('job-passage-error');
    expect(reply('start').disabled).toBe(true);
    expect(n).toBe(0);
  });

  it('a v1 (non-v2) document proposal still draws its card beside the capability', async () => {
    messages = [USER, SEAT, { at: T0 + 2, turnId: 't1', kind: 'proposal', proposal: { ...jobProposal(), kind: 'create', sentence: undefined, lineage: undefined, revises: undefined } }];
    page();
    await screen.findByText('That is a framework change.');
    expect(screen.queryByTestId('job-passage')).toBeNull();
  });
});

describe('review round 1 folds (the run half)', () => {
  const RUN = 'run-1';
  const decided = { at: T0 + 5, turnId: 't1', kind: 'proposal_decided', pid: `${CHAT}:t1`, decision: 'go', result: { runId: RUN, artifactRef: null, adopted: false, stub: false } };
  const run = (status = 'awaiting_human') => makeView({ id: RUN, status: status as never, unit_ix: 1, chat_id: CHAT, from_proposal: `${CHAT}:t1`, created_at: (T0 + 5) / 1000 } as never, [
    makeUnit({ id: `${RUN}:u0`, session_id: RUN, ord: 0, status: 'done', phase_ref: 'pa-scope' }),
    makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'pending', phase_ref: 'build' }),
  ]);
  const planTeam = (rev: number) => ({
    teamed: true, rows: [
      { event_id: 1, event_type: 'wicked.team.plan.proposed', payload: { steps: [{ id: 'build', catalog: 'build' }] } },
      { event_id: 2 + rev, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: `g${rev}`, ord: 1, plan_rev: rev } },
    ], units: [], planRev: rev,
  });
  beforeEach(() => {
    messages = [USER, SEAT, P1, decided];
    team = planTeam(2);
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 1, prompt: 'Approve the plan', lifecycle: 'open', receivedAt: 7, gateKind: 'plan_approval' } }, approaching: {} });
    setUndoWindowForTest(10_000);
  });
  afterEach(() => { setUndoWindowForTest(0); });

  it('Undo of a send-back hands the words back to the box, bound again to the same plan version', async () => {
    page([run()]);
    await waitFor(() => expect(reply('change').disabled).toBe(false));
    fireEvent.click(reply('change'));
    const box = screen.getByTestId('session-composer-input');
    fireEvent.change(box, { target: { value: 'add a rollback step' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.click(await screen.findByTestId('job-passage-undo'));
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toEqual([]);
    await waitFor(() => expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('add a rollback step'));
    expect(screen.getByTestId('job-binding-label').textContent).toBe('Answering: what should change in plan v2');
  });

  it('a bound Change whose answer can’t be taken now keeps the words and sends nothing', async () => {
    page([run()]);
    await waitFor(() => expect(reply('change').disabled).toBe(false));
    fireEvent.click(reply('change'));
    fireEvent.click(reply('approve'));
    await screen.findByTestId('job-passage-queued');
    const box = screen.getByTestId('session-composer-input');
    fireEvent.change(box, { target: { value: 'add a rollback step' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await screen.findByTestId('job-binding-moved')).toBeTruthy();
    await waitFor(() => expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('add a rollback step'));
  });

  it('a run question is answered in the passage, never a marker for a dock it isn’t in', async () => {
    team = { teamed: true, rows: [{ event_id: 9, event_type: 'wicked.team.gate.decided', payload: { kind: 'plan_approval', gate_id: 'g2', decision: 'human_approved' } }], units: [] };
    useGateStore.setState({ gates: {}, approaching: {} });
    page([run('executing')]);
    act(() => { useElicitationStore.getState().setElicitation({ runId: RUN, elicitationId: 'e1', message: 'Which region?', options: ['eu', 'us'], receivedAt: new Date().toISOString() }); });
    const q = await screen.findByTestId('job-passage-run-question');
    expect(within(q).queryByTestId('decision-marker')).toBeNull();
    expect(q.textContent).toContain('Which region?');
  });
});

describe('review round 2 folds', () => {
  const RUN = 'run-1';
  const decided = { at: T0 + 5, turnId: 't1', kind: 'proposal_decided', pid: `${CHAT}:t1`, decision: 'go', result: { runId: RUN, artifactRef: null, adopted: false, stub: false } };
  const units = (st1: 'pending' | 'rejected' = 'pending') => [
    makeUnit({ id: `${RUN}:u0`, session_id: RUN, ord: 0, status: 'done', phase_ref: 'pa-scope' }),
    makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: st1, phase_ref: 'build' }),
    makeUnit({ id: `${RUN}:u2`, session_id: RUN, ord: 2, status: 'pending', phase_ref: 'deliver' }),
  ];
  const run = (status = 'awaiting_human', st1: 'pending' | 'rejected' = 'pending') => makeView({ id: RUN, status: status as never, unit_ix: 1, chat_id: CHAT, from_proposal: `${CHAT}:t1`, created_at: (T0 + 5) / 1000 } as never, units(st1));
  const planTeam = (rev: number) => ({
    teamed: true, rows: [
      { event_id: 1, event_type: 'wicked.team.plan.proposed', payload: { steps: [{ id: 'build', catalog: 'build' }] } },
      { event_id: 2 + rev, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: `g${rev}`, ord: 1, plan_rev: rev } },
    ], units: [], planRev: rev,
  });
  const planGate = () => useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 1, prompt: 'Approve the plan', lifecycle: 'open', receivedAt: 7, gateKind: 'plan_approval' } }, approaching: {} });
  beforeEach(() => { messages = [USER, SEAT, P1, decided]; team = planTeam(2); setUndoWindowForTest(10_000); });
  afterEach(() => { setUndoWindowForTest(0); });

  it('the bound answer is the typed words alone, never the about chips’ context', async () => {
    planGate();
    const { addAboutChip } = await import('../src/store/composerChips.js');
    page([run()]);
    await waitFor(() => expect(reply('change').disabled).toBe(false));
    act(() => addAboutChip(CHAT, { kind: 'about', key: 'q:x', label: '“parity”' }));
    fireEvent.click(reply('change'));
    const box = screen.getByTestId('session-composer-input');
    fireEvent.change(box, { target: { value: 'add a rollback step' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts[0]?.body['amend']).toBe('add a rollback step');
  });

  it('a queued Stop is said as a Stop, never an Approve', async () => {
    planGate();
    const { stopRun } = await import('../src/store/sheets.js');
    page([run()]);
    await waitFor(() => expect(reply('approve').disabled).toBe(false));
    act(() => { stopRun([RUN], 'the job'); });
    expect((await screen.findByTestId('job-passage-queued')).textContent).toMatch(/^Stop the job: queued/);
    expect(reply('approve').disabled).toBe(true);
  });

  it('Undo never overwrites a newer draft or binds over it', async () => {
    planGate();
    page([run()]);
    await waitFor(() => expect(reply('change').disabled).toBe(false));
    fireEvent.click(reply('change'));
    const box = screen.getByTestId('session-composer-input');
    fireEvent.change(box, { target: { value: 'add a rollback step' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await screen.findByTestId('job-passage-undo');
    fireEvent.change(screen.getByTestId('session-composer-input'), { target: { value: 'a newer thought' } });
    fireEvent.click(screen.getByTestId('job-passage-undo'));
    await act(async () => { await flushDecisionsForTest(); });
    expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('a newer thought');
    expect(screen.queryByTestId('job-binding-label')).toBeNull();
  });

  it('a gate whose kind is unknown and whose plan read failed stays held, with Retry (never a planRev-less GateRow)', async () => {
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 1, prompt: 'Approve?', lifecycle: 'open', receivedAt: 7 } }, approaching: {} });
    team = 500;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (init?.method === 'POST') { posts.push({ path, body: {} }); return Promise.resolve(ok({})); }
      if (path.startsWith('/chats/') && !path.includes('/considered')) return Promise.resolve(ok({ chatId: CHAT, seats: ['claude'], scope: { kind: 'none' }, messages }));
      if (path.endsWith('/team')) return Promise.resolve(new Response('{"error":"down"}', { status: 500 }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    page([run()]);
    await waitFor(() => expect(screen.getByTestId('job-passage').dataset['phase']).toBe('planHeld'));
    expect(reply('approve').disabled).toBe(true);
    expect(screen.queryByTestId('job-passage-gate')).toBeNull();
    expect(await screen.findByTestId('job-passage-plan-unread')).toBeTruthy();
  });

  it('a gate on a step whose last attempt was refused still unfolds under its step', async () => {
    team = { teamed: true, rows: [{ event_id: 9, event_type: 'wicked.team.gate.decided', payload: { kind: 'plan_approval', gate_id: 'g2', decision: 'human_approved' } }], units: [] };
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 1, prompt: 'The build was refused. Retry?', lifecycle: 'open', receivedAt: 7, gateKind: 'escalation' } }, approaching: {} });
    page([run('awaiting_human', 'rejected')]);
    expect((await screen.findByTestId('job-passage-gate')).dataset['kind']).toBe('gate');
  });

  it('a hand-over gate is the hand-over card in place', async () => {
    team = { teamed: true, rows: [{ event_id: 9, event_type: 'wicked.team.gate.decided', payload: { kind: 'plan_approval', gate_id: 'g2', decision: 'human_approved' } }], units: [] };
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 2, prompt: 'Deliver?', lifecycle: 'open', receivedAt: 7, gateKind: 'deliver' } }, approaching: {} });
    page([run('awaiting_human')]);
    expect((await screen.findByTestId('job-passage-gate')).dataset['kind']).toBe('deliver');
  });

  it('Something else… leaves focus in the bound composer', async () => {
    messages = [USER, SEAT, P1];
    page();
    await screen.findByTestId('job-passage');
    fireEvent.click(document.querySelector('[data-token="repo"]')!);
    fireEvent.click(screen.getByTestId('job-passage-swap-else'));
    await waitFor(() => expect(screen.getByTestId('job-binding-label').textContent).toContain('something else'));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.activeElement).toBe(screen.getByTestId('session-composer-input'));
  });

  it('a listbox crew’s next version closes gives focus back to its token', async () => {
    messages = [USER, SEAT, P1];
    page();
    await screen.findByTestId('job-passage');
    fireEvent.click(document.querySelector('[data-token="repo"]')!);
    await waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('option'));
    await frame({ at: T0 + 4, turnId: 't2', kind: 'proposal', proposal: v2() });
    await waitFor(() => expect(document.activeElement?.getAttribute('data-token')).toBe('repo'));
  });

  it('who plans is the lead Go accepted, not a version Go did not take', async () => {
    team = { teamed: true, rows: [], units: [] };
    const accepted = jobProposal({ seats: { lead: 'claude', keys: ['claude'], label: 'Claude' } });
    messages = [USER, SEAT, P1, { at: T0 + 4, turnId: 't1', kind: 'proposal_accepting', pid: `${CHAT}:t1`, actor: 'me', edits: null, resolution: accepted, identity: { runId: RUN, artifactRef: null } }, decided];
    page([run('executing')]);
    expect((await screen.findByTestId('job-passage-planning')).textContent).toMatch(/^Claude Code is planning/);
  });

  it('an older lost revision never offers a retry over a newer one’s hold', async () => {
    messages = [USER, SEAT, P1];
    const answers: Array<{ res: (r: Response) => void; rej: (e: unknown) => void }> = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (init?.method === 'POST') { posts.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> }); return new Promise<Response>((res, rej) => answers.push({ res, rej })); }
      if (path.startsWith('/chats/') && !path.includes('/considered')) { reads += 1; return Promise.resolve(ok({ chatId: CHAT, seats: ['claude'], scope: { kind: 'none' }, messages })); }
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    page();
    await screen.findByTestId('job-passage');
    fireEvent.click(document.querySelector('[data-token="option"]')!);
    fireEvent.click(screen.getAllByTestId('job-passage-swap-option')[0]!);
    await waitFor(() => expect(posts).toHaveLength(1));
    await frame({ at: T0 + 4, turnId: 't2', kind: 'proposal', proposal: v2() });
    await waitFor(() => expect(reply('start').disabled).toBe(false));
    fireEvent.click(document.querySelector('[data-token="option"]')!);
    fireEvent.click(screen.getAllByTestId('job-passage-swap-option')[0]!);
    await waitFor(() => expect(posts).toHaveLength(2));
    await act(async () => { answers[0]!.rej(new TypeError('Failed to fetch')); await Promise.resolve(); });
    expect(screen.queryByTestId('job-passage-lost')).toBeNull();
    expect(reply('start').disabled).toBe(true);
  });
  it('a reshape in flight holds every other answer to the same plan', async () => {
    planGate();
    const offer = { id: 'o-r', kind: 'reshape', runId: RUN, pid: `${CHAT}:t1`, ord: 1, planRev: 2, text: 'That’s a different job: start it again as a move?',
      reshape: { card: 'migrate', option: 'move', depth: null, label: 'a move', command: null, lost: [], lostSeats: [], needs: [] },
      choices: [{ label: 'Start again', action: 'reshape' }, { label: 'Keep this plan', action: 'dismiss' }] };
    messages = [USER, SEAT, P1, { at: T0 + 4, turnId: 't1', kind: 'plan_offer', offer }, decided];
    let release: (r: Response) => void = () => undefined;
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      const path = new URL(url, 'http://x').pathname.replace(/^\/api\/v1/, '');
      if (init?.method === 'POST') { posts.push({ path, body: JSON.parse(String(init.body)) as Record<string, unknown> }); return new Promise<Response>((res) => { release = res; }); }
      if (path.startsWith('/chats/') && !path.includes('/considered')) return Promise.resolve(ok({ chatId: CHAT, seats: ['claude'], scope: { kind: 'none' }, messages }));
      if (path.endsWith('/team')) return Promise.resolve(ok(team));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    page([run()]);
    await waitFor(() => expect(reply('approve').disabled).toBe(false));
    const again = (await screen.findAllByTestId('job-passage-offer-choice')).find((b) => b.dataset['action'] === 'reshape')!;
    fireEvent.click(again);
    await waitFor(() => expect(posts[0]).toMatchObject({ path: `/runs/${RUN}/reshape`, body: { card: 'migrate', option: 'move', ord: 1, planRev: 2 } }));
    await waitFor(() => expect(reply('approve').disabled).toBe(true));
    expect((screen.getAllByTestId('job-passage-offer-choice').find((b) => b.dataset['action'] === 'reshape') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { release(ok({ view: {} })); await Promise.resolve(); });
  });

  it('a send-back is retired once a newer plan revision is on record (the job never reads re-planning again)', async () => {
    planGate();
    page([run()]);
    await waitFor(() => expect(reply('change').disabled).toBe(false));
    act(() => { useJobLocal.getState().setSentBack(RUN, 2); });
    act(() => { useTeamPlanStore.getState().hydrate(RUN, { ...(planTeam(3) as Record<string, unknown>), runId: RUN } as never); });
    await waitFor(() => expect(useJobLocal.getState().sentBack[RUN] ?? null).toBeNull());
  });
  it('a press in the passage binds the composer ahead of a docked decision’s note reply', async () => {
    useGateStore.setState({ gates: {
      [RUN]: { runId: RUN, ord: 1, prompt: 'Approve the plan', lifecycle: 'open', receivedAt: 7, gateKind: 'plan_approval' },
      [CHAT]: { runId: CHAT, ord: 0, prompt: 'Should the chat keep going?', lifecycle: 'open', receivedAt: 8 },
    }, approaching: {} });
    page([run()]);
    await waitFor(() => expect(reply('change').disabled).toBe(false));
    fireEvent.click(reply('change'));
    expect(screen.getByTestId('job-binding-label').textContent).toBe('Answering: what should change in plan v2');
    const box = screen.getByTestId('session-composer-input');
    fireEvent.change(box, { target: { value: 'add a rollback step' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts.map((x) => x.path)).toEqual([`/runs/${RUN}/gate`]);
  });
});
