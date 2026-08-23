import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChat } from '../src/components/GroupChat.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import type { RosterSeat } from '../src/api/types.js';

/**
 * DES-UXFIX-001 slice 4 (§2.4, F6) — Chat's first-run moment teaches — as
 * re-scoped by DES-FEEDBACK-001 §6 (slice C).
 *
 * The audit finding, verbatim: entering a project dropped the user into a pre-armed
 * "Group chat" with six agent chips and an End-chat button before they'd typed anything.
 * The §2.4 redesign: NOTHING warms on mount; the empty state says what Chat is and what
 * typing does; the first send is the warm opt-in. Slice C's §6 compromise keeps every
 * bit of that and replaces the "Add agents" disclosure with DEFAULT chips: the agents
 * that WILL join render immediately from the roster CACHE (fallback trio when cold),
 * still zero requests on mount — the chips are selection UI, not warm seats. The e2e
 * rig re-proves these against a real build with a network tap.
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

const ROSTER = [
  { key: 'claude', enabled_for_council: true },
  { key: 'codex', enabled_for_council: true },
  { key: 'agy', enabled_for_council: false },
] as unknown as RosterSeat[];

/** §6.2's hardcoded fallback — what the chips show when the cache is cold. */
const FALLBACK = ['writer', 'reviewer', 'planner'];

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
  clearCachedRoster(); // cold cache — the §6.2 fallback path unless a test seeds it
});

describe('GroupChat — first-run teaches, nothing warms (DES-UXFIX-001 §2.4 + DES-FEEDBACK-001 §6)', () => {
  it('mounts cold: zero requests, default chips from the fallback, no Close — the AC verbatim', async () => {
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    // The teaching state is on screen…
    const teach = screen.getByTestId('chat-firstrun');
    expect(teach).toHaveTextContent('Chat with an agent about this project.');
    expect(teach).toHaveTextContent(/No run, no gates — just talk/);
    // …the §6.2 default chips render IMMEDIATELY (cold cache → the fallback trio)…
    expect(screen.getByTestId('agent-chips-bar')).toHaveAttribute('data-count', '3');
    expect(screen.getAllByTestId('agent-chip').map((c) => c.dataset['agent'])).toEqual(FALLBACK);
    expect(screen.getByTestId('add-agent')).toBeInTheDocument();
    // …and the pre-armed ambush is still gone: no warm seats, no teardown, no "Group chat".
    expect(screen.queryByTestId('chat-close')).toBeNull();
    expect(screen.queryByTitle('ready')).toBeNull();
    expect(screen.queryByText('Group chat')).toBeNull();

    // Flush pending microtasks, then hold the line: nothing fired on mount —
    // the chips came from the cache/fallback, never a fetch (§6.1).
    await waitFor(() => expect(screen.getByTestId('chat-firstrun')).toBeInTheDocument());
    expect(openChat, 'no chat may open on mount').not.toHaveBeenCalled();
    expect(getRoster, 'no roster fetch on mount — chips read the cache').not.toHaveBeenCalled();
    expect(getChat, 'nothing stored, so nothing to probe').not.toHaveBeenCalled();
  });

  it('the first send is roster-first (DES-UX-001 §7.9-1): a pristine cold-cache send fetches the roster ON THE GESTURE and warms ITS seats', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    // Mount stayed request-free (pinned above); the SEND is the opt-in gesture
    // the roster fetch rides, so the open names seats the daemon accepts.
    await user.type(screen.getByRole('textbox'), 'make me a deck');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect(getRoster).toHaveBeenCalledTimes(1);
    const body = openChat.mock.calls[0]?.[0] as { chatId: string; clis?: string[] };
    expect(body.clis).toEqual(ROSTER.map((s) => s.key));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(body.chatId, 'make me a deck'));

    // The message and the warm seats are on screen; the teaching state and the
    // selection chips are done — the header seat chips are the truth now, and
    // every fanned-out seat SAYS it is working until its reply lands (EC44).
    expect(screen.getByText('make me a deck')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-firstrun')).toBeNull();
    await waitFor(() => expect(screen.getAllByTitle('working')).toHaveLength(ROSTER.length));
    expect(screen.queryByTestId('agent-chips-bar')).toBeNull();
    // Agents are warm now, so the teardown control may exist (V8).
    await waitFor(() => expect(screen.getByTestId('chat-close')).toBeInTheDocument());
  });

  it('the fallback trio reaches the daemon ONLY when the roster is unreachable (§7.9-1)', async () => {
    const user = userEvent.setup();
    getRoster.mockRejectedValue(new Error('daemon unreachable'));
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    await user.type(screen.getByRole('textbox'), 'make me a deck');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect(getRoster).toHaveBeenCalledTimes(1);
    // Cold cache AND unreachable roster: the trio is the honest audience.
    expect((openChat.mock.calls[0]?.[0] as { clis?: string[] }).clis).toEqual(FALLBACK);
  });

  it('[+ Add] opens the roster picker (fetch rides the user action) and the addition joins the send', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    expect(getRoster).not.toHaveBeenCalled();
    // An edit PINS the selection (§7.9-1): the roster deposit from the picker
    // open must not re-seed over the operator's removal.
    await user.click(screen.getByRole('button', { name: 'Remove writer' }));
    await user.click(screen.getByTestId('add-agent'));
    // Opening the picker is a USER action — the one place the roster may be fetched here.
    await waitFor(() => expect(getRoster).toHaveBeenCalledTimes(1));
    const options = await screen.findAllByTestId('agent-picker-option');
    expect(options.map((o) => o.dataset['agentKey'])).toEqual(ROSTER.map((s) => s.key));

    await user.click(options[0]!); // add claude
    expect(screen.getByTestId('agent-chips-bar')).toHaveAttribute('data-count', '3');

    await user.type(screen.getByRole('textbox'), 'all hands');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect((openChat.mock.calls[0]?.[0] as { clis?: string[] }).clis).toEqual(['reviewer', 'planner', 'claude']);
  });

  it('a warm roster deposited AFTER mount re-seeds a PRISTINE selection — warm roster beats the fallback trio (§7.9-1)', async () => {
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    expect(chipAgents()).toEqual(FALLBACK);

    // Another surface (the launch form's startup fetch) deposits the roster.
    const { act } = await import('@testing-library/react');
    act(() => setCachedRoster(ROSTER));
    await waitFor(() => expect(chipAgents()).toEqual(ROSTER.map((s) => s.key)));
    // Still zero requests from THIS surface — it only heard the deposit.
    expect(getRoster).not.toHaveBeenCalled();
  });

  it('Send is enabled by text alone on first-run — typing is the opt-in', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toBeDisabled();
    await user.type(screen.getByRole('textbox'), 'hello');
    expect(send).toBeEnabled();
  });
});
