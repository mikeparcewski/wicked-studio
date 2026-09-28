// W2-S4 (studio#238, studio#277) — the chat surface carries the whole conversation into Build,
// states each seat's grounding and totals what the chat cost.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChat } from '../src/components/GroupChat.js';
import { peekRetryPrefill, clearRetryPrefill } from '../src/store/retryPrefill.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { useGateStore } from '../src/store/gates.js';
import { useElicitationStore } from '../src/store/elicitations.js';
import type { RosterSeat } from '../src/api/types.js';

const openChat = vi.fn();
const getChat = vi.fn();
const closeChat = vi.fn();
const getRoster = vi.fn();
const sendChatMessage = vi.fn();
const reseatChat = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    closeChat: (...a: unknown[]) => closeChat(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    reseatChat: (...a: unknown[]) => reseatChat(...a),
    confirmGate: vi.fn(),
    cancelRun: vi.fn(),
  },
  wsBase: () => 'ws://localhost',
}));

// The E4 guard reads the daemon's engine version once a chat is live (review MED-2): unknown ⇒
// guarded, so these tests state the engine they are talking to instead of inheriting a default.
const getDiagnostics = vi.fn();
vi.mock('../src/api/diagnostics.js', () => ({
  getDiagnostics: (...a: unknown[]) => getDiagnostics(...a),
  isDiagnosticsUnsupported: () => false,
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
  for (const spy of [openChat, getChat, closeChat, getRoster, sendChatMessage, reseatChat, getDiagnostics]) spy.mockReset();
  // Default: an engine that sends the ANSWER (core-ts ≥ 0.7.27, F-W1-004).
  getDiagnostics.mockResolvedValue({ components: { coreTs: '0.7.27' } });
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


describe('studio#238 — Continue in Build carries the WHOLE conversation', () => {
  it('a transcript far past 6 KB rides in full: the first question and the first answer included', async () => {
    clearRetryPrefill();
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<GroupChat repoId={null} onBack={() => undefined} navigate={navigate} />);
    fireEvent.click(screen.getByTestId('chat-scope-system'));
    await sendText(user, 'where does the ledger live');
    const first = `FIRST-ANSWER ${'x'.repeat(5000)}`;
    const second = `SECOND-ANSWER ${'y'.repeat(5000)}`;
    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: first, ok: true, usage: null });
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'codex', text: second, ok: true, usage: null });
    });
    await user.click(screen.getByTestId('chat-promote'));
    const problem = peekRetryPrefill()!.problem;
    expect(problem).toContain('operator: where does the ledger live');
    expect(problem).toContain(`claude: ${first}`);
    expect(problem).toContain(`codex: ${second}`);
    expect(problem).not.toMatch(/---\n…/);
  });
});

describe('studio#277 — each seat states its grounding; the header totals the cost', () => {
  const scopeOf = (bound: boolean) => ({
    kind: 'project', projectId: 'p1', repos: [{ id: 'r1', name: 'crew', rootPath: '/r/crew' }], cwd: '/scratch', dangling: [],
    graph: { bound, reason: bound ? 'project graph' : 'not-indexed' },
  });

  it('a graph-bound chat: every warm seat chip says grounded', async () => {
    openChat.mockImplementation((body: { chatId: string; clis?: string[] }) =>
      Promise.resolve({
        chatId: body.chatId,
        seats: (body.clis ?? ['claude', 'codex']).map((cliKey) => ({ cliKey, ok: true })),
        scope: scopeOf(true),
      }),
    );
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system'));
    await sendText(user, 'q');
    await waitFor(() => expect(chip('claude').querySelector('[data-testid="seat-grounding"]')?.textContent).toBe('grounded'));
    expect(chip('codex').querySelector('[data-testid="seat-grounding"]')?.textContent).toBe('grounded');
  });

  it('an ungrounded chat says ungrounded on each chip, with the reason on hover', async () => {
    openChat.mockImplementation((body: { chatId: string; clis?: string[] }) =>
      Promise.resolve({
        chatId: body.chatId,
        seats: (body.clis ?? ['claude', 'codex']).map((cliKey) => ({ cliKey, ok: true })),
        scope: scopeOf(false),
      }),
    );
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system'));
    await sendText(user, 'q');
    await waitFor(() => expect(chip('claude').querySelector('[data-testid="seat-grounding"]')?.textContent).toBe('ungrounded'));
    expect((chip('claude').querySelector('[data-testid="seat-grounding"]') as HTMLElement).title).toMatch(/^No code graph for this chat/);
  });

  it('the header totals the priced replies and counts the unmetered ones', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system'));
    await sendText(user, 'cost me');
    act(() => {
      emit!({
        type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'sure', ok: true,
        usage: { inputTokens: 100, outputTokens: 10, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: 0.04 },
      });
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'codex', text: 'also', ok: true, usage: null });
    });
    expect(screen.getByTestId('chat-cost-total').textContent).toBe('$0.04 so far · 1 unmetered');
    const codexBubble = document.querySelector('[data-testid="seat-bubble"][data-agent="codex"]') as HTMLElement;
    expect(codexBubble.querySelector('[data-testid="seat-usage"]')?.textContent).toBe('unmetered');
  });
});
