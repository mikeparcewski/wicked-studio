import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import type { ChatOpenBody, RosterSeat } from '../src/api/types.js';

/**
 * ASK-S1 (DES-ASK-TEAM-CHAT-001 §5.1, §8 F6; the §9 `AskDock.askPath` items): under
 * `capabilities.askPath` the dock opens a chat whose seats are the ELIGIBLE roster (nothing warm),
 * sends the question as the path's first message, deposits the 202's turn / run / step in the
 * ask-thread store, passes the helper the operator named as `primary`, and says in plain words
 * when the PA is still answering (409 `turn_in_flight`) — the draft kept, nothing orphaned.
 */

const openChat = vi.fn();
const sendChatMessage = vi.fn();
const getRoster = vi.fn();
const getChat = vi.fn();
const listRepos = vi.fn();
const listProjects = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    listRepos: (...a: unknown[]) => listRepos(...a),
    listProjects: (...a: unknown[]) => listProjects(...a),
    getRun: () => Promise.reject(new Error('no run snapshot in this rig')),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));
vi.mock('../src/hooks/useEventStream.js', () => ({ useEventStream: () => undefined }));

const { AskDock } = await import('../src/components/AskDock.js');
const { clearCachedRoster, setCachedRoster } = await import('../src/store/rosterCache.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useAskThreadStore } = await import('../src/store/askThread.js');
const { useCapabilities } = await import('../src/store/capabilities.js');

const ROSTER = [
  { key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp' }, chat_admission: { unscoped: { ok: true }, scoped: { ok: true } } },
  { key: 'codex', enabled_for_council: true, acp: { binary: 'codex-acp' }, chat_admission: { unscoped: { ok: true }, scoped: { ok: true } } },
] as unknown as RosterSeat[];

const lastBody = (): ChatOpenBody => openChat.mock.calls.at(-1)![0] as ChatOpenBody;

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  sessionStorage.clear();
  clearCachedRoster();
  clearRepoCache();
  useProjectsStore.setState({ projects: [], loading: false, error: null } as never);
  useAskThreadStore.setState({ turns: {}, runByChat: {}, runs: new Set(), retiredByChat: {}, answerOrds: {}, replySeq: {}, paByChat: {} });
  useCapabilities.setState({ loaded: true, runChatId: true, walkthroughRoots: false, askPath: true });
  setCachedRoster(ROSTER);
  listRepos.mockResolvedValue({ repos: [] });
  listProjects.mockResolvedValue({ projects: [] });
  apiFetch.mockRejectedValue(new ApiError(404, 'no such route'));
  // ASK-C1: the 201 lists the ELIGIBLE seats as ok:true — none is warmed.
  openChat.mockResolvedValue({ chatId: 'c-1', seats: [{ cliKey: 'claude', ok: true }, { cliKey: 'codex', ok: true }], refused: [], scope: { kind: 'none', repos: [], cwd: '/x', graph: { bound: false, reason: 'r' }, dangling: [] } });
  sendChatMessage.mockResolvedValue({ seats: ['claude'], turnId: 't-1', runId: 'r-ask', stepId: 'answer-1' });
  // The dock's chat block probes the chat once it is open (its seats snapshot).
  getChat.mockResolvedValue({ chatId: 'c-1', seats: ['claude', 'codex'], scope: null, messages: [] });
});

async function ask(text: string): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByTestId('assist-input'), text);
  await user.click(screen.getByTestId('assist-send'));
}

describe('an ask starts a path', () => {
  it('opens the chat over the eligible roster without naming a primary, sends once, and deposits the 202’s turn, run and step', async () => {
    render(<AskDock runs={[]} pathname="/" onClose={() => undefined} />);
    await ask('why does greet() not trim?');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(lastBody().clis).toStrictEqual(['claude', 'codex']);
    expect(lastBody().primary).toBeUndefined();
    const chatId = lastBody().chatId!;
    const turns = useAskThreadStore.getState().turns[chatId]!;
    expect(turns).toHaveLength(1);
    expect(turns[0]).toMatchObject({ turnId: 't-1', who: 'you', text: 'why does greet() not trim?', runId: 'r-ask', stepId: 'answer-1' });
    expect(useAskThreadStore.getState().runByChat[chatId]).toBe('r-ask');
    expect(useAskThreadStore.getState().runs.has('r-ask')).toBe(true);
  });

  it('the helper the operator named is the path’s primary (chosen)', async () => {
    render(<AskDock runs={[]} pathname="/" onClose={() => undefined} sendText="check the migration" sendPrimary="codex" />);
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(lastBody().primary).toBe('codex');
  });

  it('a named helper the roster does not offer is not sent as primary', async () => {
    render(<AskDock runs={[]} pathname="/" onClose={() => undefined} sendText="hello" sendPrimary="pi" />);
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(lastBody().primary).toBeUndefined();
  });

  it('without the capability nothing names a primary and the turn still lands (no run)', async () => {
    useCapabilities.setState({ askPath: false });
    sendChatMessage.mockResolvedValue({ seats: ['claude', 'codex'], turnId: 't-1' });
    render(<AskDock runs={[]} pathname="/" onClose={() => undefined} sendText="hello" sendPrimary="codex" />);
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(lastBody().primary).toBeUndefined();
    const turns = useAskThreadStore.getState().turns[lastBody().chatId!]!;
    expect(turns[0]).toMatchObject({ turnId: 't-1', who: 'you', text: 'hello' });
    expect(turns[0]!.runId).toBeUndefined();
  });
});

describe('one thread (Amendment 6 decision 5)', () => {
  it('on the chat’s own session page the dock steps aside once the send is accepted; elsewhere it stays', async () => {
    const onClose = vi.fn();
    sessionStorage.setItem('wicked.ask.session', JSON.stringify({ chatId: 'c-9', title: 'q', seeded: true }));
    getChat.mockResolvedValue({ chatId: 'c-9', seats: ['claude', 'codex'], scope: null, messages: [] });
    render(<AskDock runs={[]} pathname="/s/c-9" onClose={onClose} sendText="and then?" />);
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    cleanup();
    sendChatMessage.mockClear();
    const stays = vi.fn();
    render(<AskDock runs={[]} pathname="/" onClose={stays} sendText="and now?" />);
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 20));
    expect(stays).not.toHaveBeenCalled();
  });
});

describe('the PA is still answering (§8 F6)', () => {
  it('a 409 turn_in_flight is said in plain words naming the PA; the draft is kept; nothing is orphaned', async () => {
    render(<AskDock runs={[]} pathname="/" onClose={() => undefined} />);
    await ask('first');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const chatId = lastBody().chatId!;
    useAskThreadStore.getState().ingest({ type: 'chatDelta', chat: chatId, cliKey: 'claude', text: 'Let me…', turn_id: 't-1' } as never);
    sendChatMessage.mockRejectedValueOnce(new ApiError(409, 'turn_in_flight: the previous turn has no reply yet'));
    // The dock keeps its chat across sends: the second question goes to the same chat.
    getChat.mockResolvedValue({ chatId, seats: ['claude', 'codex'], scope: null, messages: [] });
    await ask('second');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    await screen.findByText(/claude is still answering — wait for the reply; your message was not sent\./);
    expect(openChat).toHaveBeenCalledTimes(1); // no second chat was opened for the refused message
    expect(useAskThreadStore.getState().turns[chatId]!.filter((t) => t.who === 'you')).toHaveLength(1);
  });

  it('no eligible helper: the refusal names it', async () => {
    openChat.mockResolvedValue({ chatId: 'c-2', seats: [], refused: [], scope: null });
    render(<AskDock runs={[]} pathname="/" onClose={() => undefined} />);
    await ask('hello');
    await screen.findByText(/No helper can answer — no signed-in helper is eligible to answer/);
    expect(sendChatMessage).not.toHaveBeenCalled();
  });
});

describe('S16a-4e — a reply on a chat\'s own session goes into THAT chat', () => {
  it('handed a chatId, the dock sends to it once and never opens or resumes its own stored chat', async () => {
    sessionStorage.setItem('wicked.ask.session', JSON.stringify({ chatId: 'c-dock', title: 'older', seeded: true }));
    render(<AskDock runs={[]} pathname="/s/chat-a" onClose={() => undefined} sendText="and the retry path?" sendChatId="chat-a" />);
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(sendChatMessage.mock.calls[0]![0]).toBe('chat-a');
    expect(openChat).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem('wicked.ask.session') ?? '{}').chatId).toBe('chat-a');
  });
});
