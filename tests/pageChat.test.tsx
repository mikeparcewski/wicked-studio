import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvent, RosterSeat } from '../src/api/types.js';

/**
 * PAGE CHATS (DES-LEARN §6.2; mockup learn-and-panels state f): the system chat's engine inside a page. A click on
 * an item puts a question about it in the box (sent only by the person); the page's data and the item ride the
 * first message's context pack; the answer is followed by a guided "What next?" (no buttons in the bubble); a
 * follow-up sits above its own answer; each page keeps its own conversation, apart from the floating chat's.
 */

const openChat = vi.fn();
const sendChatMessage = vi.fn();
const getChat = vi.fn();
const getChatMessages = vi.fn();
const fileProposal = vi.fn();
const listeners: Array<(ev: CoreEvent) => void> = [];

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    getChatMessages: (...a: unknown[]) => getChatMessages(...a),
    getRoster: () => Promise.resolve({ roster: [] }),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjects: () => Promise.resolve({ projects: [] }),
    getRun: () => Promise.reject(new Error('no run here')),
  },
  apiFetch: () => Promise.reject(new Error('no route in this rig')),
}));
vi.mock('../src/api/proposals.js', async (orig) => ({ ...(await orig<object>()), fileProposal: (...a: unknown[]) => fileProposal(...a) }));
// One subscription per mounted listener, as the real stream (a render does not subscribe again).
vi.mock('../src/hooks/useEventStream.js', async () => {
  const R = await import('react');
  return {
    useEventStream: (fn: (ev: CoreEvent) => void) => {
      const ref = R.useRef(fn);
      ref.current = fn;
      R.useEffect(() => {
        const l = (ev: CoreEvent): void => ref.current(ev);
        listeners.push(l);
        return () => { const i = listeners.indexOf(l); if (i >= 0) listeners.splice(i, 1); };
      }, []);
    },
  };
});
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: () => Promise.reject(new Error('x')), isDiagnosticsUnsupported: () => true }));

const { PageChat, askPage, useAskableItems } = await import('../src/components/chat/PageChat.js');
const { usePageChat } = await import('../src/store/pageChat.js');
const { setCachedRoster, clearCachedRoster } = await import('../src/store/rosterCache.js');
const { useCapabilities } = await import('../src/store/capabilities.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const React = await import('react');

const ROSTER = [
  { key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp' }, chat_admission: { unscoped: { ok: true }, scoped: { ok: true } } },
] as unknown as RosterSeat[];

const frame = (ev: Record<string, unknown>): void => {
  act(() => { for (const l of [...listeners]) l(ev as unknown as CoreEvent); });
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  listeners.length = 0;
  sessionStorage.clear();
  localStorage.clear();
  clearCachedRoster();
  setCachedRoster(ROSTER);
  usePageChat.setState({ open: {}, focus: {}, seed: {}, gen: {} });
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), retiredByChat: {}, answerOrds: {}, replySeq: {}, paByChat: {} });
  useCapabilities.setState({ loaded: true, askPath: false, chatList: true, chatAttachments: false, chatWorkflows: ['analyze'] });
  openChat.mockImplementation((b: { chatId: string }) => Promise.resolve({ chatId: b.chatId, seats: [{ cliKey: 'claude', ok: true }], refused: [], scope: null }));
  sendChatMessage.mockResolvedValue({ seats: ['claude'], turnId: 't-1' });
  getChat.mockResolvedValue({ chatId: 'x', seats: ['claude'], scope: null, messages: [] });
  fileProposal.mockResolvedValue({ id: 'p-1' });
});

const REPORT = { knows: 'Knows this page: the 4 headline numbers', data: () => ['period: Last 7 days', '35 jobs finished'] };
const FOCUS = { key: 'report-tile-firstpass', label: '68% passed first time · Last 7 days', lines: ['68%', 'of 177 checked steps'] };

describe('a page chat', () => {
  it('asks about a clicked item: the question waits in the box with the item as a chip; nothing is sent', async () => {
    render(<PageChat kind="report" runs={[]} navigate={() => undefined} variant="column" provider={REPORT} />);
    act(() => askPage('report', { focus: FOCUS, text: 'What’s behind 68% passed first time?' }));
    expect(await screen.findByTestId('page-chat-focus')).toHaveTextContent('About: 68% passed first time · Last 7 days');
    expect(screen.getByTestId('assist-input')).toHaveValue('What’s behind 68% passed first time?');
    expect(screen.getByTestId('assist-context')).toHaveTextContent('Knows this page: the 4 headline numbers');
    expect(openChat).not.toHaveBeenCalled();
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('sends the page’s data and the item with the first message, keeps its own session, and shows the chip on the bubble', async () => {
    const user = userEvent.setup();
    render(<PageChat kind="report" runs={[]} navigate={() => undefined} variant="column" provider={REPORT} />);
    act(() => askPage('report', { focus: FOCUS, text: 'Why did first-time pass drop?' }));
    await user.click(await screen.findByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const msg = String(sendChatMessage.mock.calls[0]![1]);
    expect(msg.startsWith('Why did first-time pass drop?')).toBe(true);
    expect(msg).toContain('what this page shows:\n  period: Last 7 days\n  35 jobs finished');
    expect(msg).toContain('the question is about: 68% passed first time · Last 7 days');
    expect(msg).toContain('change nothing from this chat');
    // One seat, a plain chat (Report runs no workflow), started on the page.
    const body = openChat.mock.calls[0]![0] as { workflow?: string; clis: string[]; startedOn?: { label: string } };
    expect(body.workflow).toBeUndefined();
    expect(body.clis).toEqual(['claude']);
    // Its own conversation: the floating chat's session is untouched.
    expect(sessionStorage.getItem('wicked.pagechat.report.session')).toContain((openChat.mock.calls[0]![0] as { chatId: string }).chatId);
    expect(sessionStorage.getItem('wicked.ask.session')).toBeNull();
    expect(screen.getByTestId('assist-msg-chip')).toHaveTextContent('68% passed first time');
    // The item rode that message; the next one is about the page again.
    await waitFor(() => expect(screen.queryByTestId('page-chat-focus')).toBeNull());
  });

  it('an answer is followed by "What next?" (a guided ask), which collapses into what was chosen', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<PageChat kind="report" runs={[]} navigate={navigate} variant="column" provider={REPORT} />);
    act(() => askPage('report', { text: 'What changed most?' }));
    await user.click(await screen.findByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const chatId = (openChat.mock.calls[0]![0] as { chatId: string }).chatId;
    expect(screen.queryByTestId('page-chat-next')).toBeNull();
    frame({ type: 'chatReply', chat: chatId, cliKey: 'claude', text: 'Most of the drop is one repository. `alpha/src/x.ts:3`', ok: true });
    const next = await screen.findByTestId('page-chat-next');
    expect(within(next).getByTestId('ask-question')).toHaveTextContent('What next?');
    // No buttons inside the answer bubble.
    for (const m of screen.getAllByTestId('assist-chat-msg')) expect(within(m).queryAllByRole('button')).toHaveLength(0);
    const jobs = within(next).getAllByTestId('ask-option').find((o) => o.getAttribute('data-ask-option') === 'jobs')!;
    await user.click(jobs);
    await user.click(within(next).getByTestId('ask-confirm'));
    expect(navigate).toHaveBeenCalledWith('/jobs');
    expect(await screen.findByTestId('page-chat-record')).toHaveTextContent('You chose: Open the jobs behind it');
  });

  it('a follow-up joins the chat block above its own answer', async () => {
    const user = userEvent.setup();
    render(<PageChat kind="nerve" runs={[]} navigate={() => undefined} variant="column" provider={{ knows: 'Knows system state', data: () => [] }} />);
    act(() => askPage('nerve', { text: 'What is slowing the machine?' }));
    await user.click(await screen.findByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const chatId = (openChat.mock.calls[0]![0] as { chatId: string }).chatId;
    frame({ type: 'chatReply', chat: chatId, cliKey: 'claude', text: 'Two builds.', ok: true });
    await screen.findByTestId('page-chat-next');
    await user.type(screen.getByTestId('assist-input'), 'Which builds?');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    expect(sendChatMessage.mock.calls[1]![0]).toBe(chatId);
    frame({ type: 'chatReply', chat: chatId, cliKey: 'claude', text: 'The rust ones.', ok: true });
    const block = screen.getByTestId('assist-chat');
    const order = within(block).getAllByTestId('assist-chat-msg').map((m) => m.textContent ?? '');
    expect(order.map((t) => (t.includes('Two builds') ? 'a1' : t.includes('Which builds') ? 'q2' : t.includes('rust') ? 'a2' : '?'))).toEqual(['a1', 'q2', 'a2']);
    // Only the first question is a separate bubble before the block.
    expect(screen.getAllByTestId('assist-user-msg')).toHaveLength(1);
  });

  it('a page’s own move (Check again) is the page’s to make', async () => {
    const user = userEvent.setup();
    const onMove = vi.fn(() => true);
    render(<PageChat kind="nerve" runs={[]} navigate={() => undefined} variant="column" provider={{ knows: 'k', data: () => [], onMove }} />);
    act(() => askPage('nerve', { text: 'Is it healthy?', send: true }));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    frame({ type: 'chatReply', chat: (openChat.mock.calls[0]![0] as { chatId: string }).chatId, cliKey: 'claude', text: 'Mostly.', ok: true });
    const next = await screen.findByTestId('page-chat-next');
    await user.click(within(next).getAllByTestId('ask-option').find((o) => o.getAttribute('data-ask-option') === 'recheck')!);
    await user.click(within(next).getByTestId('ask-confirm'));
    expect(onMove).toHaveBeenCalledWith('recheck', null);
  });

  it('Memory: the "Remember:" lines it would keep are a pick-several, filed as proposals (never written directly)', async () => {
    const user = userEvent.setup();
    getChatMessages.mockResolvedValue({ chat: { status: 'open' }, messages: [
      { kind: 'user', text: 'We cut releases on Thursdays.' },
      { kind: 'reply', cliKey: 'claude', ok: true, text: 'I’d remember two things.\nRemember: Releases cut on Thursdays.\nRemember: Hotfixes need a second reviewer.' },
      // A citations record comes after the words, with no text of its own.
      { kind: 'citations', cliKey: 'claude', verified: 0, items: [] },
    ] });
    render(<PageChat kind="memory" runs={[]} navigate={() => undefined} variant="column" provider={{ knows: 'Knows Memory', data: () => [] }} />);
    act(() => askPage('memory', { text: 'We cut releases on Thursdays.', send: true }));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(String(sendChatMessage.mock.calls[0]![1])).toContain('Remember: ');
    frame({ type: 'chatReply', chat: (openChat.mock.calls[0]![0] as { chatId: string }).chatId, cliKey: 'claude', text: 'I’d remember two things.', ok: true });
    let next = await screen.findByTestId('page-chat-next');
    await waitFor(() => expect(within(screen.getByTestId('page-chat-next')).getAllByTestId('ask-option')[0]).toHaveAttribute('data-ask-option', 'remember'));
    next = screen.getByTestId('page-chat-next');
    await user.click(within(next).getByTestId('ask-confirm'));
    const keep = await screen.findByText('Which should helpers remember?');
    await user.click(within(keep.closest('[data-testid="ask-card"]') as HTMLElement).getByTestId('ask-confirm'));
    await waitFor(() => expect(fileProposal).toHaveBeenCalledTimes(2));
    expect(fileProposal.mock.calls.map((c) => (c[0] as { content: string }).content)).toEqual(['Releases cut on Thursdays.', 'Hotfixes need a second reviewer.']);
    expect(await screen.findByTestId('page-chat-record')).toHaveTextContent('filed 2 for your approval in Suggested');
  });

  it('Understand runs the analyze workflow on the repositories it was given', async () => {
    const chips = [{ key: 'page', kind: 'page' as const, label: 'This page', on: false }, { key: 'repo:r1', kind: 'repo' as const, label: 'alpha', ref: 'r1', on: true }];
    render(<PageChat kind="understand" runs={[]} navigate={() => undefined} variant="inline" chips={chips} provider={{ knows: 'Reads alpha · read-only', data: () => [] }} />);
    act(() => askPage('understand', { text: 'Who calls deliver?', send: true, fresh: true }));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const body = openChat.mock.calls[0]![0] as { workflow?: string; repoRefs?: string[] };
    expect(body.workflow).toBe('analyze');
    expect(body.repoRefs).toEqual(['r1']);
  });
});

describe('askable items', () => {
  function Page(): React.ReactElement {
    const ref = React.useRef<HTMLDivElement | null>(null);
    const h = useAskableItems('report', ref, () => ['period: Last 7 days']);
    return (
      <div ref={ref} onClick={h.onClick} onKeyDown={h.onKeyDown}>
        <div data-testid="tile" data-askable="35 jobs finished · Last 7 days" data-ask-key="tile" tabIndex={0}>35 <span>jobs finished</span> <a href="/jobs" data-testid="link">jobs</a></div>
      </div>
    );
  }

  it('a click (or Enter) on an item asks about it with its data; a link inside it stays a link', async () => {
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByTestId('link'));
    expect(usePageChat.getState().focus.report ?? null).toBeNull();
    await user.click(screen.getByTestId('tile'));
    const s = usePageChat.getState();
    expect(s.open.report).toBe(true);
    expect(s.focus.report).toMatchObject({ key: 'tile', label: '35 jobs finished · Last 7 days' });
    expect(s.focus.report!.lines[0]).toBe('period: Last 7 days');
    expect(s.seed.report).toMatchObject({ text: 'What’s behind 35 jobs finished?', send: false });
    await waitFor(() => expect(screen.getByTestId('tile')).toHaveAttribute('data-asked', 'true'));
    act(() => usePageChat.getState().clearFocus('report'));
    screen.getByTestId('tile').focus();
    await user.keyboard('{Enter}');
    expect(usePageChat.getState().focus.report?.key).toBe('tile');
  });
});
