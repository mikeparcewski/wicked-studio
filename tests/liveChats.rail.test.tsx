import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, cleanup, render, screen, fireEvent } from '@testing-library/react';

/**
 * BRIEF-UX-001 round 2 (J4, findings 3+4a) — live sessions are visible where
 * the user looks, without a single new fetch:
 *
 *   - the live-chats store event-sources sessions from deposits (GroupChat's
 *     open/rejoin) and from chat frames on the app's one /ws fold, and retires
 *     them on chatClosed / End;
 *   - the rail's Chat accordion lists live sessions as real /chat/:id doors,
 *     and its empty label NEVER renders beside a live conversation;
 *   - /chats' "Active now" headline counts what the screen shows (live pool
 *     sessions + non-terminal chat runs) and labels each part (EC39).
 */

interface ChatRow { chatId: string; seats: string[]; idleSecs: number | null }
const listRepos = vi.fn(() => Promise.resolve({ repos: [] }));
const listChats = vi.fn((): Promise<{ chats: ChatRow[] }> => Promise.resolve({ chats: [] }));

vi.mock('../src/hooks/useBoardModel.js', () => ({
  useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null }),
}));

vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => Promise.resolve({ status: 'ok', version: '0.2.0', ping: 'pong' }),
    listRepos: () => listRepos(),
    listChats: () => listChats(),
    closeChat: () => Promise.resolve({ ok: true }),
  },
}));

vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: () => undefined,
}));

const { LeftSidebar } = await import('../src/components/LeftSidebar.js');
const { ChatsPage } = await import('../src/components/ChatsPage.js');
const { useLiveChatsStore } = await import('../src/store/liveChats.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  listRepos.mockClear();
  listChats.mockClear();
  clearRepoCache();
  useLiveChatsStore.setState({ sessions: {} });
});

describe('the live-chats store (event-sourced, zero fetches)', () => {
  it('deposits, frame announcements, and chatClosed retirement', () => {
    const s = useLiveChatsStore.getState();
    s.upsert('c1', ['claude', 'codex']);
    s.ingest({ type: 'chatDelta', chat: 'c2', cliKey: 'agy', text: 'hi' } as never);
    expect(Object.keys(useLiveChatsStore.getState().sessions).sort()).toEqual(['c1', 'c2']);
    expect(useLiveChatsStore.getState().sessions['c2']!.seats).toEqual(['agy']);

    // A later deposit MERGES seats, never duplicates.
    useLiveChatsStore.getState().upsert('c1', ['codex', 'pi']);
    expect(useLiveChatsStore.getState().sessions['c1']!.seats).toEqual(['claude', 'codex', 'pi']);

    useLiveChatsStore.getState().ingest({ type: 'chatClosed', chat: 'c1' } as never);
    expect(Object.keys(useLiveChatsStore.getState().sessions)).toEqual(['c2']);

    // Non-chat frames and chat-less frames are ignored.
    useLiveChatsStore.getState().ingest({ type: 'unitOutputDelta', session: 'r1' } as never);
    useLiveChatsStore.getState().ingest({ type: 'chatReply', chat: '' } as never);
    expect(Object.keys(useLiveChatsStore.getState().sessions)).toEqual(['c2']);
  });
});

describe('the rail beside a live conversation (J4 finding 3)', () => {
  it('lists the live session as a /chat/:id door and never claims "no chats"', () => {
    useLiveChatsStore.getState().upsert('live-1', ['claude', 'agy']);
    const navigate = vi.fn();
    render(<LeftSidebar runs={[]} navigate={navigate} pathname="/chat/live-1" />);

    const row = screen.getByTestId('rail-live-chat');
    expect(row).toHaveAttribute('data-chat-id', 'live-1');
    expect(row).toHaveTextContent('claude · agy');
    expect(screen.queryByText('No recorded chats yet')).toBeNull();

    fireEvent.click(row);
    expect(navigate).toHaveBeenCalledWith('/chat/live-1');
  });

  it('with nothing live and nothing recorded, the empty label stays', () => {
    render(<LeftSidebar runs={[]} navigate={() => {}} pathname="/chats" />);
    expect(screen.queryByTestId('rail-live-chat')).toBeNull();
    expect(screen.getByText('No recorded chats yet')).toBeInTheDocument();
  });

  it('a chatClosed frame (or End) retires the row live', () => {
    useLiveChatsStore.getState().upsert('live-2', ['codex']);
    render(<LeftSidebar runs={[]} navigate={() => {}} pathname="/chat/live-2" />);
    expect(screen.getByTestId('rail-live-chat')).toBeInTheDocument();
    act(() => {
      useLiveChatsStore.getState().ingest({ type: 'chatClosed', chat: 'live-2' } as never);
    });
    expect(screen.queryByTestId('rail-live-chat')).toBeNull();
  });
});

describe('/chats "Conversations now" counts what the screen shows (J4 finding 4a, EC39)', () => {
  it('a live pool session is IN the tile — never a zero beside a live card', async () => {
    listChats.mockResolvedValueOnce({
      chats: [{ chatId: 'live-9', seats: ['claude'], idleSecs: 4 }],
    });
    render(<ChatsPage runs={[]} onSelect={() => {}} navigate={() => {}} />);

    // The grid lists the live session the daemon holds…
    await screen.findByTestId('live-chat-row');
    // …and the pipeline tile counts it, labeled by part.
    const tile = screen.getByTestId('stat-active');
    expect(tile).toHaveAttribute('data-value', '1');
    expect(tile).toHaveTextContent('1 live · 0 runs moving');
    // The live-seats tile agrees with the pool it counts.
    expect(screen.getByTestId('stat-live-seats')).toHaveAttribute('data-value', '1');
  });

  it('with no live sessions the windowed chats tile is labeled with its window', async () => {
    render(<ChatsPage runs={[]} onSelect={() => {}} navigate={() => {}} />);
    await screen.findByTestId('stat-active');
    expect(screen.getByTestId('stat-active')).toHaveAttribute('data-value', '0');
    expect(screen.getByTestId('stat-chats')).toHaveTextContent('last 30');
    expect(screen.getByTestId('stat-live-seats')).toHaveTextContent('no live sessions');
  });
});
