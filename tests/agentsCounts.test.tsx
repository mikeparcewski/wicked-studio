import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { RosterSeat } from '../src/api/types.js';

/**
 * The Agents readings agree wherever they are shown (verify-e2e round 2, 2026-10-14): the Desk's
 * "Agents ready" tile said "2 of 5 · 3 signed out" while the Agents tab said "Ready for work 1 / 5"
 * (the Desk counted `signed_in === true`, so a free agent read "signed out"); and an agent whose
 * sign-in the service had not read yet stayed "Unknown" until a reload.
 */
const getRoster = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: {
    getRoster: (refresh?: string) => getRoster(refresh),
    getSeatRecord: () => Promise.resolve({ days: 7, since: 0, until: 0, runsRead: 0, truncated: false, seats: [] }),
    getSettings: () => Promise.resolve({ settings: { graphNodeLimit: 150 } }),
  },
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: () => Promise.resolve({ acp: { byCli: {} } }), isDiagnosticsUnsupported: () => false }));
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
vi.mock('../src/hooks/useQualityChecks.js', () => ({ useQualityChecks: () => ({ tally: { read: 0, recorded: 0, passed: 0 }, failed: 0, capped: false }) }));
vi.mock('../src/hooks/useDeskRecord.js', () => ({
  useDeskRecord: () => ({ phase: 'done', reads: [], window: null, truncated: false }),
  useDeskRecordByProject: () => ({ phase: 'done', byProject: new Map(), truncated: false }),
}));
vi.mock('../src/hooks/useWindowSpend.js', () => ({ useWindowSpend: () => ({ phase: 'done', current: 0, previous: null, partial: false }) }));
vi.mock('../src/hooks/useStandingOrders.js', () => ({ useStandingOrders: () => ({ state: null }) }));

const { DeskV2 } = await import('../src/components/desk/DeskV2.js');
const { AgentsPage, UNKNOWN_REREAD_MS, UNKNOWN_REREADS } = await import('../src/components/agents/AgentsPage.js');
const { agentRows, agentTiles, readyNote } = await import('../src/board/agentsModel.js');
const { resetAgentsReads } = await import('../src/store/agentsReads.js');
const { clearCachedRoster } = await import('../src/store/rosterCache.js');
const { useProjectsStore } = await import('../src/store/projects.js');

const seat = (key: string, extra: Record<string, unknown>): RosterSeat => ({
  key, display_name: key, binary: key, enabled_for_council: true, council_eligible: true, issues: [], ...extra,
} as RosterSeat);
// The shape of verify-e2e's fresh-home roster: claude's check had not answered, codex is benched on
// repository work, pi signed in, copilot signed out, opencode needs no sign-in (opt-in).
const ROSTER: RosterSeat[] = [
  seat('claude', { auth: 'unknown', signed_in: null, login_check: 'unverified', council_eligible: false }),
  seat('codex', { auth: 'signed_in', signed_in: true, login_check: 'live', work_admission: { scoped_bound: { ok: false, reason_code: 'worktree_bench', source: 'launcher' } } }),
  seat('pi', { auth: 'signed_in', signed_in: true, login_check: 'unverified' }),
  seat('copilot', { auth: 'signed_out', signed_in: false, council_eligible: false }),
  seat('opencode', { auth: 'not_required', signed_in: false, optIn: true }),
];

beforeEach(() => {
  resetAgentsReads();
  clearCachedRoster();
  // Each read answers a fresh list, as a real fetch does.
  getRoster.mockReset().mockImplementation(() => Promise.resolve({ roster: ROSTER.map((s) => ({ ...s })) }));
  useProjectsStore.setState({ projects: [], load: vi.fn(async () => {}) });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('one count for "ready"', () => {
  it('the Desk tile and the Agents tab read the same rows: same number, same note', async () => {
    const t = agentTiles(agentRows({ roster: ROSTER, defaults: null, now: Date.now() }));
    // Not "signed in": opencode needs no sign-in, claude is unread, codex works with limits.
    expect(`${t.ready} of ${t.total}`).toBe('2 of 5');
    expect(readyNote(t)).toBe('1 more with limits · 1 can’t tell · 1 signed out');

    render(<DeskV2 runs={[]} runsLoaded needRows={[]} now={Date.now()} navigate={vi.fn()} search="?tab=work" />);
    const tile = await screen.findByTestId('desk-block-agents');
    await waitFor(() => expect(tile.querySelector('.wk-stat-value')).toHaveTextContent('2 of 5'));
    expect(tile.querySelector('.wk-stat-note')).toHaveTextContent('1 more with limits · 1 can’t tell · 1 signed out');
    cleanup();

    render(<AgentsPage search="" navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('agents-tile-ready')).toHaveTextContent('Ready for work2 / 51 more with limits · 1 can’t tell · 1 signed out'));
  });
});

describe('the Desk tile in every reading state, and with reviewer-only seats', () => {
  const desk = (): void => { render(<DeskV2 runs={[]} runsLoaded needRows={[]} now={Date.now()} navigate={vi.fn()} search="?tab=work" />); };
  const tile = (): HTMLElement => screen.getByTestId('desk-block-agents');

  it('loading: no number and no claim (never "all signed in" for nothing read)', async () => {
    getRoster.mockImplementation(() => new Promise(() => {}));
    desk();
    expect(tile().querySelector('.wk-stat-note')).toHaveTextContent('Reading…');
    expect(tile()).not.toHaveTextContent('all signed in');
  });

  it('a cold failed read: says it could not read them, no number', async () => {
    getRoster.mockRejectedValue(new Error('boom'));
    desk();
    await waitFor(() => expect(tile().querySelector('.wk-stat-note')).toHaveTextContent('couldn’t read the agents'));
    expect(tile().querySelector('.wk-stat-value')).toHaveTextContent('—');
  });

  it('a failed re-read keeps the last reading (the cached rows), as the Agents tab does', async () => {
    desk();
    await waitFor(() => expect(tile().querySelector('.wk-stat-value')).toHaveTextContent('2 of 5'));
    getRoster.mockRejectedValue(new Error('boom'));
    const { useAgentsReads } = await import('../src/store/agentsReads.js');
    await act(async () => { await useAgentsReads.getState().load(); });
    expect(tile().querySelector('.wk-stat-value')).toHaveTextContent('2 of 5');
  });

  it('reviewer-only seats: folded into their agent (same sign-in) or a row of their own — the same total on both surfaces', async () => {
    const roster = [
      ...ROSTER,
      seat('claude-judge', { display_name: 'claude (judge)', category: 'judge', auth: 'unknown', signed_in: null, login_check: 'unverified', council_eligible: false }), // folds into claude
      seat('codex-judge', { display_name: 'codex (judge)', category: 'judge', auth: 'signed_out', signed_in: false, council_eligible: false }), // codex is signed in: its own row
    ];
    getRoster.mockImplementation(() => Promise.resolve({ roster: roster.map((s) => ({ ...s })) }));
    const t = agentTiles(agentRows({ roster, defaults: null, now: Date.now() }));
    expect(t.total).toBe(6);
    desk();
    await waitFor(() => expect(tile().querySelector('.wk-stat-value')).toHaveTextContent(`${t.ready} of 6`));
    expect(tile().querySelector('.wk-stat-note')).toHaveTextContent(readyNote(t));
    cleanup();
    render(<AgentsPage search="" navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('agents-tile-ready')).toHaveTextContent(`Ready for work${t.ready} / 6${readyNote(t)}`));
  });
});

describe('an unread sign-in is read again (bounded)', () => {
  it('re-reads the roster alone every 15 s while a sign-in is unknown, and the row turns into the answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const signedIn = ROSTER.map((s) => (s.key === 'claude' ? { ...s, auth: 'signed_in', signed_in: true, login_check: 'live', council_eligible: true } : s));
    let calls = 0;
    getRoster.mockImplementation(() => { calls += 1; return Promise.resolve({ roster: (calls <= 2 ? ROSTER : signedIn).map((s) => ({ ...s })) }); });
    render(<AgentsPage search="" navigate={vi.fn()} />);
    const claudeSign = async (): Promise<string> => (await screen.findAllByTestId('agents-sign'))[0]!.textContent ?? '';
    await waitFor(async () => expect(await claudeSign()).toBe('Unknown'));
    const first = getRoster.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(UNKNOWN_REREAD_MS); });
    expect(getRoster.mock.calls.length).toBe(first + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(UNKNOWN_REREAD_MS); });
    await waitFor(async () => expect(await claudeSign()).toBe('Signed in'));
    // Once nothing is unread, nothing more is asked.
    const settled = getRoster.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(UNKNOWN_REREAD_MS * 3); });
    expect(getRoster.mock.calls.length).toBe(settled);
  });

  it('a failed full re-read keeps the cached Unknown row recovering on its own', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { setCachedRoster } = await import('../src/store/rosterCache.js');
    const { useAgentsReads } = await import('../src/store/agentsReads.js');
    // An earlier reading, with claude unread, already in BOTH the shared cache and the reads store (the
    // same list), so the panel's own full re-read on open is what decides the store's state.
    const earlier = ROSTER.map((s) => ({ ...s }));
    setCachedRoster(earlier);
    useAgentsReads.setState({ roster: earlier, rosterState: 'ok' });
    const signedIn = ROSTER.map((s) => (s.key === 'claude' ? { ...s, auth: 'signed_in', signed_in: true, login_check: 'live', council_eligible: true } : s)) as RosterSeat[];
    // The panel's own full re-read on open fails; the service then recovers.
    getRoster.mockReset().mockRejectedValueOnce(new Error('busy')).mockImplementation(() => Promise.resolve({ roster: signedIn.map((s) => ({ ...s })) }));
    render(<AgentsPage search="" navigate={vi.fn()} />);
    await waitFor(async () => expect((await screen.findAllByTestId('agents-sign'))[0]).toHaveTextContent('Unknown'));
    // The full re-read failed: the store says so, and keeps the cached rows.
    await waitFor(() => expect(useAgentsReads.getState().rosterState).toBe('failed'));
    expect(useAgentsReads.getState().roster).toBe(earlier);
    await act(async () => { await vi.advanceTimersByTimeAsync(UNKNOWN_REREAD_MS); });
    await waitFor(async () => expect((await screen.findAllByTestId('agents-sign'))[0]).toHaveTextContent('Signed in'));
  });

  it('a failed try does not stop the next one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<AgentsPage search="" navigate={vi.fn()} />);
    await screen.findAllByTestId('agents-row');
    const signedIn = ROSTER.map((s) => (s.key === 'claude' ? { ...s, auth: 'signed_in', signed_in: true, login_check: 'live', council_eligible: true } : s)) as RosterSeat[];
    getRoster.mockReset().mockRejectedValueOnce(new Error('busy')).mockImplementation(() => Promise.resolve({ roster: signedIn.map((s) => ({ ...s })) }));
    await act(async () => { await vi.advanceTimersByTimeAsync(UNKNOWN_REREAD_MS); });
    expect(getRoster).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(UNKNOWN_REREAD_MS); });
    expect(getRoster).toHaveBeenCalledTimes(2);
    await waitFor(async () => expect((await screen.findAllByTestId('agents-sign'))[0]).toHaveTextContent('Signed in'));
  });

  it('a late answer never overwrites a newer roster, nor lands after the panel is gone', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { getCachedRoster, setCachedRoster } = await import('../src/store/rosterCache.js');
    const view = render(<AgentsPage search="" navigate={vi.fn()} />);
    await screen.findAllByTestId('agents-row');
    let answer: (v: { roster: RosterSeat[] }) => void = () => {};
    getRoster.mockReset().mockImplementation(() => new Promise((r) => { answer = r; }));
    await act(async () => { await vi.advanceTimersByTimeAsync(UNKNOWN_REREAD_MS); });
    expect(getRoster).toHaveBeenCalledTimes(1);
    // A sign-in check deposits a newer roster while the poll is out…
    const newer = ROSTER.map((s) => (s.key === 'claude' ? { ...s, auth: 'signed_in', signed_in: true, login_check: 'live' } : { ...s })) as RosterSeat[];
    act(() => setCachedRoster(newer));
    // …then the poll's older answer lands: it is dropped.
    await act(async () => { answer({ roster: ROSTER.map((s) => ({ ...s })) }); await Promise.resolve(); });
    expect(getCachedRoster()).toBe(newer);
    // After unmount, nothing is deposited either.
    act(() => setCachedRoster(ROSTER.map((s) => ({ ...s }))));
    await act(async () => { await vi.advanceTimersByTimeAsync(UNKNOWN_REREAD_MS); });
    const before = getCachedRoster();
    view.unmount();
    await act(async () => { answer({ roster: newer.map((s) => ({ ...s })) }); await Promise.resolve(); });
    expect(getCachedRoster()).toBe(before);
  });

  it(`stops after ${UNKNOWN_REREADS} tries while it stays unknown`, async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<AgentsPage search="" navigate={vi.fn()} />);
    await screen.findAllByTestId('agents-row');
    const first = getRoster.mock.calls.length;
    for (let i = 0; i < UNKNOWN_REREADS + 3; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(UNKNOWN_REREAD_MS); });
    expect(getRoster.mock.calls.length - first).toBe(UNKNOWN_REREADS);
  });
});
