// DES-RUN-NARRATOR §11 — the narrator comes to the CHAT surface (the user's
// overrule of the original out-of-scope line: "what I see is still the outputs
// from the individual agents and not the narrative piece"). Pinned here:
//
//   - §11.1 classification IN THE DOM: the user's message stays a first-class
//     turn; a seat's still-streaming worker output collapses into a narration
//     line (seat chip + status), with the raw stream mounted behind an
//     expander; a short ok reply lands as a conversational turn; an over-long
//     reply stays collapsed;
//   - §11.2 ordering: out-of-order arrival renders chronologically (per-seat
//     FIFO keeps a late turn-1 reply in its turn-1 position);
//   - §11.4 the pinned now-bar: state, seat census, latest narration, the
//     artifacts chip, jump-to-latest — outside the scroll region;
//   - §11.5 the pinned approval dock: a gate keyed by the CHAT session renders
//     as a structural sibling of the scroll region, and reject carries the
//     typed note on the wire from THIS surface;
//   - §11.6 the full transcript stays reachable behind the view toggle.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChat } from '../src/components/GroupChat.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { useGateStore } from '../src/store/gates.js';
import { useElicitationStore } from '../src/store/elicitations.js';
import type { RosterSeat } from '../src/api/types.js';

const openChat = vi.fn();
const getChat = vi.fn();
const closeChat = vi.fn();
const getRoster = vi.fn();
const sendChatMessage = vi.fn();
const confirmGate = vi.fn();
const cancelRun = vi.fn();
const getCoverageReportForRepo = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    closeChat: (...a: unknown[]) => closeChat(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    confirmGate: (...a: unknown[]) => confirmGate(...a),
    cancelRun: (...a: unknown[]) => cancelRun(...a),
    getCoverageReportForRepo: (...a: unknown[]) => getCoverageReportForRepo(...a),
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
  for (const spy of [openChat, getChat, closeChat, getRoster, sendChatMessage, confirmGate, cancelRun, getCoverageReportForRepo]) {
    spy.mockReset();
  }
  getRoster.mockResolvedValue({ roster: ROSTER });
  openChat.mockImplementation((body: { chatId: string; clis?: string[] }) =>
    Promise.resolve({
      chatId: body.chatId,
      seats: (body.clis ?? ['claude', 'codex']).map((cliKey) => ({ cliKey, ok: true })),
    }),
  );
  sendChatMessage.mockResolvedValue({ seats: [] });
  confirmGate.mockResolvedValue({ ok: true });
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
  await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(chatId(), text));
}

const rawWrapper = (index: number): HTMLElement | null =>
  document.querySelector(`[data-testid="chat-narration-raw-${index}"]`);

describe('§11.1 — narration vs conversation in the DOM', () => {
  it('user turn stays a turn; a streaming worker output collapses to narration with the raw stream behind the expander', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'what needs fixing?');

    // The user's message is a first-class bubble.
    expect(screen.getByTestId('user-bubble')).toHaveTextContent('what needs fixing?');

    act(() => {
      emit!({ type: 'chatDelta', chat: chatId(), cliKey: 'claude', text: 'raw tool chatter '.repeat(20) });
    });

    // The PRIMARY rendering of the stream is a narration line wearing the seat chip…
    const lines = screen.getAllByTestId('chat-narration-line');
    const streamLine = lines.find((l) => l.dataset['agent'] === 'claude' && l.textContent!.includes('is working'));
    expect(streamLine, 'streaming output must collapse to a narration line').toBeTruthy();
    // …and the raw bytes are mounted but hidden until the expander opens.
    const bubble = document.querySelector('[data-testid="seat-bubble"][data-agent="claude"]') as HTMLElement;
    const wrapper = bubble.closest('[data-testid^="chat-narration-raw-"]') as HTMLElement;
    expect(wrapper).toBeTruthy();
    expect(wrapper.style.display).toBe('none');
    expect(wrapper.textContent).toContain('raw tool chatter');

    const index = wrapper.getAttribute('data-testid')!.replace('chat-narration-raw-', '');
    await user.click(screen.getByTestId(`chat-narration-toggle-${index}`));
    expect(rawWrapper(Number(index))!.style.display).not.toBe('none');
  });

  it('a short ok reply becomes a first-class conversational turn; an over-long one stays narration', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'go');

    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'Done — two files changed.', ok: true });
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'codex', text: 'x'.repeat(3000), ok: true });
    });

    // claude's reply: a visible turn (no display:none ancestor wrapper).
    const claudeBubble = document.querySelector('[data-testid="seat-bubble"][data-agent="claude"]') as HTMLElement;
    expect(claudeBubble).toHaveTextContent('Done — two files changed.');
    expect(claudeBubble.closest('[data-testid^="chat-narration-raw-"]')).toBeNull();

    // codex's dump: still narration ("replied (3 KB)"), raw behind the expander.
    const lines = screen.getAllByTestId('chat-narration-line');
    expect(lines.some((l) => l.dataset['agent'] === 'codex' && /replied \(3 KB\)/.test(l.textContent!))).toBe(true);
    const codexBubble = document.querySelector('[data-testid="seat-bubble"][data-agent="codex"]') as HTMLElement;
    expect(codexBubble.closest('[data-testid^="chat-narration-raw-"]')).not.toBeNull();
  });

  it('a failed reply collapses to fail-tone narration', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'go');
    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'model refused', ok: false });
    });
    const lines = screen.getAllByTestId('chat-narration-line');
    expect(lines.some((l) => l.dataset['tone'] === 'fail' && l.textContent!.includes('failed — model refused'))).toBe(true);
  });

  it('seat lifecycle is narration: joined-the-chat lines carry the seat chip', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'hello');
    const seats = screen.getAllByTestId('chat-narration-seat').map((s) => s.textContent);
    expect(seats).toContain('claude');
    expect(seats).toContain('codex');
    expect(screen.getAllByText('joined the chat').length).toBe(2);
  });
});

describe('§11.2 — out-of-order arrival renders chronologically', () => {
  it('a turn-1 reply finalizing after turn 2 opened stays BEFORE the turn-2 user bubble', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'first ask');
    await user.type(screen.getByRole('textbox'), 'second ask');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));

    // Turn 1's reply lands LAST on the wire — after turn 2's user message.
    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'answer to the FIRST ask', ok: true });
    });

    const reply = document.querySelector('[data-testid="seat-bubble"][data-agent="claude"][data-turn="1"]') as HTMLElement;
    expect(reply).toHaveTextContent('answer to the FIRST ask');
    const secondAsk = screen.getAllByTestId('user-bubble').find((b) => b.dataset['turn'] === '2')!;
    // DOM order: the reply PRECEDES the second ask — chronological by source,
    // not by arrival.
    expect(reply.compareDocumentPosition(secondAsk) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('§11.4 — the pinned now-bar', () => {
  it('says working while a reply streams, your turn when the crew is done, and jumps to the tail', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'go');

    expect(screen.getByTestId('now-bar-status')).toHaveTextContent('working');
    expect(screen.getByTestId('now-bar-phase')).toHaveTextContent('2 of 2 agents replying');

    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'ok', ok: true });
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'codex', text: 'ok', ok: true });
    });
    expect(screen.getByTestId('now-bar-status')).toHaveTextContent('your turn');
    expect(screen.getByTestId('now-bar-phase')).toHaveTextContent('2 agents ready');
    expect(screen.getByTestId('now-bar-narration')).toHaveTextContent(/replied/);

    // The now-bar sits OUTSIDE the one scrolling region; the jump targets it.
    const thread = screen.getByTestId('chat-thread');
    expect(thread.contains(screen.getByTestId('now-bar'))).toBe(false);
    await user.click(screen.getByTestId('now-bar-jump')); // no throw = wired
  });

  it('collects the artifacts replies name into the chip, and renders inline cards', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'go');
    act(() => {
      emit!({
        type: 'chatReply', chat: chatId(), cliKey: 'claude',
        text: 'Wrote `src/retry.ts` — see https://github.com/x/y/pull/7', ok: true,
      });
    });
    const cards = screen.getAllByTestId('artifact-card');
    expect(cards.map((c) => c.getAttribute('data-artifact-kind'))).toEqual(['file', 'pr']);
    expect(cards[0]).toHaveTextContent('retry.ts');
    expect(screen.getByTestId('now-bar-artifacts')).toHaveTextContent('2');
  });
});

describe('§11.5 — the pinned approval dock, answerable from the chat surface', () => {
  it('a gate keyed by the chat session renders as a SIBLING of the scroll region, and reject carries the typed note', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'go');

    act(() => {
      useGateStore.setState({
        gates: { [chatId()]: { runId: chatId(), ord: 1, prompt: 'Approve the plan?', lifecycle: 'open', receivedAt: 0 } },
        approaching: {},
      });
    });

    const dock = screen.getByTestId('approval-dock');
    const gate = screen.getByTestId('steering-gate');
    const thread = screen.getByTestId('chat-thread');
    expect(dock.contains(gate)).toBe(true);
    // Structure-level pinning: the dock is NOT inside the scroll region, so no
    // amount of transcript growth can push the approval offscreen.
    expect(thread.contains(dock)).toBe(false);
    expect(dock.contains(thread)).toBe(false);
    expect(thread.className).toContain('overflow-y-auto');
    expect(dock.className).not.toContain('overflow-y-auto');

    await user.type(screen.getByTestId('steering-amend'), 'not like this — keep the queue');
    await user.click(screen.getByTestId('steering-reject'));
    await waitFor(() =>
      expect(confirmGate).toHaveBeenCalledWith(chatId(), {
        approve: false,
        amend: 'not like this — keep the queue',
      }),
    );
  });

  it('an open elicitation docks the same way', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'go');
    act(() => {
      useElicitationStore.getState().setElicitation({
        runId: chatId(),
        elicitationId: 'e1',
        message: 'Which database?',
        options: ['postgres', 'sqlite'],
        receivedAt: new Date().toISOString(),
      });
    });
    const dock = screen.getByTestId('approval-dock');
    expect(dock).toHaveTextContent('Which database?');
    expect(screen.getByTestId('chat-thread').contains(dock)).toBe(false);
  });

  it('the chat-keyed gate and elicitation SURVIVE the run-list reconcile (a chat id is never in GET /runs)', async () => {
    // The live-daemon defect this pins: `awaitingHuman` mounts the dock, the
    // frame bumps the run refresh, and ~400ms later `reconcile()` — fed only
    // run ids — swept gates[chatId], unmounting the dock mid-decision.
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'go');

    act(() => {
      useGateStore.setState({
        gates: { [chatId()]: { runId: chatId(), ord: 1, prompt: 'Approve?', lifecycle: 'open', receivedAt: 0 } },
        approaching: {},
      });
      useElicitationStore.getState().setElicitation({
        runId: chatId(),
        elicitationId: 'e9',
        message: 'Which database?',
        options: null,
        receivedAt: new Date().toISOString(),
      });
    });
    expect(screen.getByTestId('approval-dock')).toBeInTheDocument();

    // The run-universe prune, exactly as useRuns fires it — no run is awaiting,
    // and the chat id is not a run.
    act(() => {
      useGateStore.getState().reconcile([]);
      useElicitationStore.getState().reconcile(['some-other-run']);
    });
    expect(useGateStore.getState().gates[chatId()]).toBeDefined();
    expect(useElicitationStore.getState().elicitations[chatId()]).toBeDefined();
    expect(screen.getByTestId('approval-dock')).toBeInTheDocument();
    expect(screen.getByTestId('steering-gate')).toBeInTheDocument();

    // An UNPINNED id (a genuinely stale run gate) is still swept — the
    // self-healing prune is intact for the run universe.
    act(() => {
      useGateStore.setState({
        gates: {
          ...useGateStore.getState().gates,
          'stale-run': { runId: 'stale-run', ord: 0, prompt: 'x', lifecycle: 'open', receivedAt: 0 },
        },
        approaching: {},
      });
      useGateStore.getState().reconcile([]);
    });
    expect(useGateStore.getState().gates['stale-run']).toBeUndefined();
    expect(useGateStore.getState().gates[chatId()]).toBeDefined();
  });

  it('renders no dock when nothing awaits the human', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'go');
    expect(screen.queryByTestId('approval-dock')).not.toBeInTheDocument();
  });
});

describe('§11.6 — the full transcript stays reachable', () => {
  it('the view toggle swaps narration for the old bubbles and back, zero requests', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'go');
    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'y'.repeat(3000), ok: true });
    });

    // Narrated (default): the dump is a narration line.
    expect(screen.getAllByTestId('chat-narration-line').length).toBeGreaterThan(0);

    const calls = (): number =>
      openChat.mock.calls.length + getChat.mock.calls.length + getRoster.mock.calls.length +
      sendChatMessage.mock.calls.length;
    const before = calls();
    await user.click(screen.getByTestId('chat-view-full'));
    // Full: no narration lines; the raw bubble is a plain visible row.
    expect(screen.queryByTestId('chat-narration-line')).toBeNull();
    const bubble = document.querySelector('[data-testid="seat-bubble"][data-agent="claude"]') as HTMLElement;
    expect(bubble.closest('[data-testid^="chat-narration-raw-"]')).toBeNull();
    expect(calls()).toBe(before);
    // The preference persists per-session; narrated comes back on demand.
    expect(sessionStorage.getItem('wicked.chat.view')).toBe('full');
    await user.click(screen.getByTestId('chat-view-narrated'));
    expect(screen.getAllByTestId('chat-narration-line').length).toBeGreaterThan(0);
  });

  it('picking a layout arrangement implies the full transcript', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await sendText(user, 'go');
    act(() => {
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'claude', text: 'a', ok: true });
      emit!({ type: 'chatReply', chat: chatId(), cliKey: 'codex', text: 'b', ok: true });
    });
    await user.click(screen.getByTestId('chat-layout-columns'));
    expect(screen.getByTestId('chat-view-toggle').getAttribute('data-view')).toBe('full');
    expect(screen.getAllByTestId('chat-round-grid').length).toBeGreaterThan(0);
  });
});
