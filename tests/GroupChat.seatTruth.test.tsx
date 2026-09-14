// studio#176 (campaign E4) — two seat-truth defects, pinned:
//
//  1. COLLAPSE MUST NOT LOSE TEXT: the chat wire keeps NO history, so what the
//     client streamed is the only copy. A long reply collapses to a narration
//     line (§11.1) and its terminal `chatReply` may arrive SHORTER than the
//     accumulated deltas (an upstream output cap, a reframed failure) — the
//     streamed bytes must survive finalize, and expanding the collapsed line
//     must restore them BYTE-EQUAL. (`retainOnFinalize`: the longer text
//     stands; ties go to the terminal reply so the §7.9-3 late-mount healing
//     stays intact.)
//
//  2. ONE SOURCE FOR SEAT TRUTH: the header's seat chip said "replied" while
//     the feed said "failed" for the SAME turn (api/groupE/e4-chat.json),
//     because the chip was a second, frame-driven derivation that ignored the
//     reply's `ok`. The chip's turn axis now reads `seatLogPosture` — the same
//     message log the feed narrates from — so the two can never disagree.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChat } from '../src/components/GroupChat.js';
import { retainOnFinalize } from '../src/components/ChatThread.js';
import { seatLogPosture } from '../src/components/narrator.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { useGateStore } from '../src/store/gates.js';
import { useElicitationStore } from '../src/store/elicitations.js';
import type { RosterSeat } from '../src/api/types.js';

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
    confirmGate: vi.fn(),
    cancelRun: vi.fn(),
  },
  wsBase: () => 'ws://localhost',
}));

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
  useGateStore.setState({ gates: {}, approaching: {} });
  useElicitationStore.setState({ elicitations: {}, generations: {} });
  emit = null;
  setCachedRoster(ROSTER);
});

const chatId = (): string => (openChat.mock.calls[0]?.[0] as { chatId: string }).chatId;

async function sendText(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.type(screen.getByRole('textbox'), text);
  await user.keyboard('{Enter}');
  await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(chatId(), text, expect.any(Array)));
}

const chip = (agent: string): HTMLElement =>
  document.querySelector(`[data-testid="seat-chip"][data-agent="${agent}"]`) as HTMLElement;

describe('collapse retention — expanding restores every streamed byte', () => {
  it('a >collapse-threshold stream survives a SHORTER terminal reply; collapse → expand is byte-equal', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-none')); // studio#248: Unfiled = an EXPLICIT unscoped choice before the first send
    await sendText(user, 'plan it');

    // Stream well past CHAT_TURN_MAX_CHARS (1400) in several deltas — one line,
    // so the markdown paragraph's textContent is the exact byte sequence.
    const parts = [
      `plan head ${'a'.repeat(600)} `,
      `middle ${'b'.repeat(600)} `,
      `the actual plan tail ${'c'.repeat(600)}`,
    ];
    const streamed = parts.join('');
    act(() => {
      for (const text of parts) {
        emit!({ type: 'chatDelta', chat: chatId(), cliKey: 'claude', text });
      }
    });

    // The terminal reply arrives TRUNCATED (the E4 loss shape): shorter than
    // what already streamed — it must NOT clobber the streamed bytes.
    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: streamed.slice(-64), ok: true });
    });

    // Over-long ⇒ still narration (collapsed), with the raw stream mounted behind
    // the expander.
    const lines = screen.getAllByTestId('chat-narration-line');
    expect(lines.some((l) => l.dataset['agent'] === 'claude' && /replied \(2 KB\)/.test(l.textContent!))).toBe(true);
    const bubble = document.querySelector('[data-testid="seat-bubble"][data-agent="claude"]') as HTMLElement;
    const wrapper = bubble.closest('[data-testid^="chat-narration-raw-"]') as HTMLElement;
    expect(wrapper.style.display).toBe('none');

    // Expand → the FULL streamed text, byte-equal. Then collapse and expand
    // again — retention is not a one-shot.
    const index = wrapper.getAttribute('data-testid')!.replace('chat-narration-raw-', '');
    const toggle = (): Promise<void> => user.click(screen.getByTestId(`chat-narration-toggle-${index}`));
    await toggle();
    expect(wrapper.style.display).not.toBe('none');
    expect(bubble.textContent).toBe(streamed);
    await toggle(); // collapse
    expect(wrapper.style.display).toBe('none');
    await toggle(); // expand again
    expect(bubble.textContent).toBe(streamed);
  });

  it('retainOnFinalize: longer stands, ties go to the terminal reply (late-mount healing intact)', () => {
    expect(retainOnFinalize('the full streamed plan', 'tail')).toBe('the full streamed plan');
    expect(retainOnFinalize('partial tail', 'the whole authoritative reply text')).toBe(
      'the whole authoritative reply text',
    );
    expect(retainOnFinalize('same-length A', 'same-length B')).toBe('same-length B');
    expect(retainOnFinalize('', 'reply')).toBe('reply');
  });
});

describe('one source for seat truth — the chip reads the feed’s own log', () => {
  it('a not-ok reply shows FAILED on the header chip (with the turn’s reason), never "replied" (E4)', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-none')); // studio#248: Unfiled = an EXPLICIT unscoped choice before the first send
    await sendText(user, 'plan it');

    act(() => {
      emit!({ type: 'chatDelta', chat: chatId(), cliKey: 'codex', text: 'streaming a partial plan… ' });
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'short answer', ok: true });
      emit!({
        type: 'chatReply', chat: chatId(), cliKey: 'codex',
        text: "seat 'codex' turn ended Cancelled: the bridge dropped mid-turn", ok: false,
      });
    });

    // The feed narrates the failure…
    const lines = screen.getAllByTestId('chat-narration-line');
    expect(
      lines.some((l) => l.dataset['agent'] === 'codex' && l.dataset['tone'] === 'fail' && /failed —/.test(l.textContent!)),
    ).toBe(true);
    // …and the header chip AGREES — same log, one derivation.
    expect(chip('codex').dataset['state']).toBe('failed');
    expect(chip('codex')).toHaveTextContent(/failed — seat 'codex' turn ended Cancelled/);
    expect(chip('claude').dataset['state']).toBe('replied');
    // The census may not contradict the feed either: one seat is ready, not two.
    expect(screen.getByTestId('now-bar-phase')).toHaveTextContent('1 agent ready');
  });

  it('a seat streaming its next turn is WORKING again — the posture heals forward', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-none')); // studio#248: Unfiled = an EXPLICIT unscoped choice before the first send
    await sendText(user, 'plan it');
    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'nope', ok: false });
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'codex', text: 'ok', ok: true });
    });
    expect(chip('claude').dataset['state']).toBe('failed');

    // A new turn fans out to the warm audience; a fresh pending bubble means
    // the seat is working, full stop — the stale failure no longer speaks.
    await user.type(screen.getByRole('textbox'), 'try again');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    expect(chip('claude').dataset['state']).toBe('working');
  });

  it('seatLogPosture — the pure fold: pending outranks finals; newest final decides; reason is the feed’s clip', () => {
    expect(seatLogPosture([
      { kind: 'seat', cliKey: 'a', text: 'old', pending: false, ok: true },
      { kind: 'seat', cliKey: 'a', text: 'streaming…', pending: true, ok: false },
      { kind: 'seat', cliKey: 'b', text: 'boom', pending: false, ok: false },
      { kind: 'seat', cliKey: 'c', text: 'fine', pending: false, ok: true },
      { kind: 'user', text: 'hi' },
    ])).toEqual({
      a: { state: 'working', reason: null },
      b: { state: 'failed', reason: 'boom' },
      c: { state: 'replied', reason: null },
    });
  });
});

describe('DES-L5 R16b — the send targets what the chips say, minus the seats refused at open (F-RC1-111)', () => {
  it('an EVICTED seat is named in the next send’s `targets` and goes back to working; a seat refused at open is not', async () => {
    const user = userEvent.setup();
    openChat.mockImplementation((body: { chatId: string; clis?: string[] }) =>
      Promise.resolve({
        chatId: body.chatId,
        seats: (body.clis ?? ['claude', 'codex']).map((cliKey) => ({ cliKey, ok: cliKey !== 'codex', ...(cliKey === 'codex' ? { error: 'not admissible to a scoped chat' } : {}) })),
        refused: [{ cliKey: 'codex', reason: 'not admissible to a scoped chat', source: 'scope' }],
      }),
    );
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-none'));
    await sendText(user, 'plan it');
    // The FIRST send (the arm) fans out to the seats that came up — codex never sat.
    expect(sendChatMessage).toHaveBeenLastCalledWith(chatId(), 'plan it', ['claude']);

    // claude runs over its budget: the engine releases it (a not-ok reply naming the budget).
    act(() => {
      emit!({
        type: 'chatReply', chat: chatId(), cliKey: 'claude', ok: false, usage: null,
        text: "seat 'claude' exceeded the 600 s turn budget (WICKED_CHAT_TURN_SECS) and was released — target it on your next message to re-seat it. Partial reply before the cut:\nstep 1…",
      });
    });
    expect(chip('claude').dataset['state']).toBe('failed');
    expect(chip('claude')).toHaveTextContent(/exceeded the 600 s turn budget/);
    // Nothing is warm any more — but the chat is NOT re-armed (that would mint a new open);
    // the evicted seat is a chip, and naming it in `targets` is the re-seat.
    await user.type(screen.getByRole('textbox'), 'continue');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    expect(openChat, 'an eviction must not re-open the chat').toHaveBeenCalledTimes(1);
    expect(sendChatMessage).toHaveBeenLastCalledWith(chatId(), 'continue', ['claude']);
    // The re-seated seat is WORKING again — its stale eviction no longer speaks.
    expect(chip('claude').dataset['state']).toBe('working');
    // The refused seat stays refused: greyed, with the daemon's reason, never targeted.
    expect(chip('codex').dataset['state']).toBe('failed');
  });

  it('a seat whose SESSION died mid-chat (chatSessionFailed) stays a chip and is re-seated by the next send', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-none'));
    await sendText(user, 'one');
    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'a', ok: true });
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'codex', text: 'b', ok: true });
      emit!({ type: 'chatSessionFailed', chat: chatId(), cliKey: 'codex', reason: 'the bridge dropped' });
    });
    expect(chip('codex').dataset['state']).toBe('failed');
    await user.type(screen.getByRole('textbox'), 'two');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    const [, , targets] = sendChatMessage.mock.calls[1] as [string, string, string[]];
    expect([...targets].sort(), 'a dropped session is not a refusal — it is named so the engine re-warms it').toEqual(['claude', 'codex']);
    expect(chip('codex').dataset['state']).toBe('working');
    expect(openChat).toHaveBeenCalledTimes(1);
  });

  it('a warm audience is sent explicitly too — `targets` names every seat chip (the engine re-seats a missing one)', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-none'));
    await sendText(user, 'one');
    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'a', ok: true });
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'codex', text: 'b', ok: true });
    });
    await user.type(screen.getByRole('textbox'), 'two');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    const [, , targets] = sendChatMessage.mock.calls[1] as [string, string, string[]];
    expect([...targets].sort()).toEqual(['claude', 'codex']);
  });
});

describe('DES-L5 §4 — `chatReply.usage` renders as the bubble’s footer', () => {
  it('a reply with usage shows `in · out · $`; `costUsd: null` drops the price; `usage: null` shows nothing', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-none'));
    await sendText(user, 'cost me');
    act(() => {
      emit!({
        type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'sure', ok: true,
        usage: { inputTokens: 12300, outputTokens: 800, cacheReadTokens: 5000, cacheCreationTokens: 0, costUsd: 0.04 },
      });
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'codex', text: 'also sure', ok: true, usage: null });
    });
    const footers = screen.getAllByTestId('seat-usage');
    expect(footers).toHaveLength(1);
    expect(footers[0]!.textContent).toBe('12.3k in · 800 out · $0.04');
    expect(footers[0]!.title).toContain('cache read 5000');
    const codexBubble = document.querySelector('[data-testid="seat-bubble"][data-agent="codex"]') as HTMLElement;
    expect(codexBubble.querySelector('[data-testid="seat-usage"]')).toBeNull();
  });
});
