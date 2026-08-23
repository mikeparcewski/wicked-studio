import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/**
 * DES-UX-001 §7.9-5 (slice AB) — the /chats live-session band: every warm
 * chat the daemon holds is FINDABLE (the review's zombie class — working
 * agents nothing points at — dies here), listed with its seats and idle age,
 * flagged "streaming now" from its FIRST observed frame, and endable in place
 * (`DELETE /chats/:id`). One declared `GET /chats` rides the navigation; the
 * stream adds sessions the fetch predates — never another fetch.
 */

const listChats = vi.fn();
const closeChat = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listChats: (...a: unknown[]) => listChats(...a),
    closeChat: (...a: unknown[]) => closeChat(...a),
  },
  wsBase: () => 'ws://localhost',
}));

let emit: ((ev: unknown) => void) | null = null;
vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: (fn: (ev: unknown) => void): void => {
    emit = fn;
  },
}));

const { ChatsPage } = await import('../src/components/ChatsPage.js');

function page(navigate: (path: string) => void = () => {}): ReturnType<typeof render> {
  return render(<ChatsPage runs={[]} onSelect={() => {}} navigate={navigate} />);
}

beforeEach(() => {
  listChats.mockReset();
  closeChat.mockReset();
  listChats.mockResolvedValue({
    chats: [{ chatId: 'warm-chat-1', seats: ['claude', 'codex'], idleSecs: 42 }],
  });
  closeChat.mockResolvedValue({ ok: true });
  emit = null;
});
afterEach(() => cleanup());

describe('the live-session band (§7.9-5)', () => {
  it('lists every warm session from GET /chats — seats, idle age, endable', async () => {
    page();
    const row = await screen.findByTestId('live-chat-row');
    expect(row.dataset['chatId']).toBe('warm-chat-1');
    expect(row).toHaveTextContent('claude · codex');
    expect(row).toHaveTextContent('idle 42s');
    expect(row.dataset['streaming']).toBe('false');
    expect(screen.getByTestId('live-chats').dataset['count']).toBe('1');
  });

  it('a session is listed from its FIRST frame — visible while it streams, even when the fetch predates it', async () => {
    listChats.mockResolvedValue({ chats: [] });
    page();
    await waitFor(() => expect(listChats).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('live-chats')).toBeNull();

    act(() => {
      emit!({ type: 'chatDelta', chat: 'fresh-chat', cliKey: 'claude', text: 'Hel' });
    });
    const row = await screen.findByTestId('live-chat-row');
    expect(row.dataset['chatId']).toBe('fresh-chat');
    expect(row.dataset['streaming']).toBe('true');
    expect(screen.getByTestId('live-chat-streaming')).toHaveTextContent('streaming now');
    expect(listChats).toHaveBeenCalledTimes(1); // the stream never re-fetches
  });

  it('End tears the session down in place (DELETE /chats/:id) and the row leaves', async () => {
    const user = userEvent.setup();
    page();
    await screen.findByTestId('live-chat-row');
    await user.click(screen.getByTestId('live-chat-end'));
    expect(closeChat).toHaveBeenCalledWith('warm-chat-1');
    await waitFor(() => expect(screen.queryByTestId('live-chat-row')).toBeNull());
  });

  it('a chatClosed frame removes its row — the list tracks the daemon, not this tab', async () => {
    page();
    await screen.findByTestId('live-chat-row');
    act(() => {
      emit!({ type: 'chatClosed', chat: 'warm-chat-1', reason: 'closed elsewhere' });
    });
    await waitFor(() => expect(screen.queryByTestId('live-chat-row')).toBeNull());
  });

  it('a live row is a door (J4/C6): clicking it opens the session at /chat/:id', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    page(navigate);
    await user.click(await screen.findByTestId('live-chat-row'));
    expect(navigate).toHaveBeenCalledWith('/chat/warm-chat-1');
  });

  it('End is its own gesture — it never also opens the session', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    page(navigate);
    await screen.findByTestId('live-chat-row');
    await user.click(screen.getByTestId('live-chat-end'));
    expect(closeChat).toHaveBeenCalledWith('warm-chat-1');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('one truth per screen (J4/C6): "No chat sessions yet" never renders beside a live band', async () => {
    page(); // runs=[] → the run list below is empty; one live session is warm
    await screen.findByTestId('live-chat-row');
    expect(screen.queryByText('No chat sessions yet')).toBeNull();
    const empty = screen.getByTestId('chats-empty-live');
    // The honest boundary: transcripts are not stored beyond the live session.
    expect(empty.textContent).toContain('aren’t stored beyond the live session');
  });

  it('with no live band, the plain empty state stands alone', async () => {
    listChats.mockResolvedValue({ chats: [] });
    page();
    await waitFor(() => expect(listChats).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('chats-empty')).toHaveTextContent('No chat sessions yet');
    expect(screen.queryByTestId('chats-empty-live')).toBeNull();
  });
});
