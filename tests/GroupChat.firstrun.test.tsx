import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChat } from '../src/components/GroupChat.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import type { RosterSeat } from '../src/api/types.js';

/**
 * DES-UXFIX-001 slice 4 (§2.4, F6) — Chat's first-run moment teaches — as
 * re-scoped by DES-FEEDBACK-001 §6 (slice C) and BRIEF-UX-001 C6/EC44
 * (round 3: chips are truth).
 *
 * The audit finding, verbatim: entering a project dropped the user into a
 * pre-armed "Group chat" with six agent chips and an End-chat button before
 * they'd typed anything. The §2.4 redesign: NOTHING warms on mount; the empty
 * state says what Chat is and what typing does; the first send is the warm
 * opt-in. Round 3 closes the last lie in that story: the chips are the
 * agents the send CONNECTS, so no chip is painted until the roster is known —
 * a cold cache renders an honest resolving row and this surface makes its ONE
 * named mount request (GET /api/v1/roster) to resolve it. There is no
 * fallback trio and no send-time roster swap any more. Warming still waits
 * for the first send; nothing else fires on mount.
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

vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: () => undefined,
}));

/** Wire-true miniature: `acp` object = chat-capable, explicit null = not. */
const ROSTER = [
  { key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp' } },
  { key: 'codex', enabled_for_council: true, acp: null },
  { key: 'agy', enabled_for_council: false, acp: { binary: 'agy-acp' } },
] as unknown as RosterSeat[];
const CAPABLE = ['claude', 'agy'];

const chipAgents = (): (string | undefined)[] =>
  screen.getAllByTestId('agent-chip').map((c) => c.dataset['agent']);

beforeEach(() => {
  openChat.mockReset();
  getChat.mockReset();
  closeChat.mockReset();
  getRoster.mockReset();
  sendChatMessage.mockReset();
  getRoster.mockResolvedValue({ roster: ROSTER });
  openChat.mockImplementation((body: { chatId: string; clis?: string[] }) =>
    Promise.resolve({
      chatId: body.chatId,
      seats: (body.clis ?? ROSTER.map((s) => s.key)).map((cliKey) => ({ cliKey, ok: true })),
    }),
  );
  sendChatMessage.mockResolvedValue({ seats: [] });
  sessionStorage.clear();
  clearCachedRoster(); // cold cache — the resolving arm unless a test seeds it
});

describe('GroupChat — first-run teaches, nothing warms (§2.4 + §6 + EC44)', () => {
  it('mounts cold: teaching state, NO painted chips (resolving row), the ONE named roster request, no Close — the AC verbatim', async () => {
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    // The teaching state is on screen…
    const teach = screen.getByTestId('chat-firstrun');
    expect(teach).toHaveTextContent('Chat with an agent about this project.');
    expect(teach).toHaveTextContent(/No run, no gates — just talk/);
    // …no chip is PAINTED before the roster is known (EC44): the resolving
    // row renders instead, and the trio ghosts never do.
    expect(screen.queryAllByTestId('agent-chip')).toHaveLength(0);
    expect(screen.getByTestId('agent-chips-resolving')).toBeInTheDocument();
    for (const ghost of ['writer', 'reviewer', 'planner']) {
      expect(document.querySelector(`[data-agent="${ghost}"]`)).toBeNull();
    }
    // …and the pre-armed ambush is still gone: no warm seats, no teardown.
    expect(screen.queryByTestId('chat-close')).toBeNull();
    expect(screen.queryByTitle('ready')).toBeNull();
    expect(screen.queryByText('Group chat')).toBeNull();

    // The ONE named mount request resolves the chips to the CAPABLE seats
    // (AC: GET /api/v1/roster is the only request this mount makes — the
    // EC44 carve-out from the §2.4 zero-mount budget, cold cache only).
    await waitFor(() => expect(chipAgents()).toEqual(CAPABLE));
    expect(getRoster).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('add-agent')).toBeInTheDocument();
    expect(openChat, 'no chat may open on mount').not.toHaveBeenCalled();
    expect(getChat, 'nothing stored, so nothing to probe').not.toHaveBeenCalled();
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('the first send warms EXACTLY the displayed chips — typing is the opt-in, no hidden fan-out', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await waitFor(() => expect(chipAgents()).toEqual(CAPABLE));

    await user.type(screen.getByRole('textbox'), 'make me a deck');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    // Exactly one roster GET total — the mount resolve; the send added none.
    expect(getRoster).toHaveBeenCalledTimes(1);
    const body = openChat.mock.calls[0]?.[0] as { chatId: string; clis?: string[] };
    expect(body.clis).toEqual(CAPABLE);
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(body.chatId, 'make me a deck'));

    // The message and the warm seats are on screen; the teaching state and the
    // selection chips are done — the header seat chips are the truth now, and
    // every fanned-out seat SAYS it is working until its reply lands (EC44).
    expect(screen.getByText('make me a deck')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-firstrun')).toBeNull();
    await waitFor(() => expect(screen.getAllByTitle('working')).toHaveLength(CAPABLE.length));
    expect(screen.queryByTestId('agent-chips-bar')).toBeNull();
    // Agents are warm now, so the teardown control may exist (V8).
    await waitFor(() => expect(screen.getByTestId('chat-close')).toBeInTheDocument());
  });

  it('an unreachable roster NEVER fabricates chips or ships a send: the unresolved row + Retry recover (EC44)', async () => {
    const user = userEvent.setup();
    getRoster.mockRejectedValueOnce(new Error('daemon unreachable'));
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    const row = await screen.findByTestId('agent-chips-unresolved');
    expect(row).toHaveTextContent(/couldn’t load the agent roster/);
    expect(screen.queryAllByTestId('agent-chip')).toHaveLength(0);

    await user.type(screen.getByRole('textbox'), 'make me a deck');
    // Send is DISABLED while the audience is unknown; Enter ships nothing.
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.keyboard('{Enter}');
    expect(openChat).not.toHaveBeenCalled();
    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('make me a deck');
    expect(screen.queryByTestId('user-bubble')).toBeNull();

    // The roster recovers → Retry resolves, the chips are true, the draft is
    // still in the composer, and the send connects the displayed seats.
    await user.click(screen.getByTestId('agent-chips-retry'));
    await waitFor(() => expect(chipAgents()).toEqual(CAPABLE));
    await user.click(screen.getByRole('textbox')); // Retry took the focus
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect((openChat.mock.calls[0]?.[0] as { clis?: string[] }).clis).toEqual(CAPABLE);
    const chatId = (openChat.mock.calls[0]?.[0] as { chatId: string }).chatId;
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(chatId, 'make me a deck'));
    await waitFor(() => expect(screen.getAllByTestId('user-bubble')).toHaveLength(1));
  });

  it('[+ Add] opens the roster picker and the addition joins the send', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    await waitFor(() => expect(chipAgents()).toEqual(CAPABLE));
    expect(getRoster).toHaveBeenCalledTimes(1); // the mount resolve

    // An edit PINS the selection (§7.9-1): the deposit from a later picker
    // open must not re-seed over the operator's removal.
    await user.click(screen.getByRole('button', { name: 'Remove claude' }));
    await user.click(screen.getByTestId('add-agent'));
    // The picker reads the now-warm cache — no second fetch.
    expect(getRoster).toHaveBeenCalledTimes(1);
    const options = await screen.findAllByTestId('agent-picker-option');
    expect(options.map((o) => o.dataset['agentKey'])).toEqual(ROSTER.map((s) => s.key));
    // The incapable seat is offered LABELED, never as a silent equal (EC44).
    const codex = options.find((o) => o.dataset['agentKey'] === 'codex')!;
    expect(codex.dataset['chatCapable']).toBe('false');
    expect(codex).toHaveTextContent('no chat config');

    await user.click(options[0]!); // re-add claude
    expect(screen.getByTestId('agent-chips-bar')).toHaveAttribute('data-count', '2');

    await user.type(screen.getByRole('textbox'), 'all hands');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect((openChat.mock.calls[0]?.[0] as { clis?: string[] }).clis).toEqual(['agy', 'claude']);
  });

  it('a roster deposited by ANOTHER surface before the resolve lands seeds a PRISTINE selection — no duplicate fetch consumed', async () => {
    setCachedRoster(ROSTER);
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    // Warm cache: chips render synchronously and the mount resolve is skipped.
    expect(chipAgents()).toEqual(CAPABLE);
    await waitFor(() => expect(screen.getByTestId('chat-firstrun')).toBeInTheDocument());
    expect(getRoster).not.toHaveBeenCalled();

    // A later deposit (another surface refetching) re-seeds while pristine.
    act(() => setCachedRoster([ROSTER[0]!]));
    await waitFor(() => expect(chipAgents()).toEqual(['claude']));
    expect(getRoster).not.toHaveBeenCalled();
  });

  it('Send is enabled by text alone once the roster is known — typing is the opt-in', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await waitFor(() => expect(chipAgents()).toEqual(CAPABLE));
    expect(send).toBeDisabled(); // roster known, but no text yet
    await user.type(screen.getByRole('textbox'), 'hello');
    expect(send).toBeEnabled();
  });
});
