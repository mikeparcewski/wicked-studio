import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * DES-CATALOG-002 (E1a follow-up): Change answered from full screen's chat drawer goes to the job's plan, bound to its
 * version, exactly as from the thread (one bound composer, `JobBoundComposer`). The drawer is the page's own RunHost
 * `renderChat`, drawn here by a stand-in for the panel.
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
// Full screen's chat drawer is the page's RunHost `renderChat`: the panel stand-in draws it, as full screen does.
vi.mock('../src/components/editorHost/HostPanel.js', async (orig) => {
  const real = await orig<typeof import('../src/components/editorHost/HostPanel.js')>();
  const { useRunHost } = await import('../src/components/editorHost/RunHostContext.js');
  return { ...real, HostPanel: () => <div data-testid="drawer-stand-in">{useRunHost()?.renderChat?.()}</div> };
});

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
const { resetJobLocal } = await import('../src/hooks/useJobStream.js');
const { flushDecisionsForTest, resetDecisionsForTest } = await import('../src/board/undoQueue.js');
const { makeUnit, makeView } = await import('./factories.js');
const { setCachedRoster } = await import('../src/store/rosterCache.js');
const { jobProposal } = await import('./jobFixtures.js');

const CHAT = 'chat-j';
const T0 = 1_700_000_000_000;
let messages: unknown[] = [];
let team: unknown = { teamed: false, rows: [], units: [] };
const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
let reviseAnswer: () => Response = () => ok({ view: {} }, 201);

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
    const drawer = screen.getByTestId('run-chat-drawer');
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
    const drawer = screen.getByTestId('run-chat-drawer');
    const box = within(drawer).getByTestId('session-composer-input');
    fireEvent.change(box, { target: { value: 'add a rollback step' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(await within(drawer).findByTestId('job-binding-moved')).toBeTruthy();
    expect((within(drawer).getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('add a rollback step');
  });
});
