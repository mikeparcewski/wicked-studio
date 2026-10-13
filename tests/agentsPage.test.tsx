import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RosterSeat } from '../src/api/types.js';

/**
 * DES-seats-page §3.3 and §4.2: the Agents page's states, `?fix=` addresses, and the one interim
 * polling contract for "I've signed in: check again" (every 5 s, at most 45 s, until this agent's
 * `probed_at` is newer than the click). Read-only: the page never calls a write.
 */
const getRoster = vi.fn();
const getSeatRecord = vi.fn();
const getDiagnostics = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: { getRoster: () => getRoster(), getSeatRecord: () => getSeatRecord() },
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: () => getDiagnostics(), isDiagnosticsUnsupported: () => false }));

const { AgentsPage } = await import('../src/components/agents/AgentsPage.js');
const { resetAgentsReads } = await import('../src/store/agentsReads.js');
const { clearCachedRoster } = await import('../src/store/rosterCache.js');
const { ApiError } = await import('../src/api/errors.js');

const claude = (extra: Partial<RosterSeat> & Record<string, unknown> = {}): RosterSeat => ({
  key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true,
  auth: 'signed_out', login_check: 'status', probed_at: new Date(Date.now() - 240_000).toISOString(), council_eligible: false,
  login_invocation: 'CLAUDE_CONFIG_DIR="/Users/reel-operator/.wicked-worker/claude" claude', ...extra,
});
const codex: RosterSeat = { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, auth: 'signed_in', login_check: 'live', probed_at: new Date().toISOString(), council_eligible: true };
const pi: RosterSeat = { key: 'pi', display_name: 'Pi CLI', binary: 'pi', enabled_for_council: true, auth: 'signed_in', login_check: 'unverified', council_eligible: true, login_invocation: 'pi login' };

const navigate = vi.fn();
const renderPage = (search = ''): ReturnType<typeof render> => render(<AgentsPage search={search} navigate={navigate} />);

beforeEach(() => {
  resetAgentsReads();
  clearCachedRoster();
  navigate.mockReset();
  getRoster.mockReset().mockResolvedValue({ roster: [claude(), codex, pi] });
  getSeatRecord.mockReset().mockResolvedValue({ days: 7, since: 0, until: 0, runsRead: 32, truncated: false, seats: [] });
  getDiagnostics.mockReset().mockResolvedValue({ acp: { byCli: {} }, seatGovernance: { rosterFile: null, hostBoundary: 'sandbox-exec', seats: [] } });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the page and its states (§3.3)', () => {
  it('renders one row per agent with a summary count and the week footnote', async () => {
    renderPage();
    const rows = await screen.findAllByTestId('agents-row');
    expect(rows.map((r) => r.getAttribute('data-agent'))).toEqual(['claude', 'codex', 'pi']);
    // The four tiles (approved tab concept): pi + codex usable of 3; claude is signed out.
    await waitFor(() => expect(screen.getByTestId('agents-tile-ready')).toHaveTextContent('Ready for work1 / 31 more with limits · 1 signed out'));
    expect(screen.getByTestId('agents-tile-fix')).toHaveTextContent('Things to fix2plus 1 note');
    expect(screen.getByTestId('agents-foot')).toHaveTextContent('last 7 days (32 jobs)');
    // No agent's quality checks are reported yet: said once, in the footnote, not on every row.
    expect(within(rows[0]!).queryByTestId('agents-qe')).toBeNull();
    expect(screen.getByTestId('agents-foot')).toHaveTextContent('doesn’t report yet which agents can run quality checks');
  });

  it('loading: skeleton rows and no count', () => {
    getRoster.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('agents-loading')).toHaveTextContent('Asking each agent…');
    expect(screen.queryByTestId('agents-tiles')).toBeNull();
    expect(screen.queryByTestId('agents-check-all')).toBeNull();
  });

  it('error: "Couldn’t load agents." with Retry, and no header action', async () => {
    getRoster.mockRejectedValue(new ApiError(500, 'boom'));
    renderPage();
    expect(await screen.findByTestId('agents-banner')).toHaveTextContent('Couldn’t load agents.');
    expect(screen.queryByTestId('agents-check-all')).toBeNull();
  });

  it('offline: the service is unreachable', async () => {
    getRoster.mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage();
    expect(await screen.findByTestId('agents-banner')).toHaveAttribute('data-kind', 'offline');
  });

  it('empty: names the agents to install, with the install docs and Check again', async () => {
    getRoster.mockResolvedValue({ roster: [] });
    renderPage();
    expect(await screen.findByTestId('agents-empty')).toHaveTextContent('No AI agents found on this computer.');
    expect(screen.getByRole('link', { name: 'How to install an agent' })).toHaveAttribute('href', expect.stringContaining('wicked-crew'));
  });

  it('partial: diagnostics failed — the table renders, a banner names what is missing', async () => {
    getDiagnostics.mockRejectedValue(new ApiError(500, 'x'));
    renderPage();
    expect(await screen.findByTestId('agents-partial')).toHaveTextContent('how each agent is governed');
    expect(screen.getAllByTestId('agents-row')).toHaveLength(3);
  });
});

describe('?fix=<key> (§2.2)', () => {
  it('the fix button opens the modal address; ?fix opens the agent’s modal', async () => {
    const { unmount } = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Claude Code: 1 problem/ }));
    expect(navigate).toHaveBeenCalledWith('/agents?fix=claude');
    unmount();
    renderPage('?fix=claude');
    const dialog = await screen.findByRole('dialog', { name: 'Claude Code' });
    expect(within(dialog).queryByTestId('agents-modal-count')).toBeNull(); // one issue: its card says it once
    expect(within(dialog).getByTestId('agents-command').textContent).toBe('CLAUDE_CONFIG_DIR="$HOME/.wicked-worker/claude" claude');
    expect(dialog.textContent).not.toContain('/Users/reel-operator');
  });

  it('an unknown key lands on /agents with no modal and no error', async () => {
    renderPage('?fix=nobody');
    await screen.findAllByTestId('agents-row');
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/agents', { replace: true }));
    expect(screen.queryByTestId('agents-modal')).toBeNull();
  });
});

describe('check again: the interim polling contract (§4.2)', () => {
  const openModal = async (): Promise<void> => {
    renderPage('?fix=claude');
    await screen.findByTestId('agents-check');
  };

  it('polls every 5 s until this agent’s probe is newer than the click, then re-derives the issues', async () => {
    await openModal();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const reads = getRoster.mock.calls.length;
    fireEvent.click(screen.getByTestId('agents-check'));
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'checking');
    expect(screen.getByTestId('agents-check')).toBeDisabled();
    // The service re-checks: a fresh, live, signed-in reading.
    getRoster.mockResolvedValue({ roster: [claude({ auth: 'signed_in', login_check: 'live', probed_at: new Date(Date.now() + 3000).toISOString(), council_eligible: true }), codex, pi] });
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000); });
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'in'));
    expect(screen.getByTestId('agents-check-result')).toHaveTextContent('The sign-in worked, and Claude Code answered a request.');
    expect(screen.queryByTestId('agents-issue')).toBeNull();
    expect(getRoster.mock.calls.length - reads).toBe(2);
  });

  it('a fresh signed-out reading says "Still signed out" and keeps the card', async () => {
    await openModal();
    getRoster.mockResolvedValue({ roster: [claude({ probed_at: new Date(Date.now() + 1000).toISOString() }), codex, pi] });
    fireEvent.click(screen.getByTestId('agents-check'));
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'still'));
    expect(screen.getByTestId('agents-issue')).toHaveAttribute('data-code', 'signed_out');
  });

  it('no newer probe in 45 s: "hasn’t re-checked yet", the last reading stays', async () => {
    await openModal();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(screen.getByTestId('agents-check'));
    await act(async () => { await vi.advanceTimersByTimeAsync(46_000); });
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'not-rechecked'));
    expect(getRoster.mock.calls.length).toBeLessThanOrEqual(12);
  });

  it('a failed read: "Couldn’t check just now", nothing re-derived', async () => {
    await openModal();
    getRoster.mockRejectedValue(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByTestId('agents-check'));
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'couldnt'));
    expect(screen.getByTestId('agents-issue')).toHaveAttribute('data-code', 'signed_out');
  });
});
