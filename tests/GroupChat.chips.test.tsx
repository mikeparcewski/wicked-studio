import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChat, DEFAULT_CHAT_AGENTS } from '../src/components/GroupChat.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import type { RosterSeat } from '../src/api/types.js';

/**
 * DES-FEEDBACK-001 §6 (slice C) — Chat's default agent chips.
 *
 * Operator: "Agents should be added by default and those chips should be
 * clickable to remove/add." Reconciled with the BINDING zero-requests-on-mount
 * constraint (DES-UXFIX-001 §2.4) by §6.1's one rule: chips render from the
 * CACHED roster (or the hardcoded fallback trio), never a fetch. These pin:
 *   - chips render on first paint with ZERO api calls (spy across the client);
 *   - a warm cache supplies the chip set; a cold cache falls back to
 *     DEFAULT_CHAT_AGENTS — the only hardcoded names in the agent layer;
 *   - ✕ removes for THIS run only: the count decrements and the send's clis
 *     excludes the removal;
 *   - [+ Add] opens the roster picker (its fetch rides the user action) and an
 *     added agent joins the send;
 *   - a stale default the daemon rejects surfaces a recoverable error NAMING
 *     it, and removing the chip + sending again recovers into the SAME chat id.
 */

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

vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: () => undefined,
}));

const ROSTER = [
  { key: 'claude', enabled_for_council: true },
  { key: 'codex', enabled_for_council: true },
  { key: 'agy', enabled_for_council: false },
  { key: 'pi', enabled_for_council: false },
] as unknown as RosterSeat[];

const ALL_SPIES = { openChat, getChat, closeChat, getRoster, sendChatMessage, listProjects };

beforeEach(() => {
  for (const spy of Object.values(ALL_SPIES)) spy.mockReset();
  getRoster.mockResolvedValue({ roster: ROSTER });
  openChat.mockImplementation((body: { chatId: string; clis?: string[] }) =>
    Promise.resolve({
      chatId: body.chatId,
      seats: (body.clis ?? ROSTER.map((s) => s.key)).map((cliKey) => ({ cliKey, ok: true })),
    }),
  );
  sendChatMessage.mockResolvedValue({ seats: [] });
  sessionStorage.clear();
  clearCachedRoster();
});

function chipKeys(): (string | undefined)[] {
  return screen.getAllByTestId('agent-chip').map((c) => c.dataset['agent']);
}

describe('GroupChat — default agent chips (DES-FEEDBACK-001 §6)', () => {
  it('renders chips on first paint with ZERO api calls — the §6.1 constraint, spy-proven', async () => {
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    expect(screen.getByTestId('agent-chips-bar')).toHaveAttribute(
      'data-count',
      String(DEFAULT_CHAT_AGENTS.length),
    );
    expect(screen.getAllByTestId('agent-chip')).toHaveLength(3);

    // Flush microtasks, then hold the line: not one call on ANY api surface.
    await waitFor(() => expect(screen.getByTestId('chat-firstrun')).toBeInTheDocument());
    for (const [name, spy] of Object.entries(ALL_SPIES)) {
      expect(spy, `${name} must not fire on mount (§2.4/§6.1)`).not.toHaveBeenCalled();
    }
  });

  it('a warm cache supplies the chip set — still zero calls', async () => {
    setCachedRoster(ROSTER);
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    expect(chipKeys()).toEqual(['claude', 'codex', 'agy', 'pi']);
    expect(screen.getByTestId('agent-chips-bar')).toHaveAttribute('data-count', '4');
    await waitFor(() => expect(screen.getByTestId('chat-firstrun')).toBeInTheDocument());
    expect(getRoster).not.toHaveBeenCalled();
  });

  it('a cold cache falls back to DEFAULT_CHAT_AGENTS — the only hardcoded names', () => {
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    expect(chipKeys()).toEqual([...DEFAULT_CHAT_AGENTS]);
  });

  it('✕ removes for this run only: the count decrements and the send excludes the removal', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    await user.click(screen.getByRole('button', { name: 'Remove writer' }));
    expect(screen.getByTestId('agent-chips-bar')).toHaveAttribute('data-count', '2');
    expect(chipKeys()).toEqual(['reviewer', 'planner']);

    await user.type(screen.getByRole('textbox'), 'no writer please');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect((openChat.mock.calls[0]?.[0] as { clis?: string[] }).clis).toEqual(['reviewer', 'planner']);
  });

  it('[+ Add] opens the picker (fetch on the user action, cached after) and the addition joins the send', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    // Slice AB (§7.9-1): an edit pins the selection first — otherwise the
    // picker's own roster deposit would re-seed the pristine fallback trio
    // to the full roster (the warm-roster-wins rule) before the click lands.
    await user.click(screen.getByRole('button', { name: 'Remove writer' }));
    await user.click(screen.getByTestId('add-agent'));
    await waitFor(() => expect(getRoster).toHaveBeenCalledTimes(1));
    const options = await screen.findAllByTestId('agent-picker-option');
    expect(options.map((o) => o.dataset['agentKey'])).toEqual(['claude', 'codex', 'agy', 'pi']);

    await user.click(options[1]!); // codex
    expect(chipKeys()).toEqual(['reviewer', 'planner', 'codex']);

    // Re-opening reads the now-warm cache — no second fetch.
    await user.click(screen.getByTestId('add-agent'));
    expect(getRoster).toHaveBeenCalledTimes(1);
    // An already-included agent is offered disabled, not duplicated.
    const codexRow = screen
      .getAllByTestId('agent-picker-option')
      .find((o) => o.dataset['agentKey'] === 'codex')!;
    expect(codexRow).toBeDisabled();

    await user.type(screen.getByRole('textbox'), 'bring codex too');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect((openChat.mock.calls[0]?.[0] as { clis?: string[] }).clis).toEqual([
      'reviewer',
      'planner',
      'codex',
    ]);
  });

  it('a stale default the daemon rejects surfaces a recoverable error naming it; remove + resend recovers into the same chat', async () => {
    const user = userEvent.setup();
    // Slice AB (§7.9-1): the stale-trio-reaches-the-daemon case now REQUIRES
    // an unreachable roster — a reachable one would have re-seeded the send.
    getRoster.mockRejectedValue(new Error('daemon unreachable'));
    // First open: every requested seat is rejected (stale fallback names).
    openChat.mockImplementationOnce((body: { chatId: string; clis?: string[] }) =>
      Promise.resolve({
        chatId: body.chatId,
        seats: (body.clis ?? []).map((cliKey) => ({ cliKey, ok: false, error: 'unknown agent' })),
      }),
    );
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    await user.type(screen.getByRole('textbox'), 'hello?');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));

    // The error NAMES the rejected agents (§6.2) …
    await waitFor(() =>
      expect(screen.getByText(/rejected agents "writer", "reviewer", "planner"/)).toBeInTheDocument(),
    );
    // … and the message did NOT go out.
    expect(sendChatMessage).not.toHaveBeenCalled();
    // Recoverable: the chips bar is back (nothing warmed), removals still work.
    const bar = await screen.findByTestId('agent-chips-bar');
    expect(bar).toHaveAttribute('data-count', '3');
    await user.click(screen.getByRole('button', { name: 'Remove writer' }));
    await user.click(screen.getByRole('button', { name: 'Remove reviewer' }));

    // §7.9-2: the failed send's DRAFT survived in the composer — clear it for
    // the corrected resend (the retry re-arms the SAME chat id, then sends).
    expect(screen.getByRole('textbox')).toHaveValue('hello?');
    await user.clear(screen.getByRole('textbox'));
    await user.type(screen.getByRole('textbox'), 'try again');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(2));
    const first = openChat.mock.calls[0]?.[0] as { chatId: string };
    const second = openChat.mock.calls[1]?.[0] as { chatId: string; clis?: string[] };
    expect(second.chatId, 'recovery must not mint a second chat (FINDING-027)').toBe(first.chatId);
    expect(second.clis).toEqual(['planner']);
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(second.chatId, 'try again'));
  });
});
