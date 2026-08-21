import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChat } from '../src/components/GroupChat.js';

/**
 * FINDING-027 — the per-mount chat leak.
 *
 * A chat is a pool of warm CLI sessions costing ~520 MB apiece, deliberately outliving the page so
 * an operator can navigate away and come back. The component minted a fresh `crypto.randomUUID()`
 * on every effect fire, so every remount abandoned one — nothing on either side ever closed it, and
 * with no list endpoint nobody could find it again. Measured across one campaign: 19 seats warmed,
 * 2 chats ever closed, 4.10 GB reclaimed by hand.
 *
 * These tests pin the CONSEQUENCE (a second mount does not open a second chat), not the mechanism —
 * the exact remount trigger in production was never pinned down, and a fix keyed to one trigger
 * would leak on the next one.
 *
 * Slice 4 (DES-UXFIX-001 §2.4) moved warming behind the opt-ins (first send / "Add agents"), so a
 * bare mount no longer opens anything — each case below arms explicitly before it can leak. The
 * rejoin machinery these tests pin is otherwise verbatim.
 */

const openChat = vi.fn();
const getChat = vi.fn();
const closeChat = vi.fn();
const getRoster = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    closeChat: (...a: unknown[]) => closeChat(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    sendChatMessage: vi.fn(),
  },
  wsBase: () => 'ws://localhost',
}));

// The component subscribes to the daemon's event stream for seat/delta frames. None of these cases
// depend on a live socket, and opening one would make the suite time-dependent. The handler is
// captured rather than discarded so a test can deliver an exact frame at an exact moment — the
// stale-frame case below is about WHICH chat a frame is attributed to, which is unobservable
// without driving it directly.
let onFrame: ((ev: unknown) => void) | undefined;
vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: (cb: (ev: unknown) => void) => {
    onFrame = cb;
  },
}));

beforeEach(() => {
  openChat.mockReset();
  getChat.mockReset();
  closeChat.mockReset();
  getRoster.mockReset();
  getRoster.mockResolvedValue({ roster: [{ key: 'claude' }] });
  openChat.mockResolvedValue({ chatId: 'x', seats: [{ cliKey: 'claude', ok: true }] });
  closeChat.mockResolvedValue({ ok: true });
  sessionStorage.clear();
});

/** Arm the chat the way an operator does — the "Add agents" disclosure (§2.4). */
async function armViaAddAgents(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(await screen.findByTestId('add-agents'));
}

describe('GroupChat — chat reuse (FINDING-027)', () => {
  it('a remount rejoins the live chat instead of opening a second one', async () => {
    const user = userEvent.setup();
    // Mount 1: nothing stored and nothing warmed — the operator opts in, which mints and opens.
    const first = render(<GroupChat repoId="r1" onBack={() => undefined} />);
    await armViaAddAgents(user);
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const openedId = (openChat.mock.calls[0]?.[0] as { chatId: string }).chatId;
    expect(openedId).toBeTruthy();

    // The daemon still holds it.
    getChat.mockResolvedValue({ chatId: openedId, seats: ['claude'] });
    first.unmount();

    // Mount 2: the leak. Before the fix this opened a second chat and the first chat's
    // seats stayed warm forever, referenced by nobody.
    render(<GroupChat repoId="r1" onBack={() => undefined} />);
    await waitFor(() => expect(getChat).toHaveBeenCalledWith(openedId));
    await waitFor(() => expect(screen.getByTitle('ready')).toHaveTextContent('claude'));
    expect(openChat, 'a rejoin must not open a second chat').toHaveBeenCalledTimes(1);
  });

  it('a stored id the daemon has already reclaimed is discarded — back to first-run, not a re-mint', async () => {
    // The daemon reaps idle chats and enforces a pool cap, so a stored id is a claim and not a
    // fact. `chat_seats` answers an empty list for an unknown chat rather than erroring — which is
    // exactly the shape that would silently produce a dead-looking chat if trusted. Post-slice-4
    // the discard lands on the calm first-run state (§2.4): nothing re-warms until the user opts in.
    const user = userEvent.setup();
    sessionStorage.setItem('wicked.chat.r1', 'reclaimed-id');
    getChat.mockResolvedValue({ chatId: 'reclaimed-id', seats: [] });

    render(<GroupChat repoId="r1" onBack={() => undefined} />);
    await waitFor(() => expect(sessionStorage.getItem('wicked.chat.r1')).toBeNull());
    expect(openChat, 'a reclaimed id must not auto-mint a replacement').not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-firstrun')).toBeInTheDocument();

    // The next opt-in mints FRESH — never the reclaimed id.
    await armViaAddAgents(user);
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const openedId = (openChat.mock.calls[0]?.[0] as { chatId: string }).chatId;
    expect(openedId).not.toBe('reclaimed-id');
    expect(sessionStorage.getItem('wicked.chat.r1')).toBe(openedId);
  });

  it('each repo keeps its own chat, so a repo switch does not abandon one', async () => {
    // A prop change on ONE mounted component, not two renders: `repoId` is an effect dep, so a
    // switch re-runs the effect in place. Two separate mounts would exercise a different path and
    // would not catch state that fails to reset across the switch.
    const user = userEvent.setup();
    const { rerender } = render(<GroupChat repoId="r1" onBack={() => undefined} />);
    await armViaAddAgents(user);
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const idA = sessionStorage.getItem('wicked.chat.r1');

    // A different repo is a different conversation — switching lands on ITS first-run state
    // (nothing stored for r2), and arming there opens its own chat rather than reusing r1's.
    rerender(<GroupChat repoId="r2" onBack={() => undefined} />);
    await armViaAddAgents(user);
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(2));
    const idB = sessionStorage.getItem('wicked.chat.r2');

    expect(idA).toBeTruthy();
    expect(idB).toBeTruthy();
    expect(idB).not.toBe(idA);
    // r1's id survives the switch — coming back rejoins it rather than leaking it.
    expect(sessionStorage.getItem('wicked.chat.r1')).toBe(idA);
  });

  it('a repo switch leaves no trace of the previous repo on screen', async () => {
    // The effect is keyed on repoId, so a switch re-runs it in place — but per-chat React state
    // does not reset on its own. A transcript carried across the switch is attributed to the wrong
    // repo's chat, which is a wrong answer rendered confidently.
    const user = userEvent.setup();
    const { rerender } = render(<GroupChat repoId="r1" onBack={() => undefined} />);

    // The first send is the other opt-in (§2.4): it warms the one default agent, then sends.
    await user.type(screen.getByRole('textbox'), 'a message about repo one');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByText('a message about repo one')).toBeTruthy());

    rerender(<GroupChat repoId="r2" onBack={() => undefined} />);
    await waitFor(() => expect(screen.getByTestId('chat-firstrun')).toBeInTheDocument());
    expect(
      screen.queryByText('a message about repo one'),
      "r1's transcript must not appear under r2's chat",
    ).toBeNull();
    expect(openChat, "switching repos must not open r2's chat uninvited").toHaveBeenCalledTimes(1);
  });

  it('a daemon we cannot reach is not the same as a chat that is gone', async () => {
    // The sharp edge of the whole fix. `chat_seats` answers an EMPTY LIST for a chat the daemon no
    // longer holds — that is the reclaimed signal. A thrown error means we do not know, and minting
    // on "do not know" orphans a chat that may still be warm AND discards the only id that could
    // have reached it: the exact leak, reintroduced by a transient 5xx.
    sessionStorage.setItem('wicked.chat.r1', 'maybe-alive');
    getChat.mockRejectedValue(new Error('502 Bad Gateway'));

    render(<GroupChat repoId="r1" onBack={() => undefined} />);
    await waitFor(() => expect(getChat).toHaveBeenCalledWith('maybe-alive'));
    await waitFor(() => expect(screen.getByText(/502 Bad Gateway/)).toBeTruthy());

    expect(openChat, 'an unreachable daemon must not mint a second chat').not.toHaveBeenCalled();
    expect(sessionStorage.getItem('wicked.chat.r1')).toBe('maybe-alive');
    // The kept-on-error chat is disconnectable: Close renders for it (V8's one exception —
    // there IS something armed here, we just cannot see it).
    expect(screen.getByTestId('chat-close')).toBeInTheDocument();
  });

  it('a rejoin shows the seats the chat actually has, and never consults the roster', async () => {
    // Optimistic `warming` chips stand in for an open that is in flight. A rejoin has no open in
    // flight and no seat events coming, so a roster seat absent from the rejoined chat would sit
    // at `warming` forever with nothing left to correct it — a chip that lies indefinitely.
    // Post-slice-4 the roster is only fetched by the opt-in warm path, so a rejoin must not
    // touch it at all.
    getRoster.mockResolvedValue({ roster: [{ key: 'claude' }, { key: 'codex' }] });
    sessionStorage.setItem('wicked.chat.r1', 'live-id');
    getChat.mockResolvedValue({ chatId: 'live-id', seats: ['claude'] });

    render(<GroupChat repoId="r1" onBack={() => undefined} />);
    await waitFor(() => expect(screen.getByTitle('ready')).toHaveTextContent('claude'));

    expect(openChat).not.toHaveBeenCalled();
    expect(getRoster, 'a rejoin warms nothing, so it needs no roster').not.toHaveBeenCalled();
    expect(screen.queryByTitle('warming'), 'no seat may be left warming after a rejoin').toBeNull();
  });

  /**
   * The two tests below cover the window between a repo switch and the new repo's chat resolving.
   * It is not a theoretical window: resolving a stored id costs a `getChat` round-trip, and until it
   * answers, the component is showing repo B while holding repo A's chat id. `getChat` is left
   * unresolved on purpose — that is the state under test, not a race to be waited out.
   */
  it('a frame from the previous repo cannot render under the new one', async () => {
    const user = userEvent.setup();
    sessionStorage.setItem('wicked.chat.r2', 'stored-b');

    const { rerender } = render(<GroupChat repoId="r1" onBack={() => undefined} />);
    await armViaAddAgents(user);
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const idA = (openChat.mock.calls[0]?.[0] as { chatId: string }).chatId;

    getChat.mockReturnValue(new Promise(() => undefined)); // the probe never answers
    rerender(<GroupChat repoId="r2" onBack={() => undefined} />);
    await waitFor(() => expect(getChat).toHaveBeenCalledWith('stored-b'));

    // r1's chat is still live and its seats still emit. Attributed to r2, this is a seat chip for a
    // chat the operator is no longer looking at.
    //
    // `act` is load-bearing, not ceremony: without it the frame's `setSeats` never flushes and the
    // assertion passes whether the frame was accepted or rejected. Verified by mutation — with the
    // reset removed this test failed only once the flush was forced.
    await act(async () => {
      onFrame?.({ type: 'chatSessionReady', chat: idA, cliKey: 'claude' });
    });

    expect(
      screen.queryByTitle('ready'),
      "a frame for r1's chat must not be accepted while showing r2",
    ).toBeNull();
  });

  it('mid-switch there is nothing to close — and the previous repo’s chat survives', async () => {
    // The sharpest form of the misattribution used to be reachable here: an always-visible
    // "End chat" mid-switch could close r1's chat while clearing r2's key. Post-slice-4 the
    // teardown control only exists once something is armed (V8), so the window closes
    // structurally: no Close renders while r2's probe is unresolved, and r1's id survives.
    const user = userEvent.setup();
    sessionStorage.setItem('wicked.chat.r2', 'stored-b');

    const { rerender } = render(<GroupChat repoId="r1" onBack={() => undefined} />);
    await armViaAddAgents(user);
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const idA = sessionStorage.getItem('wicked.chat.r1');

    getChat.mockReturnValue(new Promise(() => undefined));
    rerender(<GroupChat repoId="r2" onBack={() => undefined} />);
    await waitFor(() => expect(getChat).toHaveBeenCalledWith('stored-b'));

    expect(screen.queryByTestId('chat-close'), 'no teardown for an unresolved chat').toBeNull();
    expect(closeChat).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('wicked.chat.r1')).toBe(idA);
    expect(sessionStorage.getItem('wicked.chat.r2')).toBe('stored-b');
  });

  it('Close forgets the id, so the next mount starts clean instead of rejoining a closed chat', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId="r1" onBack={() => undefined} />);
    await armViaAddAgents(user);
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('wicked.chat.r1')).toBeTruthy();

    await user.click(await screen.findByTestId('chat-close'));
    await waitFor(() => expect(closeChat).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('wicked.chat.r1')).toBeNull();
  });

  it('a failed close still forgets the id — an ended chat must never be rejoined', async () => {
    // Teardown is best-effort, but the id must go regardless: the daemon's idle reaper will collect
    // the seats either way, whereas rejoining a chat the operator ended is a visible wrong answer.
    const user = userEvent.setup();
    closeChat.mockRejectedValue(new Error('daemon unreachable'));
    render(<GroupChat repoId="r1" onBack={() => undefined} />);
    await armViaAddAgents(user);
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));

    await user.click(await screen.findByTestId('chat-close'));
    await waitFor(() => expect(closeChat).toHaveBeenCalledTimes(1));
    expect(sessionStorage.getItem('wicked.chat.r1')).toBeNull();
  });
});
