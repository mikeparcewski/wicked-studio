// DES-FEEDBACK-002 §6 (slice K) — the chat grid/columns toggle.
//
// Operator: "GroupChat grid/columns toggle: side-by-side comparison when
// multiple agents reply to the same prompt." These pin the §6.5 ACs:
//   - the GROUPING RULE (§6.1): a round = one user message + every seat message
//     before the next user message — 2 and 3 sibling replies group; interleaved
//     non-siblings (replies to different prompts) stay in separate rounds;
//   - the toggle is present only with ≥2 distinct replying seats, absent with 1;
//   - columns mode renders chat-round / chat-round-grid with data-columns=N and
//     STABLE per-seat column indexes across rounds; a seat absent from a round
//     renders chat-cell-empty (absence is information, §6.2);
//   - toggling fires ZERO network requests (C1) and keeps the composer's draft;
//   - the choice persists per-session (sessionStorage), never a crew setting.
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  GroupChat, groupRounds, seatColumnOrder, type Msg,
} from '../src/components/GroupChat.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import type { RosterSeat } from '../src/api/types.js';

const openChat = vi.fn();
const getChat = vi.fn();
const closeChat = vi.fn();
const getRoster = vi.fn();
const sendChatMessage = vi.fn();
const listProjects = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    closeChat: (...a: unknown[]) => closeChat(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    listProjects: (...a: unknown[]) => listProjects(...a),
  },
  wsBase: () => 'ws://localhost',
}));

/** Capture the event-stream fold so tests can land chat frames like /ws would. */
let streamHandler: ((ev: unknown) => void) | null = null;
vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: (cb: (ev: unknown) => void) => { streamHandler = cb; },
}));

const ALL_SPIES = { openChat, getChat, closeChat, getRoster, sendChatMessage, listProjects };

function user(text: string): Msg { return { kind: 'user', text }; }
function seat(cliKey: string, text = 'reply', pending = false): Msg {
  return { kind: 'seat', cliKey, text, pending, ok: !pending };
}

function apiCallCount(): number {
  return Object.values(ALL_SPIES).reduce((n, spy) => n + spy.mock.calls.length, 0);
}

beforeEach(() => {
  for (const spy of Object.values(ALL_SPIES)) spy.mockReset();
  sendChatMessage.mockResolvedValue({ seats: [] });
  sessionStorage.clear();
  clearCachedRoster();
  streamHandler = null;
});
afterEach(cleanup);

// ── The grouping rule, pure (§6.1) ───────────────────────────────────────────

describe('groupRounds — the §6.1 same-prompt grouping rule', () => {
  it('AC: 2 sibling replies to one prompt land in ONE round', () => {
    const rounds = groupRounds([user('p1'), seat('claude'), seat('codex')]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.user?.text).toBe('p1');
    expect(rounds[0]!.seats.map((s) => s.cliKey)).toEqual(['claude', 'codex']);
  });

  it('AC: 3 sibling replies land in ONE round, in arrival order', () => {
    const rounds = groupRounds([user('p1'), seat('claude'), seat('codex'), seat('agy')]);
    expect(rounds).toHaveLength(1);
    expect(rounds[0]!.seats.map((s) => s.cliKey)).toEqual(['claude', 'codex', 'agy']);
  });

  it('AC: interleaved NON-siblings stay linear — replies to different prompts never merge', () => {
    const rounds = groupRounds([
      user('p1'), seat('claude'), seat('codex'),
      user('p2'), seat('claude'),
      user('p3'), seat('codex'), seat('agy'),
    ]);
    expect(rounds).toHaveLength(3);
    expect(rounds[0]!.seats.map((s) => s.cliKey)).toEqual(['claude', 'codex']);
    expect(rounds[1]!.seats.map((s) => s.cliKey)).toEqual(['claude']);
    expect(rounds[2]!.seats.map((s) => s.cliKey)).toEqual(['codex', 'agy']);
  });

  it('column order is FIRST-SEEN and stable across rounds (§6.2)', () => {
    const order = seatColumnOrder([
      user('p1'), seat('codex'), seat('claude'),
      user('p2'), seat('claude'), seat('codex'), seat('agy'),
    ]);
    expect(order).toEqual(['codex', 'claude', 'agy']);
  });
});

// ── The component (§6.5) ─────────────────────────────────────────────────────

/** First send with the given chip set warmed; replies land via the stream fold. */
async function warmAndSend(prompt: string, seats: string[]): Promise<void> {
  openChat.mockResolvedValue({ seats: seats.map((k) => ({ cliKey: k, ok: true })) });
  const composer = screen.getByPlaceholderText(/Describe what you want/);
  await userEvent.type(composer, prompt);
  await userEvent.keyboard('{Enter}');
  await waitFor(() => expect(sendChatMessage).toHaveBeenCalled());
}

function landReply(cliKey: string, text: string): void {
  const chat = (openChat.mock.calls[0]?.[0] as { chatId: string }).chatId;
  act(() => { streamHandler?.({ type: 'chatReply', chat, cliKey, text, ok: true }); });
}

describe('GroupChat columns toggle (§6.5)', () => {
  it('AC: with 1 replying seat the toggle is ABSENT; with 2 it appears', async () => {
    setCachedRoster([{ key: 'solo' }] as unknown as RosterSeat[]);
    render(<GroupChat repoId="repo-1" onBack={() => {}} />);
    await warmAndSend('hello', ['solo']);
    expect(screen.queryByTestId('chat-layout-toggle')).toBeNull();
    cleanup();

    for (const spy of Object.values(ALL_SPIES)) spy.mockReset();
    sendChatMessage.mockResolvedValue({ seats: [] });
    setCachedRoster([{ key: 'claude' }, { key: 'codex' }] as unknown as RosterSeat[]);
    render(<GroupChat repoId="repo-2" onBack={() => {}} />);
    await warmAndSend('hello', ['claude', 'codex']);
    expect(screen.getByTestId('chat-layout-toggle')).toBeTruthy();
  });

  it('AC: columns mode renders rounds as grids — data-columns=3, stable column index, empty cell', async () => {
    setCachedRoster([{ key: 'claude' }, { key: 'codex' }, { key: 'agy' }] as unknown as RosterSeat[]);
    render(<GroupChat repoId="repo-3" onBack={() => {}} />);
    await warmAndSend('round one', ['claude', 'codex', 'agy']);
    landReply('claude', 'A1');
    landReply('codex', 'B1');
    landReply('agy', 'C1');
    // agy's seat dies (a real chatSessionFailed frame) — round 2's warm set shrinks.
    const chat = (openChat.mock.calls[0]?.[0] as { chatId: string }).chatId;
    act(() => {
      streamHandler?.({ type: 'chatSessionFailed', chat, cliKey: 'agy', reason: 'crashed' });
    });
    const composer = screen.getByPlaceholderText(/Describe what you want/);
    await userEvent.type(composer, 'round two');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));
    landReply('claude', 'A2');
    landReply('codex', 'B2');

    await userEvent.click(screen.getByTestId('chat-layout-columns'));
    const roundEls = screen.getAllByTestId('chat-round');
    expect(roundEls).toHaveLength(2);
    const grids = screen.getAllByTestId('chat-round-grid');
    expect(grids.map((g) => g.getAttribute('data-columns'))).toEqual(['3', '3']);
    // The same seat's cells share a column index across rounds (§6.2).
    const cellsOf = (grid: HTMLElement): (string | null)[] =>
      [...grid.children].map((c) => c.getAttribute('data-agent'));
    expect(cellsOf(grids[0]!)).toEqual(['claude', 'codex', 'agy']);
    expect(cellsOf(grids[1]!)).toEqual(['claude', 'codex', 'agy']);
    // Round 2's agy column is the dimmed EMPTY cell, not a collapsed column.
    const empty = screen.getAllByTestId('chat-cell-empty');
    expect(empty).toHaveLength(1);
    expect(empty[0]!.getAttribute('data-agent')).toBe('agy');
    expect(grids[1]!.contains(empty[0]!)).toBe(true);
    // A pending cell keeps the pulse: round 3, replies not yet landed.
    await userEvent.type(composer, 'round three');
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(3));
    expect(screen.getAllByText('thinking…').length).toBeGreaterThan(0);
  });

  it('AC: toggling fires ZERO requests, keeps the composer draft, and persists per-session', async () => {
    setCachedRoster([{ key: 'claude' }, { key: 'codex' }] as unknown as RosterSeat[]);
    render(<GroupChat repoId="repo-4" onBack={() => {}} />);
    await warmAndSend('prompt', ['claude', 'codex']);
    landReply('claude', 'A');
    landReply('codex', 'B');

    const composer = screen.getByPlaceholderText(/Describe what you want/) as HTMLTextAreaElement;
    await userEvent.type(composer, 'a draft in progress');
    const before = apiCallCount();
    await userEvent.click(screen.getByTestId('chat-layout-columns'));
    expect(screen.getByTestId('chat-layout-toggle').getAttribute('data-layout')).toBe('columns');
    await userEvent.click(screen.getByTestId('chat-layout-list'));
    await userEvent.click(screen.getByTestId('chat-layout-columns'));
    // C1: the toggle reads and re-arranges `messages` state only — zero requests.
    expect(apiCallCount()).toBe(before);
    // §6.5: the composer keeps its draft text across the switches.
    expect(composer.value).toBe('a draft in progress');
    // §6.2: a reading posture persisted per-session — sessionStorage, no settings write.
    expect(sessionStorage.getItem('wicked.chat.layout')).toBe('columns');
    // List mode is the untouched default rendering: switching back re-linearizes.
    await userEvent.click(screen.getByTestId('chat-layout-list'));
    expect(screen.queryByTestId('chat-round-grid')).toBeNull();
  });

  it('a stored columns preference survives a remount (per-session, §6.2)', async () => {
    sessionStorage.setItem('wicked.chat.layout', 'columns');
    setCachedRoster([{ key: 'claude' }, { key: 'codex' }] as unknown as RosterSeat[]);
    render(<GroupChat repoId="repo-5" onBack={() => {}} />);
    await warmAndSend('prompt', ['claude', 'codex']);
    expect(screen.getByTestId('chat-round-grid')).toBeTruthy();
  });
});
