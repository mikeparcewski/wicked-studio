import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { CoreEvent, RosterSeat } from '../src/api/types.js';
import type { AssistVerbs, ChatHistoryLoader } from '../src/components/AssistDock.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';

/**
 * The chat window (AssistDock `variant="window"`, the system chat's own window) folds what the session page folds:
 *  - studio#1369: the daemon's citation verdicts (`chatCitations` live, `citations` transcript records replayed) mark
 *    the reply inline and add the reply's citation strip, so an unverified SHA never reads as verified;
 *  - studio#1370: a reply is labelled with the helper's roster name, and a helper the engine gave up on (a re-pick or
 *    a failed answer step) leaves one line saying who could not answer, why, and who answers instead — never a
 *    bubble stuck on "…".
 *
 * Fixtures copy the daemon's writers (wicked-crew `packages/crew/src/api/…`):
 *  - the `chatCitations` frame: `chat-citations.ts:810-833` (`citationsFrame`), its items as `:631` (a verified SHA)
 *    and `:663-669` (an unverified SHA) push them;
 *  - the transcript's `citations` record: `chat-transcripts.ts:266-276`;
 *  - the `teamEvent` frame: `team/ws-relay.ts` (`{ type: 'teamEvent', event: <bus row> }`), the `path.repicked` row
 *    as wicked-core `src/actor/team_gate.rs:361-375` publishes it (`from`, `to`, `reason`, `pick_seq`, `ord`,
 *    `attempt`) with the reasons `src/actor.rs:8702-8709` passes.
 */

const getChat = vi.fn();

vi.mock('../src/api/diagnostics.js', () => ({
  getDiagnostics: () => Promise.resolve({ components: { coreTs: '0.7.27' } }),
  isDiagnosticsUnsupported: () => false,
}));

vi.mock('../src/api/client.js', () => ({
  api: {
    getChat: (...a: unknown[]) => getChat(...a),
    getRun: () => Promise.reject(new Error('no run snapshot in this rig')),
    confirmGate: vi.fn(),
    cancelRun: vi.fn(),
  },
  apiFetch: vi.fn(() => Promise.reject(new Error('no wire in this rig'))),
}));

// The chat block's event-stream fold (the newest render's handler, as the real hook keeps it).
let handler: ((ev: CoreEvent) => void) | null = null;
vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: (h: (ev: CoreEvent) => void) => {
    handler = h;
  },
}));
const emit = (f: Record<string, unknown>): void => {
  act(() => {
    handler?.(f as unknown as CoreEvent);
  });
};

const { AssistDock } = await import('../src/components/AssistDock.js');

const ROSTER = [
  { key: 'opencode', display_name: 'OpenCode', binary: 'opencode' },
  { key: 'claude', display_name: 'Claude Code', binary: 'claude' },
  { key: 'codex', display_name: 'Codex', binary: 'codex' },
] as unknown as RosterSeat[];

function windowDock(v: AssistVerbs, extra: { resumeChatId?: string; loadHistory?: ChatHistoryLoader } = {}): void {
  render(
    <AssistDock
      context={{ surface: 'ask', title: 'Chat', contextLabel: 'Everything', placeholder: 'Ask…' }}
      verbs={v}
      open
      onOpenChange={() => undefined}
      variant="window"
      {...extra}
    />,
  );
}

async function ask(text: string): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.type(screen.getByTestId('assist-input'), text);
  await user.click(screen.getByTestId('assist-send'));
  return screen.findByTestId('assist-chat');
}

/** Let the chat's path read (its run id) land. */
const settle = async (): Promise<void> => {
  await waitFor(() => expect(getChat).toHaveBeenCalled());
  for (let i = 0; i < 3; i += 1) await act(async () => { await Promise.resolve(); });
};

const seatBubbles = (): HTMLElement[] => screen.getAllByTestId('assist-chat-msg').filter((m) => m.getAttribute('data-agent') !== 'you');

// The daemon's frame for one reply: a verified SHA and a fabricated one (chat-citations.ts:631, :663-669, :810-833).
const CITATIONS = {
  verified: 1,
  unverifiable: 1,
  corrected: 0,
  unchecked: 0,
  items: [
    { raw: '3f1a93b', kind: 'sha', status: 'verified', resolved: 'tiny-math-t12' },
    { raw: '6d77153', kind: 'sha', status: 'unverified', note: "no such commit in any repo in this chat's scope" },
  ],
};
const ANSWER = 'The loop landed in `3f1a93b`; the off-by-one came in `6d77153`.';

beforeEach(() => {
  cleanup();
  handler = null;
  getChat.mockReset();
  getChat.mockResolvedValue({ chatId: 'chat-1', seats: ['opencode', 'claude', 'codex'], path: { runId: 'run-1', pa: 'opencode' } });
  clearCachedRoster();
  setCachedRoster(ROSTER);
  useCapabilities.setState({ loaded: true, askPath: true });
  try { localStorage.clear(); } catch { /* stubbed */ }
});

describe('studio#1369 — the chat window marks citations like the session page', () => {
  it('a live chatCitations frame marks the unverified SHA inline and adds the strip', async () => {
    windowDock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1', turnId: 't1' }) });
    await ask('where did the bug come from?');
    emit({ type: 'chatReply', chat: 'chat-1', cliKey: 'claude', text: ANSWER, ok: true, turn_id: 't1' });
    emit({ type: 'chatCitations', chat: 'chat-1', cliKey: 'claude', turn_id: 't1', ...CITATIONS });

    const reply = seatBubbles()[0]!;
    const marks = within(reply).getAllByTestId('citation-mark');
    expect(marks.map((m) => [m.getAttribute('data-raw'), m.getAttribute('data-status')])).toEqual([['6d77153', 'unverified']]);
    expect(marks[0]).toHaveTextContent('UNVERIFIED');
    const strip = within(reply).getByTestId('seat-citations');
    expect(strip).toHaveAttribute('data-unverifiable', '1');
    expect(within(reply).getByTestId('seat-citations-toggle')).toHaveTextContent('Citations: 1 verified · 1 unverifiable');
    expect(within(strip).getByTestId('citation-flag')).toHaveTextContent('6d77153 UNVERIFIED');
    // Mark, never edit: the seat's words are all still there.
    expect(reply).toHaveTextContent('The loop landed in 3f1a93b');
  });

  it('a frame for another turn or another seat marks nothing', async () => {
    windowDock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1', turnId: 't1' }) });
    await ask('where did the bug come from?');
    emit({ type: 'chatReply', chat: 'chat-1', cliKey: 'claude', text: ANSWER, ok: true, turn_id: 't1' });
    emit({ type: 'chatCitations', chat: 'chat-1', cliKey: 'claude', turn_id: 't0', ...CITATIONS });
    emit({ type: 'chatCitations', chat: 'chat-1', cliKey: 'codex', turn_id: 't1', ...CITATIONS });
    emit({ type: 'chatCitations', chat: 'other', cliKey: 'claude', turn_id: 't1', ...CITATIONS });
    expect(screen.queryByTestId('citation-mark')).toBeNull();
    expect(screen.queryByTestId('seat-citations')).toBeNull();
  });

  it('a replayed chat folds its transcript citations record onto the reply', async () => {
    const loadHistory: ChatHistoryLoader = vi.fn().mockResolvedValue({
      closed: true,
      records: [
        { at: 1, turnId: 't1', kind: 'user', text: 'where did the bug come from?', seats: ['claude'] },
        { at: 2, turnId: 't1', kind: 'seat', cliKey: 'claude', text: ANSWER, ok: true, usage: null },
        // chat-transcripts.ts:266-276
        { at: 3, turnId: 't1', kind: 'citations', cliKey: 'claude', ...CITATIONS },
      ],
    });
    windowDock({ send: vi.fn() }, { resumeChatId: 'chat-1', loadHistory });
    await waitFor(() => expect(screen.getAllByTestId('assist-chat-msg')).toHaveLength(2));
    const reply = seatBubbles()[0]!;
    expect(within(reply).getByTestId('citation-mark')).toHaveAttribute('data-status', 'unverified');
    expect(within(reply).getByTestId('citation-mark')).toHaveTextContent('UNVERIFIED');
    expect(within(reply).getByTestId('seat-citations')).toHaveAttribute('data-unverifiable', '1');
  });
});

describe('studio#1370 — names, and a helper that could not answer', () => {
  it('labels a reply with the roster name, never the raw key', async () => {
    windowDock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1', turnId: 't1' }) });
    await ask('q');
    emit({ type: 'chatReply', chat: 'chat-1', cliKey: 'claude', text: 'An answer.', ok: true, turn_id: 't1' });
    expect(within(seatBubbles()[0]!).getByTestId('assist-chat-msg-who')).toHaveTextContent(/^Claude Code$/);
  });

  it('a re-pick closes the abandoned bubble with who could not answer, why, and who answers instead', async () => {
    windowDock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1', turnId: 't1' }) });
    await ask('what does sum return?');
    // The chat's path (its run) is read once the block mounts.
    await settle();
    emit({ type: 'chatDelta', chat: 'chat-1', cliKey: 'opencode', text: 'dependencies: checking the worktree', turn_id: 't1' });
    expect(seatBubbles()[0]).toHaveAttribute('data-pending', 'true');

    emit({ type: 'teamEvent', event: { event_id: 41, event_type: 'wicked.team.path.repicked', emitted_at: 5, payload: { run_id: 'run-1', ord: 1, attempt: 0, from: 'opencode', to: 'claude', reason: 'timed_out', selection: 'random', pick_seq: 1 } } });
    // No bubble is left waiting; one line says what happened.
    expect(screen.queryAllByTestId('assist-chat-msg').filter((m) => m.getAttribute('data-pending') === 'true')).toHaveLength(0);
    const lines = screen.getAllByTestId('assist-seat-line');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent('OpenCode could not answer: it did not answer in time. Claude Code answers instead.');

    // The retired helper's late frames are not a bubble.
    emit({ type: 'chatDelta', chat: 'chat-1', cliKey: 'opencode', text: ' late', turn_id: 't1' });
    emit({ type: 'chatReply', chat: 'chat-1', cliKey: 'opencode', text: 'late', ok: false, turn_id: 't1' });
    expect(screen.queryAllByTestId('assist-chat-msg').filter((m) => m.getAttribute('data-agent') === 'opencode')).toHaveLength(0);

    // Claude Code is re-picked too (signed out); Codex answers.
    emit({ type: 'chatDelta', chat: 'chat-1', cliKey: 'claude', text: 'Looking', turn_id: 't1' });
    emit({ type: 'teamEvent', event: { event_id: 42, event_type: 'wicked.team.step.completed', emitted_at: 6, payload: { run_id: 'run-1', ord: 1, attempt: 1, by: 'claude', step_id: 'answer-1', status: 'failed' } } });
    emit({ type: 'teamEvent', event: { event_id: 43, event_type: 'wicked.team.path.repicked', emitted_at: 7, payload: { run_id: 'run-1', ord: 1, attempt: 1, from: 'claude', to: 'codex', reason: 'not_logged_in', selection: 'random', pick_seq: 2 } } });
    emit({ type: 'chatReply', chat: 'chat-1', cliKey: 'codex', text: 'sum([1,2,3]) returns 5.', ok: true, turn_id: 't1' });
    const after = screen.getAllByTestId('assist-seat-line').map((l) => l.textContent);
    expect(after).toEqual([
      '· OpenCode could not answer: it did not answer in time. Claude Code answers instead.',
      '· Claude Code could not answer: it is not signed in. Codex answers instead.',
    ]);
    expect(seatBubbles().map((m) => [m.getAttribute('data-agent'), m.getAttribute('data-pending')])).toEqual([['codex', 'false']]);
  });

  it('a failed answer step with no re-pick closes the bubble and says why', async () => {
    windowDock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1', turnId: 't1' }) });
    await ask('q');
    await settle();
    emit({ type: 'chatDelta', chat: 'chat-1', cliKey: 'opencode', text: 'Hm', turn_id: 't1' });
    emit({ type: 'teamEvent', event: { event_id: 50, event_type: 'wicked.team.step.completed', emitted_at: 5, payload: { run_id: 'run-1', ord: 1, attempt: 0, by: 'opencode', step_id: 'answer-1', status: 'timed_out' } } });
    expect(screen.queryAllByTestId('assist-chat-msg').filter((m) => m.getAttribute('data-pending') === 'true')).toHaveLength(0);
    expect(screen.getByTestId('assist-seat-line')).toHaveTextContent('OpenCode could not answer: it did not answer in time.');
    // Another run's rows are not this chat's.
    emit({ type: 'teamEvent', event: { event_id: 51, event_type: 'wicked.team.path.repicked', emitted_at: 6, payload: { run_id: 'run-other', ord: 1, attempt: 0, from: 'claude', to: 'codex', reason: 'failed', pick_seq: 1 } } });
    expect(screen.getAllByTestId('assist-seat-line')).toHaveLength(1);
  });

  it('a re-pick that lands before the chat names its run is still told once the run is known', async () => {
    let resolvePath: (v: unknown) => void = () => undefined;
    getChat.mockReturnValueOnce(new Promise((r) => { resolvePath = r; }));
    windowDock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1', turnId: 't1' }) });
    await ask('q');
    emit({ type: 'chatDelta', chat: 'chat-1', cliKey: 'opencode', text: 'Hm', turn_id: 't1' });
    emit({ type: 'teamEvent', event: { event_id: 60, event_type: 'wicked.team.path.repicked', emitted_at: 5, payload: { run_id: 'run-1', ord: 1, attempt: 0, from: 'opencode', to: 'codex', reason: 'quota_exhausted', pick_seq: 1 } } });
    expect(screen.queryByTestId('assist-seat-line')).toBeNull();
    await act(async () => { resolvePath({ chatId: 'chat-1', seats: ['opencode', 'codex'], path: { runId: 'run-1', pa: 'opencode' } }); });
    await waitFor(() => expect(screen.getByTestId('assist-seat-line')).toHaveTextContent('OpenCode could not answer: it has run out of usage. Codex answers instead.'));
  });
});

describe('studio#1370 — a helper whose session failed mid-reply', () => {
  it('closes its half-typed bubble with a line instead of leaving it on "…"', async () => {
    windowDock({ send: vi.fn().mockResolvedValue({ chatId: 'chat-1', turnId: 't1' }) });
    await ask('q');
    emit({ type: 'chatDelta', chat: 'chat-1', cliKey: 'claude', text: 'Looking at', turn_id: 't1' });
    emit({ type: 'chatSessionFailed', chat: 'chat-1', cliKey: 'claude', reason: 'session died' });
    expect(screen.queryAllByTestId('assist-chat-msg').filter((m) => m.getAttribute('data-pending') === 'true')).toHaveLength(0);
    expect(screen.getByTestId('assist-seat-line')).toHaveTextContent('Claude Code could not answer: its session ended.');
  });
});
