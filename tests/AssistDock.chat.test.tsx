import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoreEvent } from '../src/api/types.js';
import type { AssistVerbs } from '../src/components/AssistDock.js';

/**
 * The assist dock's CHAT launches (the generic contract's second launch shape): a
 * `verbs.send` that answers `{chatId}` mounts ONE chat block for the session —
 * the block streams `chatDelta` frames per seat (FIFO), lets the terminal
 * `chatReply` REPLACE the accumulated deltas (authoritative), marks failed seats,
 * and a later send into the same session never mounts a duplicate block.
 */

const getChat = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    getChat: (...a: unknown[]) => getChat(...a),
    getRun: () => Promise.reject(new Error('no run snapshot in this rig')),
    confirmGate: vi.fn(),
    cancelRun: vi.fn(),
  },
  apiFetch: vi.fn(() => Promise.reject(new Error('no wire in this rig'))),
}));

// Capture the dock's event-stream fold so the test can push frames through it.
let emit: ((ev: CoreEvent) => void) | null = null;
vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: (handler: (ev: CoreEvent) => void) => {
    emit = handler;
  },
}));

const { AssistDock } = await import('../src/components/AssistDock.js');

function frame(f: Record<string, unknown>): CoreEvent {
  return f as unknown as CoreEvent;
}

function dock(v: AssistVerbs): void {
  render(
    <AssistDock
      context={{ surface: 'rig', title: 'Assistant', contextLabel: 'Rig', placeholder: 'Type…' }}
      verbs={v}
      open
      onOpenChange={() => undefined}
    />,
  );
}

beforeEach(() => {
  cleanup();
  emit = null;
  getChat.mockReset();
  getChat.mockResolvedValue({ chatId: 'chat-1', seats: ['claude', 'pi'] });
  try { localStorage.clear(); } catch { /* stubbed */ }
});

describe('AssistDock — the chat block', () => {
  it('a {chatId} send mounts the block with the snapshot seats; deltas stream FIFO and the reply replaces them', async () => {
    const user = userEvent.setup();
    const v: AssistVerbs = { send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) };
    dock(v);

    await user.type(screen.getByTestId('assist-input'), 'what changed?');
    await user.click(screen.getByTestId('assist-send'));

    const block = await screen.findByTestId('assist-chat');
    expect(block).toHaveAttribute('data-chat-id', 'chat-1');
    // Seats from the one GET /chats/:id snapshot.
    await waitFor(() => expect(screen.getAllByTestId('assist-chat-seat')).toHaveLength(2));
    expect(screen.getByTestId('assist-chat-waiting')).toBeInTheDocument();

    // Foreign chat frames are ignored; this session's stream in.
    act(() => {
      emit?.(frame({ type: 'chatDelta', chat: 'other-chat', cliKey: 'claude', text: 'WRONG' }));
      emit?.(frame({ type: 'chatDelta', chat: 'chat-1', cliKey: 'claude', text: 'The repo ' }));
      emit?.(frame({ type: 'chatDelta', chat: 'chat-1', cliKey: 'claude', text: 'gained a parser.' }));
    });
    const msg = screen.getByTestId('assist-chat-msg');
    expect(msg).toHaveTextContent('The repo gained a parser.');
    expect(msg).toHaveAttribute('data-pending', 'true');
    expect(screen.queryByText(/WRONG/)).toBeNull();

    // The terminal reply is authoritative — it REPLACES the deltas.
    act(() => {
      emit?.(frame({ type: 'chatReply', chat: 'chat-1', cliKey: 'claude', text: 'The repo gained a parser module (src/parse.ts).', ok: true }));
    });
    expect(screen.getByTestId('assist-chat-msg')).toHaveTextContent('The repo gained a parser module (src/parse.ts).');
    expect(screen.getByTestId('assist-chat-msg')).toHaveAttribute('data-pending', 'false');
  });

  it('a failed seat is marked; a second send into the SAME session mounts no duplicate block', async () => {
    const user = userEvent.setup();
    const v: AssistVerbs = { send: vi.fn().mockResolvedValue({ chatId: 'chat-1' }) };
    dock(v);

    await user.type(screen.getByTestId('assist-input'), 'q1');
    await user.click(screen.getByTestId('assist-send'));
    await screen.findByTestId('assist-chat');

    act(() => {
      emit?.(frame({ type: 'chatSessionFailed', chat: 'chat-1', cliKey: 'pi', reason: 'session died' }));
    });
    const seats = screen.getAllByTestId('assist-chat-seat');
    const pi = seats.find((s) => s.getAttribute('data-agent') === 'pi');
    expect(pi).toHaveAttribute('data-state', 'failed');

    await user.type(screen.getByTestId('assist-input'), 'q2');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(screen.getAllByTestId('assist-user-msg')).toHaveLength(2));
    expect(screen.getAllByTestId('assist-chat')).toHaveLength(1); // one session, one block
  });
});
