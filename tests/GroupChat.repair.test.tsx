import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChat } from '../src/components/GroupChat.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { clearRetryPrefill, peekRetryPrefill } from '../src/store/retryPrefill.js';
import type { RosterSeat } from '../src/api/types.js';

/**
 * DES-UX-001 §7.9 (slice AB) — chat repair, the unit half (the e2e rig
 * re-proves these against a real build with a network tap):
 *
 *   - §7.9-2: a failed send NEVER clears the composer — the draft survives,
 *     the optimistic bubbles retract, the failure renders inline with Retry;
 *   - §7.9-3: chunk→bubble routing is per-seat FIFO (seat+turn) — a chunk from
 *     a still-streaming turn lands in ITS bubble, never the next turn's (the
 *     mid-word splice regression), and an orphan chunk is never dropped;
 *   - §7.9-4 / EC44: seats wear explicit states — working while a reply is
 *     pending, replied when it lands, failed-with-reason from the daemon's
 *     open-time answer (mid-stream reasons stay honest: BRIDGE-UX-1 probe 4
 *     pinned that no per-seat mid-stream lifecycle exists on the wire);
 *   - the conversation→action bridge: Continue in Build deposits the
 *     transcript as context on the §4.3 prefill store, no lineage claim.
 */

const openChat = vi.fn();
const getChat = vi.fn();
const closeChat = vi.fn();
const getRoster = vi.fn();
const sendChatMessage = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    closeChat: (...a: unknown[]) => closeChat(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
  },
  wsBase: () => 'ws://localhost',
}));

/** Capture the event-stream handler so tests can drip real frame shapes. */
let emit: ((ev: unknown) => void) | null = null;
vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: (fn: (ev: unknown) => void): void => {
    emit = fn;
  },
}));

const ROSTER = [
  { key: 'claude', enabled_for_council: true },
  { key: 'codex', enabled_for_council: true },
] as unknown as RosterSeat[];

beforeEach(() => {
  for (const spy of [openChat, getChat, closeChat, getRoster, sendChatMessage]) spy.mockReset();
  getRoster.mockResolvedValue({ roster: ROSTER });
  openChat.mockImplementation((body: { chatId: string; clis?: string[] }) =>
    Promise.resolve({
      chatId: body.chatId,
      seats: (body.clis ?? ['claude', 'codex']).map((cliKey) => ({ cliKey, ok: true })),
    }),
  );
  sendChatMessage.mockResolvedValue({ seats: [] });
  sessionStorage.clear();
  clearCachedRoster();
  clearRetryPrefill();
  emit = null;
  setCachedRoster(ROSTER); // warm cache: chips are roster-true from first paint
});

const chatId = (): string => (openChat.mock.calls[0]?.[0] as { chatId: string }).chatId;

function bubble(agent: string, turn: number): HTMLElement | null {
  return document.querySelector(`[data-testid="seat-bubble"][data-agent="${agent}"][data-turn="${turn}"]`);
}

async function sendText(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.type(screen.getByRole('textbox'), text);
  await user.keyboard('{Enter}');
  await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(chatId(), text));
}

describe('§7.9-2 — a failed send never clears the composer', () => {
  it('keeps the draft, retracts the optimistic bubbles, renders inline retry — and Retry re-sends exactly the failed text', async () => {
    const user = userEvent.setup();
    sendChatMessage.mockRejectedValueOnce(new Error('daemon refused the fan-out'));
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    await user.type(screen.getByRole('textbox'), 'first ask');
    await user.keyboard('{Enter}');
    const failure = await screen.findByTestId('chat-send-failed');
    expect(failure).toHaveTextContent('daemon refused the fan-out');
    expect(failure).toHaveTextContent(/draft is still in the composer/);
    // The draft SURVIVED — and the transcript carries no phantom turn.
    expect(screen.getByRole('textbox')).toHaveValue('first ask');
    expect(screen.queryByTestId('user-bubble')).toBeNull();
    expect(screen.queryByTestId('seat-bubble')).toBeNull();
    // The audience is not "working" on a message that never went out (EC44).
    expect(document.querySelector('[data-state="working"]')).toBeNull();

    sendChatMessage.mockResolvedValueOnce({ seats: [] });
    await user.click(screen.getByTestId('chat-send-retry'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    expect(sendChatMessage).toHaveBeenLastCalledWith(chatId(), 'first ask');
    // Accepted now: the failure row retires, the draft leaves the composer.
    await waitFor(() => expect(screen.queryByTestId('chat-send-failed')).toBeNull());
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByTestId('user-bubble')).toHaveTextContent('first ask');
  });
});

describe('§7.9-3 — chunk routing keys on seat+turn (per-seat FIFO)', () => {
  it('a still-streaming turn keeps its chunks when a second send opens the next turn — no mid-word splice', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    await sendText(user, 'first ask');
    await user.type(screen.getByRole('textbox'), 'second ask');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));

    // Two pending bubbles per seat now (turn 1 and turn 2). Turn 1's chunks
    // arrive AFTER turn 2 opened — the exact splice scenario.
    act(() => {
      emit!({ type: 'chatDelta', chat: chatId(), cliKey: 'claude', text: 'Hel' });
      emit!({ type: 'chatDelta', chat: chatId(), cliKey: 'codex', text: 'Sta' });
      emit!({ type: 'chatDelta', chat: chatId(), cliKey: 'claude', text: 'lo' });
    });
    expect(bubble('claude', 1)).toHaveTextContent('Hello');
    expect(bubble('codex', 1)).toHaveTextContent('Sta');
    expect(bubble('claude', 2)).toHaveTextContent('thinking…');

    // The terminal reply closes turn 1; the NEXT chunk belongs to turn 2.
    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'Hello world', ok: true });
      emit!({ type: 'chatDelta', chat: chatId(), cliKey: 'claude', text: 'Second answer' });
    });
    expect(bubble('claude', 1)).toHaveTextContent('Hello world');
    expect(bubble('claude', 1)!.dataset['pending']).toBe('false');
    expect(bubble('claude', 2)).toHaveTextContent('Second answer');
  });

  it('an orphan chunk opens its own bubble — streamed text is never silently dropped', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'ask');
    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'done', ok: true });
      // A late chunk with no pending bubble left for this seat:
      emit!({ type: 'chatDelta', chat: chatId(), cliKey: 'claude', text: 'stray tail' });
    });
    const bubbles = screen.getAllByTestId('seat-bubble').filter((b) => b.dataset['agent'] === 'claude');
    expect(bubbles.some((b) => b.textContent?.includes('stray tail'))).toBe(true);
  });
});

describe('§7.9-4 / EC44 — explicit seat states', () => {
  it('working while a reply is pending, replied when it lands', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'ask');

    const chip = (agent: string): HTMLElement =>
      document.querySelector(`[data-testid="seat-chip"][data-agent="${agent}"]`) as HTMLElement;
    expect(chip('claude').dataset['state']).toBe('working');
    expect(chip('claude')).toHaveTextContent('working');

    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'done', ok: true });
    });
    expect(chip('claude').dataset['state']).toBe('replied');
    expect(chip('codex').dataset['state']).toBe('working');
  });

  it('an open-time rejection is failed-WITH-REASON — the daemon\'s own POST /chats answer, visible on the chip', async () => {
    const user = userEvent.setup();
    openChat.mockImplementationOnce((body: { chatId: string; clis?: string[] }) =>
      Promise.resolve({
        chatId: body.chatId,
        seats: [
          { cliKey: 'claude', ok: true },
          { cliKey: 'codex', ok: false, error: 'quota exceeded for this seat' },
        ],
      }),
    );
    const user2 = user;
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user2, 'ask');

    const failed = document.querySelector('[data-testid="seat-chip"][data-agent="codex"]') as HTMLElement;
    expect(failed.dataset['state']).toBe('failed');
    expect(failed).toHaveTextContent('failed — quota exceeded for this seat');
    expect(failed.title).toBe('quota exceeded for this seat');
  });
});

describe('the conversation→action bridge (§7.9)', () => {
  it('Continue in Build deposits the transcript as context — a prefill, never a launch, no lineage claim', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<GroupChat repoId={null} onBack={() => undefined} navigate={navigate} />);
    await sendText(user, 'sketch the uploader');
    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'start with the seams', ok: true });
    });

    await user.click(screen.getByTestId('chat-promote'));
    expect(navigate).toHaveBeenCalledWith('/runs/new');
    const prefill = peekRetryPrefill();
    expect(prefill).not.toBeNull();
    expect(prefill!.retryOf).toBeNull(); // chats are not runs — no lineage claim
    expect(prefill!.problem).toContain('operator: sketch the uploader');
    expect(prefill!.problem).toContain('claude: start with the seams');
    expect(prefill!.clis).toEqual(['claude', 'codex']); // the warm seats
    // Nothing launched: the composer consumes this on ITS mount, editable first.
    expect(sendChatMessage).toHaveBeenCalledTimes(1);
  });
});
