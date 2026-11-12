import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DES-CATALOG-002 (E1a follow-up): Change answered from full screen's chat drawer goes to the job's plan, bound to its
 * version, exactly as from the thread (one bound composer, `JobBoundComposer`). The drawer is the page's own RunHost
 * `renderChat`, drawn here by the real FullShell inside a stand-in for the panel.
 *
 * (From jobPassage.test.tsx:)
 *  - It draws crew's records only (no optimistic text): a swap shows "…" and holds Start until crew's new version.
 *  - `revising` holds Start; a press whose target changed between down and up sends nothing; a reply that kept focus
 *    through a version change ignores Enter.
 *  - A held plan's Approve names its version and carries `ord` + `planRev`; it waits in the undo window as studio's
 *    receipt, and Undo sends nothing. Change binds the composer and sends the plan back with `planRev`.
 *  - An older daemon (no capability) draws no passage: today's flow.
 */

vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));
// Keep the page's real thread and FullShell; only the editor panel is a stand-in.
vi.mock('../src/components/editorHost/HostPanel.js', async (orig) => {
  const real = await orig<typeof import('../src/components/editorHost/HostPanel.js')>();
  const { useRunHost } = await import('../src/components/editorHost/RunHostContext.js');
  const { FullShell } = await import('../src/components/editorHost/FullShell.js');
  const { useHostChrome } = await import('../src/editors/hostApi.js');
  return { ...real, HostPanel: () => {
    const open = useHostChrome((s) => s.full !== null);
    const chat = useRunHost()?.renderChat?.();
    return <>
      {!open && <button onClick={() => useHostChrome.getState().enterFull('note')}>Open full size</button>}
      <FullShell open={open} tag="Document" title="Plugin check note" chat={chat} onExit={() => useHostChrome.getState().exitFull()}>
        <div>Plugin check note editor</div>
      </FullShell>
    </>;
  } };
});

const { SessionPage } = await import('../src/components/session/SessionView.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useTeamPlanStore } = await import('../src/store/teamPlan.js');
const { useGateStore } = await import('../src/store/gates.js');
const { usePlanGateStore } = await import('../src/store/planGates.js');
const { useSheets } = await import('../src/store/sheets.js');
const { useJobBinding } = await import('../src/store/jobBinding.js');
const { useHandOff } = await import('../src/components/session/JobPassage.js');
const { useElicitationStore } = await import('../src/store/elicitations.js');
const { useSessionDrafts } = await import('../src/store/sessionDrafts.js');
const { resetJobLocal } = await import('../src/hooks/useJobStream.js');
const { flushDecisionsForTest, resetDecisionsForTest } = await import('../src/board/undoQueue.js');
const { makeUnit, makeView } = await import('./factories.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { jobProposal } = await import('./jobFixtures.js');
const { useHostChrome } = await import('../src/editors/hostApi.js');
const { resetSettledProposals } = await import('../src/board/artifactProposal.js');
type Proposal = import('../src/api/chatArtifacts-wire.js').ArtifactProposal;

const CHAT = 'chat-j';
const T0 = 1_700_000_000_000;
let messages: unknown[] = [];
let team: unknown = { teamed: false, rows: [], units: [] };
const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
let reviseAnswer: () => Response = () => ok({ view: {} }, 201);
let decideAnswer: () => Response | Promise<Response>;

function ok(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}
const USER = { at: T0, turnId: 't1', kind: 'user', seats: ['claude'], text: 'get reporting off .NET Framework' };
const SEAT = { at: T0 + 1, turnId: 't1', kind: 'seat', cliKey: 'claude', ok: true, text: 'That is a framework change.' };
const P1 = { at: T0 + 2, turnId: 't1', kind: 'proposal', proposal: jobProposal() };

beforeEach(() => {
  posts.length = 0;

  messages = [USER, SEAT, P1];
  team = { teamed: false, rows: [], units: [] };
  reviseAnswer = () => ok({ view: {} }, 201);
  resetJobLocal();
  resetDecisionsForTest();
  resetSettledProposals();
  useHostChrome.setState({ full: null, chatOpen: false, navCollapsed: false, navBefore: false });
  useJobBinding.setState({ binding: null });
  useHandOff.setState({ intent: null });
  useElicitationStore.setState({ elicitations: {}, generations: {} });
  useSessionDrafts.setState({ drafts: {}, scroll: {} });
  useCapabilities.setState({ loaded: true, runChatId: true, askPath: false, chatProposals: true, chatArtifactsStub: false, chatList: true, chatJobProposals: true, reshapeRun: true });
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
      if (path.startsWith(`/chats/${CHAT}/proposals/`)) return Promise.resolve(decideAnswer());
      return Promise.resolve(ok({ view: {} }));
    }
    if (path.startsWith('/chats/') && !path.includes('/considered')) {

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
const openDrawer = () => {
  fireEvent.click(screen.getByRole('button', { name: 'Open full size' }));
  fireEvent.click(screen.getByTestId('full-shell-chat'));
  return within(screen.getByTestId('full-shell-drawer')).getByTestId('run-chat-drawer');
};


describe('full screen’s chat drawer', () => {
  const RUN = 'run-1';
  const decided = { at: T0 + 5, turnId: 't1', kind: 'proposal_decided', pid: `${CHAT}:t1`, decision: 'go', result: { runId: RUN, artifactRef: null, adopted: false, stub: false } };
  const run = () => makeView({ id: RUN, status: 'awaiting_human' as never, unit_ix: 1, chat_id: CHAT, from_proposal: `${CHAT}:t1`, created_at: (T0 + 5) / 1000 } as never, [
    makeUnit({ id: `${RUN}:u0`, session_id: RUN, ord: 0, status: 'done', phase_ref: 'pa-scope' }),
    makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'pending', phase_ref: 'build' }),
  ]);
  beforeEach(() => {
    messages = [USER, SEAT, P1, decided];
    team = { teamed: true, units: [], planRev: 2, rows: [
      { event_id: 1, event_type: 'wicked.team.plan.proposed', payload: { steps: [{ id: 'build', catalog: 'build' }] } },
      { event_id: 4, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: 'g2', ord: 1, plan_rev: 2 } }] };
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 1, prompt: 'Approve the plan', lifecycle: 'open', receivedAt: 7, gateKind: 'plan_approval' } }, approaching: {} });
  });

  it('Change answered from the drawer sends the plan back with its version, and a moved plan refuses it', async () => {
    page([run()]);
    await waitFor(() => expect(reply('change').disabled).toBe(false));
    fireEvent.click(reply('change'));
    const drawer = openDrawer();
    expect(within(drawer).getByTestId('job-binding-label').textContent).toBe('Answering: what should change in plan v2');
    const box = within(drawer).getByTestId('session-composer-input');
    fireEvent.change(box, { target: { value: 'add a rollback step' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toEqual([{ path: `/runs/${RUN}/gate`, body: { approve: false, action: 'request_changes', amend: 'add a rollback step', planRev: 2, ord: 1 } }]);
  });

  it('a binding whose plan moved is refused in the drawer, keeping the words', async () => {
    page([run()]);
    await waitFor(() => expect(reply('change').disabled).toBe(false));
    fireEvent.click(reply('change'));
    // Another answer is queued for this plan: the bound Change can't take its words now.
    fireEvent.click(reply('approve'));
    const drawer = openDrawer();
    const box = within(drawer).getByTestId('session-composer-input');
    fireEvent.change(box, { target: { value: 'add a rollback step' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await within(drawer).findByTestId('job-binding-moved')).toBeTruthy();
    expect((within(drawer).getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('add a rollback step');
  });
});

describe('full screen’s chat drawer: a moved plan', () => {
  it('a Change bound to plan v2 sends nothing once plan v3 is held, and keeps the words', async () => {
    const RUN = 'run-1';
    messages = [USER, SEAT, P1, { at: T0 + 5, turnId: 't1', kind: 'proposal_decided', pid: `${CHAT}:t1`, decision: 'go', result: { runId: RUN, artifactRef: null, adopted: false, stub: false } }];
    const planTeam = (rev: number) => ({ teamed: true, units: [], planRev: rev, rows: [
      { event_id: 1, event_type: 'wicked.team.plan.proposed', payload: { steps: [{ id: 'build', catalog: 'build' }] } },
      { event_id: 2 + rev, event_type: 'wicked.team.gate.opened', payload: { kind: 'plan_approval', gate_id: `g${rev}`, ord: 1, plan_rev: rev } }] });
    team = planTeam(2);
    useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 1, prompt: 'Approve the plan', lifecycle: 'open', receivedAt: 7, gateKind: 'plan_approval' } }, approaching: {} });
    page([makeView({ id: RUN, status: 'awaiting_human' as never, unit_ix: 1, chat_id: CHAT, from_proposal: `${CHAT}:t1`, created_at: (T0 + 5) / 1000 } as never, [
      makeUnit({ id: `${RUN}:u0`, session_id: RUN, ord: 0, status: 'done', phase_ref: 'pa-scope' }), makeUnit({ id: `${RUN}:u1`, session_id: RUN, ord: 1, status: 'pending', phase_ref: 'build' })])]);
    await waitFor(() => expect(reply('change').disabled).toBe(false));
    fireEvent.click(reply('change'));
    // Plan v3 is held now (a new gate instance and its read).
    team = planTeam(3);
    act(() => { useGateStore.setState({ gates: { [RUN]: { runId: RUN, ord: 1, prompt: 'Approve the plan', lifecycle: 'open', receivedAt: 9, gateKind: 'plan_approval' } }, approaching: {} }); });
    await waitFor(() => expect(reply('approve').textContent).toBe('Approve plan v3'));
    const drawer = openDrawer();
    const box = within(drawer).getByTestId('session-composer-input');
    fireEvent.change(box, { target: { value: 'add a rollback step' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await act(async () => { await flushDecisionsForTest(); });
    expect(posts).toEqual([]);
    expect(await within(drawer).findByTestId('job-binding-moved')).toBeTruthy();
    expect((within(drawer).getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('add a rollback step');
  });
});

describe('full screen’s chat drawer: transcript entries', () => {
  const refine: Proposal = {
    pid: `${CHAT}:t2`, chatId: CHAT, turnId: 't2', kind: 'refine', seat: 'claude',
    what: { entry: null, title: 'Plugin check note', label: 'Change · Plugin check note', outcome: 'A new version of the document.' },
    brief: 'Change only the first bullet to “Ready for review”.', reason: null, sources: [], repos: [],
    helpers: null, time: null, stops: null, filedIn: { projectId: 'demo', label: 'Demo' }, blocked: null,
    target: { ref: 'demo/plugin-check-note', title: 'Plugin check note', base: 1 }, protected: [],
  };
  const ask = { ...USER, turnId: 't2', text: 'change only the first bullet to “Ready for review”' };
  const proposalRecord = { at: T0 + 2, turnId: 't2', kind: 'proposal', proposal: refine };

  it('shows a refine after the person’s message, posts once on a double press, and settles both copies', async () => {
    messages = [ask, proposalRecord];
    let finish!: (r: Response) => void;
    decideAnswer = () => new Promise<Response>((resolve) => { finish = resolve; });
    page();
    await screen.findByTestId('artifact-proposal');
    const drawer = openDrawer();
    const card = within(drawer).getByTestId('artifact-proposal');
    expect(card.textContent).toContain('Change · Plugin check note');
    expect(card.textContent).toContain('Claude Code');
    expect(Array.from(drawer.querySelectorAll('[data-testid="run-chat-turn"], [data-testid="artifact-proposal"]')))
      .toEqual([within(drawer).getByTestId('run-chat-turn'), card]);
    const confirm = within(card).getByTestId('artifact-proposal-confirm');
    expect(confirm.textContent).toBe('Make the change');
    expect(screen.getAllByTestId('artifact-proposal')).toHaveLength(2);
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(posts).toEqual([
      { path: `/chats/${CHAT}/proposals/${encodeURIComponent(refine.pid)}`, body: { decision: 'go' } },
    ]));
    await act(async () => {
      finish(ok({ view: { proposal: refine, state: 'decided', decision: 'go', result: { runId: 'refine-run', stub: false } } }));
    });
    // Even a stale transcript re-read cannot reopen either copy of this pid.
    await waitFor(() => expect(screen.queryAllByTestId('artifact-proposal-confirm')).toHaveLength(0));
    expect(posts).toHaveLength(1);
  });

  it('keeps a chat with only turns as turns without a proposal card', async () => {
    messages = [USER, SEAT];
    page();
    await screen.findByText(SEAT.text);
    const drawer = openDrawer();
    expect(within(drawer).getAllByTestId('run-chat-turn').map((e) => e.textContent)).toEqual([
      expect.stringContaining(USER.text), expect.stringContaining(SEAT.text),
    ]);
    expect(within(drawer).queryByTestId('artifact-proposal')).toBeNull();
  });

  it('leaves a job passage in the thread behind the editor', async () => {
    page();
    await screen.findByTestId('job-passage');
    const drawer = openDrawer();
    expect(within(drawer).getAllByTestId('run-chat-turn')).toHaveLength(2);
    expect(within(drawer).queryByTestId('job-passage')).toBeNull();
    expect(within(drawer).queryByTestId('artifact-proposal')).toBeNull();
  });

  it('limits the combined turns and artifact entries to the last 12 in thread order', async () => {
    messages = [
      ...Array.from({ length: 13 }, (_, i) => ({ ...USER, at: T0 + i, turnId: `older-${i}`, text: `Message ${i}` })),
      { ...proposalRecord, at: T0 + 13 },
    ];
    page();
    await screen.findByTestId('artifact-proposal');
    const drawer = openDrawer();
    expect(within(drawer).getAllByTestId('run-chat-turn').map((e) => within(e).getByText(/^Message/).textContent))
      .toEqual(Array.from({ length: 11 }, (_, i) => `Message ${i + 2}`));
    expect(drawer.querySelector('.wk-run-chat-thread')?.lastElementChild?.getAttribute('data-testid')).toBe('artifact-proposal');
  });

  it.each(['open', 'accepting', 'decided'] as const)('keeps an old %s refine only while it still needs an answer, after 13 later turns', async (state) => {
    messages = [
      ask, proposalRecord,
      ...(state === 'accepting' ? [{ at: T0 + 3, turnId: 't2', kind: 'proposal_accepting', pid: refine.pid, resolution: refine }] : []),
      ...(state === 'decided' ? [{ at: T0 + 3, turnId: 't2', kind: 'proposal_decided', pid: refine.pid, decision: 'not_now', result: null }] : []),
      ...Array.from({ length: 13 }, (_, i) => ({ ...USER, at: T0 + 4 + i, turnId: `later-${i}`, text: `Later message ${i}` })),
    ];
    page();
    // The old proposal is in the main thread even when the drawer should omit it.
    await screen.findByTestId('artifact-proposal');
    const drawer = openDrawer();
    expect(within(drawer).getAllByTestId('run-chat-turn').map((e) => within(e).getByText(/^Later message/).textContent))
      .toEqual(Array.from({ length: 12 }, (_, i) => `Later message ${i + 1}`));
    if (state === 'decided') {
      expect(within(drawer).queryByTestId('artifact-proposal')).toBeNull();
      expect(within(drawer).queryByTestId('artifact-proposal-confirm')).toBeNull();
    } else {
      const card = within(drawer).getByTestId('artifact-proposal');
      if (state === 'open') expect(within(card).getByTestId('artifact-proposal-confirm')).toHaveTextContent('Make the change');
      else expect(within(card).getByTestId('artifact-proposal-go-again')).toHaveTextContent('Go again');
      expect(drawer.querySelector('.wk-run-chat-thread')?.firstElementChild).toBe(card);
    }
  });

  it('keeps the empty-state line when no eligible entries exist', async () => {
    messages = [P1];
    page();
    await screen.findByTestId('job-passage');
    const drawer = openDrawer();
    expect(within(drawer).getByText('Nothing has been said in this run yet.')).toBeTruthy();
  });
});
