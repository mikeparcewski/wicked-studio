import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { chatAdmissionOf, defaultSelection, engineSendsAnswer, GroupChat } from '../src/components/GroupChat.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import type { RosterSeat } from '../src/api/types.js';

/**
 * BRIEF-UX-001 C6 / EC44 — the chips are TRUTH — as re-scoped in round 3.
 *
 * The round-3 cold review (real daemon, fresh profile) caught the composer
 * painting the writer/reviewer/planner fallback trio as if they were seats,
 * '+ Add' silently swapping them for the CLI roster, and the send connecting
 * the whole roster regardless of the 3 chips displayed. The contract now:
 *   - COLD render never paints a chip until the roster is KNOWN: an honest
 *     "resolving agents…" row renders instead, and the surface makes its ONE
 *     named mount request (GET /api/v1/roster) to resolve it — warm cache
 *     renders chips synchronously with zero requests;
 *   - the DEFAULT selection is the CHAT-CAPABLE seats only: the roster seat's
 *     `acp` field is the capability marker — an object when configured, and
 *     ABSENT when not (skip_serializing_if: the engine never writes null;
 *     wicked-core's chat_ensure answers "no ACP config" for configless
 *     seats). Round-4 polarity: an absent key is "no config" whenever ANY
 *     seat in the roster speaks the field; only a roster with no acp key
 *     anywhere (a daemon predating the field) reads all-capable;
 *   - [+ Add] offers incapable seats LABELED ("no chat config"), never as
 *     silent equals — picking one is the operator's explicit call;
 *   - the send body = exactly the selected chips. No hidden fan-out;
 *   - ✕ removes for THIS run only; a stale edited chip's rejection is a
 *     recoverable error naming it (unchanged from slice C).
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

vi.mock('../src/api/diagnostics.js', () => ({
  getDiagnostics: () => Promise.resolve({ components: { coreTs: '0.7.27' } }),
  isDiagnosticsUnsupported: () => false,
}));

vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: () => undefined,
}));

/** The live daemon's wire shape in miniature: `acp` is an object on the
 *  chat-capable seats and ABSENT on the rest (GET /api/v1/roster — the
 *  engine's skip_serializing_if never writes a null; codex here is the real
 *  absent-key spelling, agy the defensive explicit-null belt arm). */
// The daemon's own admission verdict rides every seat (crew >= 0.7.36, F-W1-005): studio holds no
// capability rule of its own, so a seat is offered exactly when `chat_admission` says the daemon
// would seat it. codex/agy are refused here for the reasons the daemon gives.
const REFUSED_NO_ACP = {
  ok: false,
  reason: 'it has no ACP adapter registered, and a scoped chat holds only ACP-governed seats',
  source: 'scope',
};
const ADMITTED = { unscoped: { ok: true }, scoped: { ok: true } };
const ROSTER = [
  { key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp', transport: 'stdio' }, chat_admission: ADMITTED },
  { key: 'codex', enabled_for_council: true, chat_admission: { unscoped: REFUSED_NO_ACP, scoped: REFUSED_NO_ACP } },
  { key: 'agy', enabled_for_council: false, acp: null, chat_admission: { unscoped: REFUSED_NO_ACP, scoped: REFUSED_NO_ACP } },
  { key: 'pi', enabled_for_council: false, acp: { binary: 'pi-acp', transport: 'stdio' }, chat_admission: ADMITTED },
] as unknown as RosterSeat[];
const CAPABLE = ['claude', 'pi'];
/** The same roster as a daemon that publishes NO verdict would serve it (crew < 0.7.36). */
const withoutVerdict = (seat: RosterSeat): RosterSeat => {
  const copy = { ...(seat as unknown as Record<string, unknown>) };
  delete copy['chat_admission'];
  return copy as unknown as RosterSeat;
};

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

describe('defaultSelection — the seats the DAEMON would seat (no client-side capability rule)', () => {
  it('selects by the daemon verdict for the mode; a roster with no verdict offers everything', () => {
    expect(defaultSelection(VERDICT_ROSTER, true)).toEqual(['claude']);
    expect(defaultSelection(VERDICT_ROSTER, false)).toEqual(['claude', 'pi']);
    // No verdict on the wire ⇒ studio second-guesses nothing: every seat is offered and the
    // daemon's own answer at open is the truth (review MED-1).
    expect(defaultSelection(ROSTER.map((r) => ({ key: r.key })) as unknown as RosterSeat[], true))
      .toEqual(ROSTER.map((r) => r.key));
    expect(chatAdmissionOf({ key: 'x' } as unknown as RosterSeat, true)).toEqual({ ok: true });
  });

  it('engineSendsAnswer: the answer-only reply rule is ON only from core-ts 0.7.27; unknown stays guarded', () => {
    expect(engineSendsAnswer('0.7.27')).toBe(true);
    expect(engineSendsAnswer('0.7.28')).toBe(true);
    expect(engineSendsAnswer('0.8.0')).toBe(true);
    expect(engineSendsAnswer('0.7.26')).toBe(false);
    expect(engineSendsAnswer('0.7.9')).toBe(false);
    for (const unknown of [null, undefined, '', 'nightly']) {
      expect(engineSendsAnswer(unknown as string | null)).toBe(false);
    }
  });
});
describe('GroupChat — chips are truth (BRIEF-UX-001 C6/EC44)', () => {
  it('COLD render: no chip is painted — the resolving row shows, ONE named roster request resolves it, then roster-true chips', async () => {
    // Hold the resolve open so the pre-resolve state is assertable — the
    // mocked promise would otherwise land inside the first `await`.
    let release: (v: { roster: RosterSeat[] }) => void = () => undefined;
    getRoster.mockImplementationOnce(
      () => new Promise<{ roster: RosterSeat[] }>((res) => { release = res; }),
    );
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system')); // studio#248: Unfiled = an EXPLICIT unscoped choice before the first send

    // Before the resolve lands: the honest resolving state, ZERO chips —
    // never the writer/reviewer/planner trio dressed as seats.
    expect(screen.queryAllByTestId('agent-chip')).toHaveLength(0);
    expect(screen.getByTestId('agent-chips-resolving')).toBeInTheDocument();
    expect(screen.getByTestId('agent-chips-bar')).toHaveAttribute('data-source', 'resolving');
    for (const ghost of ['writer', 'reviewer', 'planner']) {
      expect(document.querySelector(`[data-agent="${ghost}"]`), `${ghost} must never render`).toBeNull();
    }
    // Send is disabled while the audience is unknown — even with text typed.
    const user = userEvent.setup();
    await user.type(screen.getByRole('textbox'), 'early bird');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.keyboard('{Enter}'); // and the belt behind it ships nothing
    expect(openChat).not.toHaveBeenCalled();

    // The ONE named mount request (EC44's carve-out from the §2.4 budget).
    expect(getRoster).toHaveBeenCalledTimes(1);
    const { act } = await import('@testing-library/react');
    act(() => release({ roster: ROSTER }));
    await waitFor(() => expect(chipKeys()).toEqual(CAPABLE));
    expect(screen.getByTestId('agent-chips-bar')).toHaveAttribute('data-source', 'roster');
    expect(screen.getByTestId('agent-chips-bar')).toHaveAttribute('data-count', '2');
    expect(screen.queryByTestId('agent-chips-resolving')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    // Nothing else fired: no open, no probe, no fan-out.
    expect(openChat).not.toHaveBeenCalled();
    expect(getChat).not.toHaveBeenCalled();
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('WARM cache: chips render synchronously — roster-true, capability-filtered, zero requests', async () => {
    setCachedRoster(ROSTER);
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system')); // studio#248: Unfiled = an EXPLICIT unscoped choice before the first send

    expect(chipKeys()).toEqual(CAPABLE);
    expect(screen.getByTestId('agent-chips-bar')).toHaveAttribute('data-count', '2');
    expect(screen.getByTestId('agent-chips-bar')).toHaveAttribute('data-source', 'roster');
    await waitFor(() => expect(screen.getByTestId('chat-firstrun')).toBeInTheDocument());
    for (const [name, spy] of Object.entries(ALL_SPIES)) {
      expect(spy, `${name} must not fire on a warm-cache mount`).not.toHaveBeenCalled();
    }
  });

  it('the send CONNECTS exactly the displayed chips — the round-2 hidden roster fan-out is gone', async () => {
    const user = userEvent.setup();
    setCachedRoster(ROSTER);
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system')); // studio#248: Unfiled = an EXPLICIT unscoped choice before the first send

    const displayed = chipKeys();
    await user.type(screen.getByRole('textbox'), 'hello seats');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect((openChat.mock.calls[0]?.[0] as { clis?: string[] }).clis).toEqual(displayed);
    // The PRISTINE selection did not trigger a roster re-fetch or a swap.
    expect(getRoster).not.toHaveBeenCalled();
  });

  it('a FAILED resolve renders the unresolved row with Retry — nothing ships, and Retry recovers', async () => {
    const user = userEvent.setup();
    getRoster.mockRejectedValueOnce(new Error('daemon unreachable'));
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system')); // studio#248: Unfiled = an EXPLICIT unscoped choice before the first send

    const failedRow = await screen.findByTestId('agent-chips-unresolved');
    expect(failedRow).toHaveTextContent(/couldn’t load the agent roster/);
    expect(screen.queryAllByTestId('agent-chip')).toHaveLength(0);
    await user.type(screen.getByRole('textbox'), 'anyone there?');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await user.keyboard('{Enter}'); // the belt behind the disabled suspender
    expect(openChat).not.toHaveBeenCalled();
    expect(sendChatMessage).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('agent-chips-retry'));
    await waitFor(() => expect(chipKeys()).toEqual(CAPABLE));
    expect(getRoster).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('✕ removes for this run only: the count decrements and the send excludes the removal', async () => {
    const user = userEvent.setup();
    setCachedRoster(ROSTER);
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system')); // studio#248: Unfiled = an EXPLICIT unscoped choice before the first send

    await user.click(screen.getByRole('button', { name: 'Remove claude' }));
    expect(screen.getByTestId('agent-chips-bar')).toHaveAttribute('data-count', '1');
    expect(chipKeys()).toEqual(['pi']);

    await user.type(screen.getByRole('textbox'), 'no claude please');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect((openChat.mock.calls[0]?.[0] as { clis?: string[] }).clis).toEqual(['pi']);
  });

  it('[+ Add] offers every seat when the daemon publishes no verdict, and an explicit pick joins the send', async () => {
    const user = userEvent.setup();
    setCachedRoster(ROSTER.map(withoutVerdict));
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system')); // studio#248: Unfiled = an EXPLICIT unscoped choice before the first send

    await user.click(screen.getByTestId('add-agent'));
    const options = await screen.findAllByTestId('agent-picker-option');
    expect(options.map((o) => o.dataset['agentKey'])).toEqual(['claude', 'codex', 'agy', 'pi']);
    // No verdict on the wire ⇒ no client-side judgement is rendered at all (review MED-1).
    expect(screen.queryByTestId('agent-picker-nochat')).toBeNull();
    expect(screen.queryByTestId('agent-picker-excluded')).toBeNull();
    const byKey = Object.fromEntries(options.map((o) => [o.dataset['agentKey'], o]));
    await user.click(byKey['codex']!);
    expect(chipKeys()).toContain('codex');

    await user.type(screen.getByRole('textbox'), 'bring codex too');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect((openChat.mock.calls[0]?.[0] as { clis?: string[] }).clis).toContain('codex');
  });
  it('a roster with NO capable seat defaults to an EMPTY selection with the honest note — never 4 red seats', async () => {
    setCachedRoster([
      { key: 'codex', enabled_for_council: true, acp: null, chat_admission: { unscoped: REFUSED_NO_ACP, scoped: REFUSED_NO_ACP } },
      { key: 'agy', enabled_for_council: false, acp: null, chat_admission: { unscoped: REFUSED_NO_ACP, scoped: REFUSED_NO_ACP } },
    ] as unknown as RosterSeat[]);
    const user = userEvent.setup();
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system')); // studio#248: Unfiled = an EXPLICIT unscoped choice before the first send

    expect(screen.queryAllByTestId('agent-chip')).toHaveLength(0);
    expect(screen.getByTestId('agent-chips-empty-note')).toHaveTextContent(/no agent has a chat \(ACP\) config/);
    await user.type(screen.getByRole('textbox'), 'hello?');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    expect(openChat).not.toHaveBeenCalled();
  });

  it('the picker speaks the roster: display names and observed health ride each option (J4 round 2, minor)', async () => {
    const user = userEvent.setup();
    getRoster.mockResolvedValue({
      roster: [
        { key: 'claude', display_name: 'Claude Code', enabled_for_council: true,
          acp: { binary: 'claude-agent-acp' },
          health: { status: 'active', since: '2026-08-01T00:00:00Z' } },
        { key: 'codex', display_name: 'Codex', enabled_for_council: true, acp: null,
          health: { status: 'inactive', message: 'quota exceeded', since: '2026-08-01T00:00:00Z' } },
        // A seat with no health claim whose acp key is ABSENT — beside a
        // roster that speaks acp, absence IS "no config" (round 4).
        { key: 'pi', display_name: 'pi', enabled_for_council: true },
      ] as unknown as RosterSeat[],
    });
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system')); // studio#248: Unfiled = an EXPLICIT unscoped choice before the first send
    await waitFor(() => expect(screen.getAllByTestId('agent-chip').length).toBeGreaterThan(0));
    await user.click(screen.getByTestId('add-agent'));

    const options = await screen.findAllByTestId('agent-picker-option');
    const byKey = Object.fromEntries(options.map((o) => [o.dataset['agentKey'], o]));
    expect(byKey['claude']).toHaveTextContent('Claude Code');
    expect(byKey['claude']!.dataset['health']).toBe('active');
    expect(byKey['codex']!.dataset['health']).toBe('inactive');
    expect(byKey['codex']!.title).toBe('Codex — inactive');
    // No health on the wire → no claim in the DOM (the dot is absent, not fabricated).
    expect(byKey['pi']!.dataset['health']).toBe('unknown');
    expect(byKey['pi']!.querySelector('span[aria-hidden]')).toBeNull();
    // review MED-1: no client-side capability claim rides the option any more — the daemon's
    // verdict decides whether a seat is offered at all, and `pi` is admitted on this roster.
    expect(byKey['pi']!.dataset['chatCapable']).toBeUndefined();
    expect(byKey['pi']!).not.toHaveTextContent('no chat config');
  });

  it('a stale EDITED chip the daemon rejects surfaces a recoverable error naming it; remove + resend recovers into the same chat', async () => {
    // The §6.2 recovery contract, unchanged from round 2: an operator-edited
    // selection ships as-is, and the daemon's per-seat answer is the recovery.
    const user = userEvent.setup();
    setCachedRoster(ROSTER);
    openChat.mockImplementationOnce((body: { chatId: string; clis?: string[] }) =>
      Promise.resolve({
        chatId: body.chatId,
        seats: (body.clis ?? []).map((cliKey) => ({ cliKey, ok: false, error: 'unknown agent' })),
      }),
    );
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    fireEvent.click(screen.getByTestId('chat-scope-system')); // studio#248: Unfiled = an EXPLICIT unscoped choice before the first send

    // The edit PINS the selection (§7.9-1) — no roster re-seed rides the send.
    await user.click(screen.getByRole('button', { name: 'Remove claude' }));
    await user.type(screen.getByRole('textbox'), 'hello?');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    expect(getRoster).not.toHaveBeenCalled(); // touched selection: the operator's call
    expect((openChat.mock.calls[0]?.[0] as { clis?: string[] }).clis).toEqual(['pi']);

    // The error NAMES the rejected agent (§6.2) — on the banner AND the
    // retryable failed-send row (§7.9-2 carries the same reason).
    await waitFor(() =>
      expect(screen.getAllByText(/rejected agent "pi"/).length).toBeGreaterThan(0),
    );
    expect(sendChatMessage).not.toHaveBeenCalled();
    expect(screen.getByTestId('chat-send-failed')).toBeInTheDocument();
    // Recoverable: the chips bar is back (nothing warmed); +Add still works.
    const bar = await screen.findByTestId('agent-chips-bar');
    expect(bar).toHaveAttribute('data-count', '1');
    await user.click(screen.getByRole('button', { name: 'Remove pi' }));
    await user.click(screen.getByTestId('add-agent'));
    const claudeOpt = (await screen.findAllByTestId('agent-picker-option'))
      .find((o) => o.dataset['agentKey'] === 'claude')!;
    await user.click(claudeOpt);

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
    expect(second.clis).toEqual(['claude']);
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(second.chatId, 'try again', ['claude']));
    // J4 finding 3: the successful send retires the stale open-failure banner
    // and the previously-rejected seat's red chip (it is not in this open).
    await waitFor(() => expect(screen.queryByText(/rejected agent/)).toBeNull());
    expect(document.querySelector('[data-testid="seat-chip"][data-agent="pi"]')).toBeNull();
  });
});

/** crew ≥ 0.7.36: the daemon's own admission verdict rides every roster seat (F-W1-005). */
const VERDICT_ROSTER = [
  { key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp', transport: 'stdio', acp_input_governance: true },
    chat_admission: { unscoped: { ok: true }, scoped: { ok: true } } },
  { key: 'pi', enabled_for_council: false, acp: { binary: 'pi-acp', transport: 'stdio' },
    chat_admission: { unscoped: { ok: true }, scoped: { ok: false, reason: 'its ACP adapter asks no permissions and its record arms no OS sandbox, so a scoped chat could not hold the repositories read-only for it (open the chat unscoped to include it)', source: 'scope' } } },
  { key: 'codex', enabled_for_council: true,
    chat_admission: { unscoped: { ok: false, reason: 'signed out — it cannot take a turn until it is signed in from the System page', source: 'auth' }, scoped: { ok: false, reason: 'signed out — it cannot take a turn until it is signed in from the System page; it has no ACP adapter registered, and a scoped chat holds only ACP-governed seats', source: 'auth' } } },
] as unknown as RosterSeat[];

describe('F-W1-005 — the picker and the default chips read the DAEMON\'s chat admission verdict (one source of truth)', () => {
  it('chatAdmissionOf / defaultSelection: the verdict for the scope mode wins; without it the ACP marker is the (disclosed) fallback', () => {
    expect(chatAdmissionOf(VERDICT_ROSTER[1]!, true)).toEqual(expect.objectContaining({ ok: false, source: 'scope' }));
    expect(chatAdmissionOf(VERDICT_ROSTER[1]!, false)).toEqual({ ok: true });
    expect(defaultSelection(VERDICT_ROSTER, true)).toEqual(['claude']);
    expect(defaultSelection(VERDICT_ROSTER, false)).toEqual(['claude', 'pi']);
    // Older daemon (no verdict): today's rule, in both modes.
  });

  it('a SCOPED chat: the default chips are the seats the daemon would seat; [+ Add] offers only them and names the rest with the daemon\'s reason', async () => {
    const user = userEvent.setup();
    setCachedRoster(VERDICT_ROSTER);
    render(<GroupChat repoId="repo-1" onBack={() => undefined} />);
    expect(chipKeys()).toEqual(['claude']);
    await user.click(screen.getByTestId('add-agent'));
    const options = await screen.findAllByTestId('agent-picker-option');
    expect(options.map((o) => o.dataset['agentKey'])).toEqual(['claude']);
    expect(screen.queryByTestId('agent-picker-nochat'), 'the client-side capability label is gone entirely').toBeNull();
    const excluded = screen.getByTestId('agent-picker-excluded');
    expect(excluded.dataset['count']).toBe('2');
    expect(excluded.textContent).toMatch(/Can’t join a scoped chat \(the daemon’s admission\): pi — its ACP adapter asks no permissions/);
    expect(excluded.textContent).toMatch(/codex — signed out/);
  });

  it('an UNSCOPED chat: pi is offered again (the verdict is per scope mode) and a pristine selection re-seeds when the mode flips', async () => {
    const user = userEvent.setup();
    setCachedRoster(VERDICT_ROSTER);
    render(<GroupChat repoId={null} onBack={() => undefined} />);
    // No project, mode `project` ⇒ unscoped verdict applies: claude + pi.
    expect(chipKeys()).toEqual(['claude', 'pi']);
    fireEvent.click(screen.getByTestId('chat-scope-system'));
    expect(chipKeys()).toEqual(['claude', 'pi']);
    await user.click(screen.getByTestId('add-agent'));
    const options = await screen.findAllByTestId('agent-picker-option');
    expect(options.map((o) => o.dataset['agentKey'])).toEqual(['claude', 'pi']);
    const excluded = screen.getByTestId('agent-picker-excluded');
    expect(excluded.dataset['count']).toBe('1');
    expect(excluded.textContent).toMatch(/Can’t join an unscoped chat .*codex — signed out/);
  });
});
