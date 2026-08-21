import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChat } from '../src/components/GroupChat.js';

/**
 * DES-UXFIX-001 slice 4 (§2.4, F6) — Chat's first-run moment teaches.
 *
 * The audit finding, verbatim: entering a project dropped the user into a pre-armed
 * "Group chat" with six agent chips and an End-chat button before they'd typed anything.
 * The redesign: NOTHING warms on mount; the empty state says what Chat is and what typing
 * does; the first send warms the ONE default agent; the roster is a disclosed opt-in
 * ("Add agents"); the teardown control is "Close" and exists only once agents are warm.
 * These are the slice-4 DOM ACs (§4.3) at unit level — the e2e rig re-proves them
 * against a real build with a network tap.
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
];

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
});

describe('GroupChat — first-run teaches, nothing warms (DES-UXFIX-001 §2.4)', () => {
  it('mounts cold: zero requests, zero seats, no Close — the AC verbatim', async () => {
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    // The teaching state is on screen…
    const teach = screen.getByTestId('chat-firstrun');
    expect(teach).toHaveTextContent('Chat with an agent about this project.');
    expect(teach).toHaveTextContent(/No run, no gates — just talk/);
    // …the one disclosure is offered…
    expect(screen.getByTestId('add-agents')).toBeInTheDocument();
    // …and the pre-armed ambush is gone: no chips, no teardown, no "Group chat".
    expect(screen.queryByTestId('chat-close')).toBeNull();
    expect(screen.queryByText('Group chat')).toBeNull();

    // Flush pending microtasks, then hold the line: nothing fired on mount.
    await waitFor(() => expect(screen.getByTestId('chat-firstrun')).toBeInTheDocument());
    expect(openChat, 'no chat may open on mount').not.toHaveBeenCalled();
    expect(getRoster, 'no roster fetch before the opt-in').not.toHaveBeenCalled();
    expect(getChat, 'nothing stored, so nothing to probe').not.toHaveBeenCalled();
  });

  it('the first send warms the ONE default agent, then sends', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    await user.type(screen.getByRole('textbox'), 'make me a deck');
    await user.keyboard('{Enter}');

    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const body = openChat.mock.calls[0]?.[0] as { chatId: string; clis?: string[] };
    // The single default agent — the first council-enabled roster seat — not the roster.
    expect(body.clis).toEqual(['claude']);
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(body.chatId, 'make me a deck'));

    // The message and the one agent's pending bubble are on screen; the teaching state is done.
    expect(screen.getByText('make me a deck')).toBeInTheDocument();
    expect(screen.queryByTestId('chat-firstrun')).toBeNull();
    // One warm agent is not the multi-agent strip: the disclosure stays available.
    expect(screen.getByTestId('add-agents')).toBeInTheDocument();
    // Agents are warm now, so the teardown control may exist (V8).
    await waitFor(() => expect(screen.getByTestId('chat-close')).toBeInTheDocument());
  });

  it('"Add agents" is the roster opt-in: warms every seat, reveals the strip, then Close', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    await user.click(screen.getByTestId('add-agents'));

    // The daemon owns the full-roster warm: no `clis` on the open (pre-slice-4 mount behaviour).
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect((openChat.mock.calls[0]?.[0] as { clis?: string[] }).clis).toBeUndefined();

    // The chip strip is now real — every roster seat, and the disclosure has done its job.
    await waitFor(() => expect(screen.getAllByTitle('ready')).toHaveLength(ROSTER.length));
    expect(screen.queryByTestId('add-agents')).toBeNull();
    expect(screen.getByTestId('chat-close')).toBeInTheDocument();
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
