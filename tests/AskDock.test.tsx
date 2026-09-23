import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApiError } from '../src/api/errors.js';
import type { Diagnostics } from '../src/api/diagnostics.js';
import type { RosterSeat } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * ASK — the app-wide assist-dock binding:
 *  - opening it fires READS only (the diagnostics probe + prompt-seed caches);
 *    NOTHING launches until the user sends — chips PREFILL, never submit;
 *  - the context pack CITES `GET /api/v1/diagnostics` when the daemon serves it, and
 *    DEGRADES HONESTLY when the route is absent (older crews) — both fixtures pinned;
 *  - a send opens ONE governed chat session over the GroupChat seat wire
 *    (`POST /chats` with the chat-capable roster, then `POST /chats/:id/messages`
 *    carrying question + pack) and later sends REUSE the warm session (pack rides
 *    the first message only).
 */

const openChat = vi.fn();
const sendChatMessage = vi.fn();
const getRoster = vi.fn();
const getChat = vi.fn();
const listRepos = vi.fn();
const listProjects = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    openChat: (...a: unknown[]) => openChat(...a),
    sendChatMessage: (...a: unknown[]) => sendChatMessage(...a),
    getRoster: (...a: unknown[]) => getRoster(...a),
    getChat: (...a: unknown[]) => getChat(...a),
    listRepos: (...a: unknown[]) => listRepos(...a),
    listProjects: (...a: unknown[]) => listProjects(...a),
    getRun: () => Promise.reject(new Error('no run snapshot in this rig')),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

vi.mock('../src/hooks/useEventStream.js', () => ({
  useEventStream: () => undefined,
}));

const { AskDock } = await import('../src/components/AskDock.js');
const { clearCachedRoster, setCachedRoster } = await import('../src/store/rosterCache.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');
const { useFailureClocks } = await import('../src/store/failureClocks.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useLiveChatsStore } = await import('../src/store/liveChats.js');

/** The live-daemon roster shape in miniature: the DAEMON states which seats it would seat
 *  (`chat_admission`, crew >= 0.7.36, F-W1-005) — studio holds no capability rule of its own. */
const ADMITTED = { unscoped: { ok: true }, scoped: { ok: true } };
const REFUSED = {
  ok: false,
  reason: 'it has no ACP adapter registered, and a scoped chat holds only ACP-governed seats',
  source: 'scope',
};
const ROSTER = [
  { key: 'claude', enabled_for_council: true, acp: { binary: 'claude-agent-acp' }, chat_admission: ADMITTED },
  { key: 'codex', enabled_for_council: true, chat_admission: { unscoped: REFUSED, scoped: REFUSED } },
  { key: 'pi', enabled_for_council: false, acp: { binary: 'pi-acp' }, chat_admission: ADMITTED },
] as unknown as RosterSeat[];

const DIAGNOSTICS: Diagnostics = {
  components: {
    crew: '0.7.6',
    studioBundle: '0.4.6',
    coreTs: '0.7.6',
    engineBinaries: { 'wicked-core': '0.15.2', 'wicked-estate': null },
  },
  daemon: { uptimeMs: 3 * 3_600_000, startedAt: 1_800_000_000_000, port: 7701 },
  stores: [{ name: 'core.db', path: '/home/x/.wicked-crew/core.db', bytes: 12_400_000 }],
  recentErrors: [{ ts: 1_800_000_100_000, source: 'daemon', line: 'ECONNRESET on /ws' }],
  acp: {
    byCli: {
      claude: { sessionsStarted: 160, fallbacks: 85, fallbackKinds: { 'spawn-failed': 85 }, lastStartedTs: 1_800_000_000_000, lastFallbackTs: 1_790_000_000_000 },
      codex: { sessionsStarted: 0, fallbacks: 0, fallbackKinds: {}, lastStartedTs: null, lastFallbackTs: null },
    },
  },
};

function wireDiagnostics(mode: 'present' | 'absent'): void {
  apiFetch.mockImplementation((path: unknown) => {
    if (path === '/diagnostics') {
      return mode === 'present'
        ? Promise.resolve(DIAGNOSTICS)
        : Promise.reject(new ApiError(404, 'not found'));
    }
    return Promise.reject(new Error(`unexpected apiFetch path: ${String(path)}`));
  });
}

function dock(runs: ReturnType<typeof makeView>[] = [], pathname = '/steering'): void {
  render(<AskDock runs={runs} pathname={pathname} onClose={() => undefined} />);
}

beforeEach(() => {
  cleanup();
  openChat.mockReset();
  sendChatMessage.mockReset();
  getRoster.mockReset();
  getChat.mockReset();
  listRepos.mockReset();
  listProjects.mockReset();
  apiFetch.mockReset();
  clearCachedRoster();
  clearRepoCache();
  setCachedRoster(ROSTER);
  listRepos.mockResolvedValue({ repos: [] });
  listProjects.mockResolvedValue({ projects: [] });
  getChat.mockResolvedValue({ chatId: 'x', seats: ['claude', 'pi'] });
  openChat.mockImplementation((body: { chatId: string }) =>
    Promise.resolve({ chatId: body.chatId, seats: [{ cliKey: 'claude', ok: true }, { cliKey: 'pi', ok: true }] }),
  );
  sendChatMessage.mockResolvedValue({ seats: ['claude', 'pi'] });
  useProjectsStore.setState({ projects: [], loading: false, error: null });
  useLiveChatsStore.setState({ sessions: {} });
  useFailureClocks.setState({ failedAtByRun: {} });
  try { localStorage.clear(); } catch { /* stubbed in setup */ }
  // studio#323 R3: the Ask session persists per tab — every case starts with none.
  sessionStorage.clear();
});

describe('the context pack — diagnostics presence-gated, both fixtures', () => {
  it('CITES diagnostics when the daemon serves them (hint + the pack that rides the send)', async () => {
    const user = userEvent.setup();
    wireDiagnostics('present');
    dock();

    // The dock's empty state names what the pack will carry.
    await waitFor(() =>
      expect(screen.getByTestId('assist-empty')).toHaveTextContent('diagnostics cited (crew 0.7.6 · 1 stores · ACP health for 2 CLIs)'),
    );

    await user.type(screen.getByTestId('assist-input'), 'diagnose the studio');
    await user.click(screen.getByTestId('assist-send'));

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const [, message] = sendChatMessage.mock.calls[0] as [string, string];
    expect(message.startsWith('diagnose the studio')).toBe(true);
    expect(message).toContain('[studio context pack');
    expect(message).toContain('where: Steering (/steering)');
    expect(message).toContain('diagnostics (GET /api/v1/diagnostics):');
    expect(message).toContain('crew 0.7.6');
    expect(message).toContain('core.db 11.8 MB');
    expect(message).toContain('claude 160 sessions/85 fallbacks');
    expect(message).toContain('recent errors: 1 recorded — newest [daemon] ECONNRESET on /ws');
  });

  it('DEGRADES honestly when the route is absent — the pack says so, fabricating nothing', async () => {
    const user = userEvent.setup();
    wireDiagnostics('absent');
    dock();

    await waitFor(() =>
      expect(screen.getByTestId('assist-empty')).toHaveTextContent('Diagnostics are NOT served by this daemon (older crew — no GET /api/v1/diagnostics)'),
    );

    await user.type(screen.getByTestId('assist-input'), 'diagnose the studio');
    await user.click(screen.getByTestId('assist-send'));

    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    const [, message] = sendChatMessage.mock.calls[0] as [string, string];
    expect(message).toContain('diagnostics: NOT SERVED — this daemon has no GET /api/v1/diagnostics (older crew).');
    expect(message).not.toContain('crew 0.7.6');
  });
});

describe('nothing launches without the user sending', () => {
  it('mount + chip click fire NO chat wires — the chip only PREFILLS the composer', async () => {
    const user = userEvent.setup();
    wireDiagnostics('present');
    dock([makeView({ id: 'run-dead-1', status: 'failed', problem: 'ship the parser' })]);

    await waitFor(() => expect(screen.getByTestId('assist-prompts')).toBeInTheDocument());
    const chips = screen.getAllByTestId('assist-prompt');
    // The failed-run chip prefills with THAT run's identity.
    const failChip = chips.find((c) => c.getAttribute('data-prompt')?.startsWith('Why did run'));
    expect(failChip).toBeDefined();
    expect(failChip).toHaveAttribute('data-prompt', 'Why did run run-dead fail?');
    await user.click(failChip!);
    const input = screen.getByTestId('assist-input');
    expect((input as HTMLTextAreaElement).value).toContain('run-dead-1');
    expect((input as HTMLTextAreaElement).value).toContain('ship the parser');

    // The always-on diagnostics chips exist too.
    expect(chips.some((c) => c.getAttribute('data-prompt') === 'Diagnose studio')).toBe(true);
    expect(chips.some((c) => c.getAttribute('data-prompt') === 'Is ACP healthy across the CLIs?')).toBe(true);

    // NOTHING was sent by any of that.
    expect(openChat).not.toHaveBeenCalled();
    expect(sendChatMessage).not.toHaveBeenCalled();
  });

  it('the failed-run chip seeds the NEWEST failure by the home queue’s own fold — never list order (E1)', async () => {
    wireDiagnostics('present');
    // List order leads with the STALE failure (the E1 campaign defect: a
    // 17-day-old run was seeded); the durable failure clocks — the same mirror
    // the home queue reads — say the other one is newest.
    useFailureClocks.setState({
      failedAtByRun: { 'stale-run-fail': Date.now() - 17 * 24 * 3_600_000, 'fresh-run-fail': Date.now() - 600_000 },
    });
    dock([
      makeView({ id: 'stale-run-fail', status: 'failed', problem: 'ancient breakage' }),
      makeView({ id: 'fresh-run-fail', status: 'failed', problem: 'fresh breakage' }),
    ]);

    await waitFor(() => expect(screen.getByTestId('assist-prompts')).toBeInTheDocument());
    const chips = screen.getAllByTestId('assist-prompt');
    const failChips = chips.filter((c) => c.getAttribute('data-prompt')?.startsWith('Why did run'));
    // ONE failed-run chip, and it names the queue's newest failure.
    expect(failChips).toHaveLength(1);
    expect(failChips[0]).toHaveAttribute('data-prompt', 'Why did run fresh-ru fail?');
  });
});

describe('the chat-launch wire — the GroupChat seat machinery, one warm session', () => {
  it('first send opens the chat with the seats the DAEMON would seat, and fans the seeded question out', async () => {
    const user = userEvent.setup();
    wireDiagnostics('present');
    dock();

    await user.type(screen.getByTestId('assist-input'), 'what is in the estate store?');
    await user.click(screen.getByTestId('assist-send'));

    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(1));
    const body = openChat.mock.calls[0]?.[0] as { chatId: string; clis?: string[] };
    expect(body.chatId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.clis).toEqual(['claude', 'pi']); // the seats the DAEMON would seat — codex is refused
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledWith(body.chatId, expect.stringContaining('what is in the estate store?')));

    // The chat block mounts for the session and the live-chats store knows it (rail row).
    expect(await screen.findByTestId('assist-chat')).toHaveAttribute('data-chat-id', body.chatId);
    expect(useLiveChatsStore.getState().sessions[body.chatId]?.seats).toEqual(['claude', 'pi']);
  });

  it('a second send REUSES the warm session and the pack rides the FIRST message only', async () => {
    const user = userEvent.setup();
    wireDiagnostics('present');
    dock();

    await user.type(screen.getByTestId('assist-input'), 'first question');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));

    await user.type(screen.getByTestId('assist-input'), 'follow-up');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));

    expect(openChat).toHaveBeenCalledTimes(1); // one session, reused
    const first = sendChatMessage.mock.calls[0] as [string, string];
    const second = sendChatMessage.mock.calls[1] as [string, string];
    expect(first[0]).toBe(second[0]); // same chat id
    expect(first[1]).toContain('[studio context pack');
    expect(second[1]).toBe('follow-up'); // no pack re-sent
    // Still ONE chat block — the session streams on, never a duplicate block.
    expect(screen.getAllByTestId('assist-chat')).toHaveLength(1);
  });

  it('a fully-failed open surfaces as an honest failure note, naming the seats', async () => {
    const user = userEvent.setup();
    wireDiagnostics('present');
    openChat.mockResolvedValue({ chatId: 'x', seats: [{ cliKey: 'claude', ok: false, error: 'no ACP config' }] });
    dock();

    await user.type(screen.getByTestId('assist-input'), 'hello?');
    await user.click(screen.getByTestId('assist-send'));

    const note = await screen.findByTestId('assist-note');
    expect(note).toHaveTextContent('No agent seat came up — claude: no ACP config');
    expect(sendChatMessage).not.toHaveBeenCalled();
  });
});

describe('the Ask session survives close/reopen, and promotes into the full chat (studio#323 R3)', () => {
  const FIXED_ID = '5e55104e-0000-4000-8000-000000000323';
  afterEach(() => {
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it('reopening Ask RESUMES the same session — no second POST /chats', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(FIXED_ID);
    sessionStorage.clear();
    const user = userEvent.setup();
    wireDiagnostics('present');

    dock();
    await user.type(screen.getByTestId('assist-input'), 'first question');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    expect(openChat).toHaveBeenCalledTimes(1);

    // Close Ask: App unmounts the dock (`{askOpen && <AskDock/>}`).
    cleanup();

    // Reopen: the session's block is back BEFORE any send, and a send rides it.
    dock();
    expect(screen.getByTestId('assist-chat')).toHaveAttribute('data-chat-id', FIXED_ID);
    await user.type(screen.getByTestId('assist-input'), 'after reopen');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(2));

    expect(openChat).toHaveBeenCalledTimes(1); // still ONE session
    expect(sendChatMessage.mock.calls[1]).toEqual([FIXED_ID, 'after reopen']);
  });

  it('a resumed session the daemon reaped opens a FRESH one for the next question', async () => {
    const ids = ['dead0000-0000-4000-8000-000000000001', 'f4e50000-0000-4000-8000-000000000002'];
    vi.spyOn(crypto, 'randomUUID').mockImplementation(() => ids.shift() as `${string}-${string}-${string}-${string}-${string}`);
    sessionStorage.clear();
    const user = userEvent.setup();
    wireDiagnostics('present');

    dock();
    await user.type(screen.getByTestId('assist-input'), 'first');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    cleanup();

    // The daemon no longer holds the first session: its message send is refused.
    sendChatMessage.mockImplementationOnce(() => Promise.reject(new ApiError(404, 'unknown chat')));
    // …and the probe proves it: GET /chats/:id answers NO seats (the daemon's "reclaimed").
    getChat.mockResolvedValue({ chatId: 'dead0000-0000-4000-8000-000000000001', seats: [] });
    dock();
    await user.type(screen.getByTestId('assist-input'), 'second');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(openChat).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(3));

    expect((openChat.mock.calls[1]?.[0] as { chatId: string }).chatId).toBe('f4e50000-0000-4000-8000-000000000002');
    expect(sendChatMessage.mock.calls[2]?.[0]).toBe('f4e50000-0000-4000-8000-000000000002');
  });

  it('a resumed send that fails while the chat is still WARM keeps the session — no second POST /chats, the error shows', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(FIXED_ID);
    const user = userEvent.setup();
    wireDiagnostics('present');

    dock();
    await user.type(screen.getByTestId('assist-input'), 'first');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));
    cleanup();

    // A transient 500 on the send — the daemon STILL holds the chat (warm seats).
    sendChatMessage.mockImplementationOnce(() => Promise.reject(new ApiError(500, 'daemon hiccup')));
    getChat.mockResolvedValue({ chatId: FIXED_ID, seats: ['claude', 'pi'] });
    dock();
    await user.type(screen.getByTestId('assist-input'), 'second');
    await user.click(screen.getByTestId('assist-send'));

    await waitFor(() =>
      expect(screen.getAllByTestId('assist-note').filter((n) => n.getAttribute('data-tone') === 'fail')).toHaveLength(1),
    );
    const failNote = screen.getAllByTestId('assist-note').find((n) => n.getAttribute('data-tone') === 'fail');
    expect(failNote).toHaveTextContent('daemon hiccup');
    expect(getChat).toHaveBeenCalledWith(FIXED_ID); // the gone-probe ran
    expect(openChat).toHaveBeenCalledTimes(1); // no fresh session minted
    expect(JSON.parse(sessionStorage.getItem('wicked.ask.session') ?? 'null')).toEqual({ chatId: FIXED_ID, title: 'first' });
  });

  it('"Open in full chat" navigates to /chat/:id for the dock session and closes the dock', async () => {
    vi.spyOn(crypto, 'randomUUID').mockReturnValue(FIXED_ID);
    sessionStorage.clear();
    const user = userEvent.setup();
    const navigate = vi.fn();
    const onClose = vi.fn();
    wireDiagnostics('present');

    render(<AskDock runs={[]} pathname="/" onClose={onClose} navigate={navigate} />);
    await user.type(screen.getByTestId('assist-input'), 'promote me');
    await user.click(screen.getByTestId('assist-send'));
    await waitFor(() => expect(sendChatMessage).toHaveBeenCalledTimes(1));

    await user.click(screen.getByTestId('assist-dock-expand'));

    expect(navigate).toHaveBeenCalledWith(`/chat/${FIXED_ID}`);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
