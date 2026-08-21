/**
 * GroupChat — the Chat surface under the token contract
 * (DES-VISION-001 §5.3, vision slice 4).
 *
 * Pins the slice-4 composition at unit level (the e2e rig re-proves computed
 * values in a real browser):
 *   - the first-run instruction reads as prose: the sans, `--ink-body` (the
 *     slice entry's "instruction text in sans/ink-body");
 *   - the composer sits on `--surface-raised` at `--radius-xl` and carries the
 *     wk-composer class whose :focus ring is `--accent-dim` (global.css —
 *     §5.3 motion: never the full accent);
 *   - "Add agents" is low-key but ON-ACCENT (§5.3: color alone signals it's
 *     interactive) and Send is the accent-filled primary action;
 *   - user messages are transparent, agent bubbles sit on `--surface-card`
 *     (§5.3 token usage);
 *   - none of this disturbs the §2.4 behaviours — the firstrun/rejoin suites
 *     keep those pinned; this file is the visual-language contract only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GroupChat } from '../src/components/GroupChat.js';

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
];

beforeEach(() => {
  openChat.mockReset();
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

describe('GroupChat — the §5.3 visual language', () => {
  it('the first-run instruction reads sans / --ink-body', () => {
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    const instruction = screen.getByTestId('chat-firstrun-instruction');
    expect(instruction.style.fontFamily).toBe('var(--font-sans)');
    expect(instruction.style.color).toBe('var(--ink-body)');
    expect(instruction.style.fontSize).toBe('var(--text-sm)');
  });

  it('the composer: --surface-raised, --radius-xl, and the wk-composer focus-ring hook', () => {
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    const composer = screen.getByRole('textbox') as HTMLTextAreaElement;
    expect(composer.className).toContain('wk-composer');
    expect(composer.style.background).toBe('var(--surface-raised)');
    expect(composer.style.borderRadius).toBe('var(--radius-xl)');
    expect(composer.style.fontFamily).toBe('var(--font-sans)');
  });

  it('"Add agents" is on-accent text; Send is the accent-filled action', () => {
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    const add = screen.getByTestId('add-agents');
    expect(add.style.color).toBe('var(--accent)');
    expect(add.style.background).toBe('transparent');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send.style.background).toBe('var(--accent)');
    expect(send.style.color).toBe('var(--accent-fg)');
  });

  it('user messages are transparent; agent bubbles sit on --surface-card; chips disclose with wk-disclose', async () => {
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);

    await user.type(screen.getByRole('textbox'), 'make me a deck');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalled());

    const bubble = screen.getByText('make me a deck');
    expect(bubble.style.background).toBe('transparent');
    // The one warmed seat's pending reply bubble is a card surface.
    const pending = screen.getByText('thinking…').closest('div') as HTMLElement;
    expect(pending.style.background).toBe('var(--surface-card)');
    // The seat chip animates in via wk-disclose (§5.3 motion, one run, no loop).
    const chip = screen.getByTitle('ready');
    expect(chip.className).toContain('wk-disclose');
  });
});
