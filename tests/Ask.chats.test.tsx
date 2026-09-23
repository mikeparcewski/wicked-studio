import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RosterSeat } from '../src/api/types.js';

/**
 * studio#323 R2 — ONE chat census: a chat started from the Ask dock appears on the
 * Chats page (not only on the rail), deduped by id against the daemon's `GET /chats`,
 * and its card says where it came from (Ask) and what was asked — never the anonymous
 * `live · <8 hex>` handle.
 */

const openChat = vi.fn();
const sendChatMessage = vi.fn();
const getChat = vi.fn();
const listChats = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    listChats: (...a: unknown[]) => listChats(...a),
    closeChat: () => Promise.resolve({ ok: true }),
    getRoster: () => Promise.reject(new Error('roster is cached in this rig')),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjects: () => Promise.resolve({ projects: [] }),
    getRun: () => Promise.reject(new Error('no run snapshot in this rig')),
  },
  apiFetch: () => Promise.reject(new Error('no diagnostics in this rig')),
  wsBase: () => 'ws://localhost',
}));

vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: () => undefined,
}));

const { AskDock } = await import('../src/components/AskDock.js');
const { ChatsPage } = await import('../src/components/ChatsPage.js');
const { clearCachedRoster, setCachedRoster } = await import('../src/store/rosterCache.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');
const { useLiveChatsStore } = await import('../src/store/liveChats.js');
const { useProjectsStore } = await import('../src/store/projects.js');

const ASK_ID = '0a5c0a5c-0000-4000-8000-000000000323';
const ADMITTED = { unscoped: { ok: true }, scoped: { ok: true } };
const ROSTER = [
  { key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp' }, chat_admission: ADMITTED },
] as unknown as RosterSeat[];

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(ASK_ID);
  openChat.mockReset();
  sendChatMessage.mockReset();
  getChat.mockReset();
  listChats.mockReset();
  openChat.mockImplementation((body: { chatId: string }) =>
    Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }] }),
  );
  sendChatMessage.mockResolvedValue({ seats: ['claude'] });
  getChat.mockResolvedValue({ chatId: ASK_ID, seats: ['claude'] });
  clearCachedRoster();
  clearRepoCache();
  setCachedRoster(ROSTER);
  useProjectsStore.setState({ projects: [], loading: false, error: null });
  useLiveChatsStore.setState({ sessions: {} });
  sessionStorage.clear();
});
afterEach(() => cleanup());

async function askOnce(question: string): Promise<void> {
  const user = userEvent.setup();
  render(<AskDock runs={[]} pathname="/" onClose={() => undefined} />);
  await user.type(screen.getByTestId('assist-input'), question);
  await user.click(screen.getByTestId('assist-send'));
  await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
  cleanup(); // the operator closes Ask and navigates to /chats
}

describe('an Ask-started chat on the Chats page (studio#323 R2)', () => {
  it('appears in the live band even when GET /chats has not listed it, labelled Ask + its question', async () => {
    listChats.mockResolvedValue({ chats: [] });
    await askOnce('What is in the estate store?');

    render(<ChatsPage runs={[]} onSelect={() => {}} navigate={() => {}} />);
    await waitFor(() => expect(listChats).toHaveBeenCalledTimes(1));

    const row = screen.getByTestId('live-chat-row');
    expect(row).toHaveAttribute('data-chat-id', ASK_ID);
    expect(screen.getByTestId('live-chat-origin')).toHaveAttribute('data-origin', 'ask');
    expect(screen.getByTestId('live-chat-origin')).toHaveTextContent('Ask');
    expect(screen.getByTestId('live-chat-title')).toHaveTextContent('What is in the estate store?');
    // The anonymous hex handle is no longer the card's title.
    expect(screen.getByTestId('live-chat-title')).not.toHaveTextContent('live ·');
  });

  it('is ONE card when the daemon also lists it — deduped by id, keeping the daemon idle age', async () => {
    listChats.mockResolvedValue({ chats: [{ chatId: ASK_ID, seats: ['claude'], idleSecs: 7 }] });
    await askOnce('Why did the last run fail?');

    render(<ChatsPage runs={[]} onSelect={() => {}} navigate={() => {}} />);
    await waitFor(() => expect(listChats).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('live-chat-row')).toHaveTextContent('idle 7s'));

    expect(screen.getAllByTestId('live-chat-row')).toHaveLength(1);
    expect(screen.getByTestId('live-chat-origin')).toHaveTextContent('Ask');
    expect(screen.getByTestId('live-chat-title')).toHaveTextContent('Why did the last run fail?');
  });

  it('a session the client knows nothing about says so — "Session", untitled — never invents an origin', async () => {
    listChats.mockResolvedValue({ chats: [{ chatId: 'daemon-only-1', seats: ['pi'], idleSecs: 3 }] });

    render(<ChatsPage runs={[]} onSelect={() => {}} navigate={() => {}} />);
    await waitFor(() => expect(screen.getByTestId('live-chat-row')).toHaveAttribute('data-chat-id', 'daemon-only-1'));

    expect(screen.getByTestId('live-chat-origin')).toHaveAttribute('data-origin', 'unknown');
    expect(screen.getByTestId('live-chat-origin')).toHaveTextContent('Session');
    expect(screen.getByTestId('live-chat-title')).toHaveTextContent('Untitled live chat');
  });
});
