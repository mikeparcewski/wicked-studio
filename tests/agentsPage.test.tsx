import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RosterSeat } from '../src/api/types.js';

/**
 * DES-seats-page §3.3 and §4.2: the Agents page's states, `?fix=` addresses, "I've signed in: check
 * again" on crew's on-demand re-check (`GET /roster?refresh=<key>`, A3b), and the sign-in hooks the
 * login-container lane wires (Sign in / Check now / Sign out). Read-only: the page never calls a write.
 */
const getRoster = vi.fn();
const getSeatRecord = vi.fn();
const getDiagnostics = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: { getRoster: (refresh?: string) => getRoster(refresh), getSeatRecord: () => getSeatRecord() },
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: () => getDiagnostics(), isDiagnosticsUnsupported: () => false }));

const { AgentsPage } = await import('../src/components/agents/AgentsPage.js');
const { resetAgentsReads } = await import('../src/store/agentsReads.js');
const { clearCachedRoster } = await import('../src/store/rosterCache.js');
const { ApiError } = await import('../src/api/errors.js');
const { AgentLoginProvider, useAuthOps } = await import('../src/components/agents/agentLogin.js');

const signedOutIssue = { code: 'signed_out', severity: 'problem', params: {}, message: 'Claude Code is signed out' } as const;

const claude = (extra: Partial<RosterSeat> & Record<string, unknown> = {}): RosterSeat => ({
  key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true,
  auth: 'signed_out', login_check: 'status', probed_at: new Date(Date.now() - 240_000).toISOString(), council_eligible: false,
  login_invocation: 'CLAUDE_CONFIG_DIR="/Users/reel-operator/.wicked-worker/claude" claude',
  logout_invocation: 'CLAUDE_CONFIG_DIR="/Users/reel-operator/.wicked-worker/claude" claude auth logout',
  issues: extra['auth'] === 'signed_in' ? [] : [signedOutIssue], ...extra,
});
const codex: RosterSeat = { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true, auth: 'signed_in', login_check: 'live', probed_at: new Date().toISOString(), council_eligible: true, issues: [], logout_invocation: 'codex logout' };
const pi: RosterSeat = { key: 'pi', display_name: 'Pi CLI', binary: 'pi', enabled_for_council: true, auth: 'signed_in', login_check: 'unverified', council_eligible: true, login_invocation: 'pi login',
  issues: [{ code: 'unverified', severity: 'note', params: {}, message: 'Pi CLI can’t be confirmed' }] };

const navigate = vi.fn();
const renderPage = (search = ''): ReturnType<typeof render> => render(<AgentsPage search={search} navigate={navigate} />);

beforeEach(() => {
  useAuthOps.setState({ pending: {}, checking: {} });
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
    // One sentence (the calm page): one of 3 is ready; the glance numbers sit behind "At a glance".
    await waitFor(() => expect(screen.getByTestId('agents-sentence')).toHaveTextContent('1 of 3 are ready to work.'));
    expect(screen.getByTestId('agents-tile-ready')).toHaveTextContent('1 / 3 · 1 more with limits · 1 signed out');
    expect(screen.getByTestId('agents-tile-fix')).toHaveTextContent('2 · plus 1 note');
    // Claude is signed out: its row says so, with Sign in beside it.
    expect(within(rows[0]!).getByText('Not signed in')).toBeInTheDocument();
    expect(within(rows[0]!).getByRole('button', { name: 'Sign in to Claude Code' })).toBeInTheDocument();
    expect(screen.getByTestId('agents-foot')).toHaveTextContent('Steps count the last 7 days (32 jobs)');
    // No agent's quality checks are reported yet: said once, in the footnote, not on every row.
    expect(within(rows[0]!).queryByTestId('agents-qe')).toBeNull();
    expect(screen.getByTestId('agents-foot')).toHaveTextContent('doesn’t report yet which agents can run quality checks');
  });

  it('loading: skeleton rows and no count', () => {
    getRoster.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByTestId('agents-loading')).toBeInTheDocument();
    expect(screen.getByTestId('agents-sentence')).toHaveTextContent('Asking each agent…');
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
    expect(await screen.findByTestId('agents-partial')).toHaveTextContent('how often each agent has to start fresh');
    expect(screen.getAllByTestId('agents-row')).toHaveLength(3);
  });
});

describe('?fix=<key> (§2.2)', () => {
  it('the fix button opens the modal address; ?fix opens the agent’s modal', async () => {
    const { unmount } = renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in to Claude Code' }));
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

describe('check again: crew’s on-demand re-check (§4.2, A3b)', () => {
  const openModal = async (): Promise<void> => {
    renderPage('?fix=claude');
    await screen.findByTestId('agents-check');
  };

  it('asks GET /roster?refresh=<key> once, shows checking, then re-derives the issues from the answer', async () => {
    await openModal();
    let answer: (v: unknown) => void = () => {};
    getRoster.mockImplementation((refresh?: string) => (refresh === 'claude' ? new Promise((r) => { answer = r; }) : Promise.resolve({ roster: [claude(), codex, pi] })));
    fireEvent.click(screen.getByTestId('agents-check'));
    expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'checking');
    expect(screen.getByTestId('agents-check')).toBeDisabled();
    await waitFor(() => expect(getRoster).toHaveBeenCalledWith('claude'));
    await act(async () => { answer({ roster: [claude({ auth: 'signed_in', login_check: 'live', council_eligible: true }), codex, pi], refresh: { key: 'claude', outcome: 'probed' } }); });
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'in'));
    expect(screen.getByTestId('agents-check-result')).toHaveTextContent('The sign-in worked, and Claude Code answered a request.');
    expect(screen.queryByTestId('agents-issue')).toBeNull();
    expect(getRoster.mock.calls.filter(([k]) => k === 'claude')).toHaveLength(1);
  });

  it('a fresh signed-out reading says "Still signed out" and keeps the card', async () => {
    await openModal();
    getRoster.mockResolvedValue({ roster: [claude(), codex, pi], refresh: { key: 'claude', outcome: 'probed' } });
    fireEvent.click(screen.getByTestId('agents-check'));
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'still'));
    expect(screen.getByTestId('agents-issue')).toHaveAttribute('data-code', 'signed_out');
  });

  it('the daemon’s check still running (timed_out): "still checking", the last reading stays', async () => {
    await openModal();
    getRoster.mockResolvedValue({ roster: [claude(), codex, pi], refresh: { key: 'claude', outcome: 'timed_out' } });
    fireEvent.click(screen.getByTestId('agents-check'));
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'not-rechecked'));
    expect(screen.getByTestId('agents-check-result')).toHaveTextContent('still checking');
    expect(screen.getByTestId('agents-issue')).toHaveAttribute('data-code', 'signed_out');
  });

  it('no fresh check behind the answer (not_probed, or no refresh field): never "it answered a request"', async () => {
    renderPage('?fix=codex');
    const dialog = await screen.findByRole('dialog', { name: 'Codex' });
    getRoster.mockResolvedValue({ roster: [claude(), codex, pi] });
    fireEvent.click(within(dialog).getByTestId('agents-check-now'));
    await waitFor(() => expect(within(dialog).getByTestId('agents-check-result')).toHaveAttribute('data-state', 'cant-confirm'));
  });

  it('a footer check that finds a sign-in problem shows its result at the top', async () => {
    renderPage('?fix=codex');
    const dialog = await screen.findByRole('dialog', { name: 'Codex' });
    getRoster.mockResolvedValue({ roster: [claude(), { ...codex, auth: 'signed_out', issues: [{ ...signedOutIssue, message: 'Codex is signed out' }] }, pi], refresh: { key: 'codex', outcome: 'probed' } });
    fireEvent.click(within(dialog).getByTestId('agents-check-now'));
    await waitFor(() => expect(within(dialog).getByTestId('agents-check-result')).toHaveAttribute('data-state', 'still'));
    expect(within(dialog).queryByTestId('agents-check-now')).toBeNull();
  });

  it('a failed read: "Couldn’t check just now", nothing re-derived', async () => {
    await openModal();
    getRoster.mockRejectedValue(new TypeError('Failed to fetch'));
    fireEvent.click(screen.getByTestId('agents-check'));
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'couldnt'));
    expect(screen.getByTestId('agents-issue')).toHaveAttribute('data-code', 'signed_out');
  });

  it('"Check sign-ins now" re-checks every agent with a sign-in, then reads once more', async () => {
    renderPage();
    // The page's moves sit behind its one quiet menu.
    fireEvent.click(await screen.findByTestId('agents-more-button'));
    fireEvent.click(await screen.findByTestId('agents-check-all'));
    await waitFor(() => expect(getRoster.mock.calls.map(([k]) => k).filter(Boolean).sort()).toEqual(['claude', 'codex', 'pi']));
  });
});

describe('the sign-in hooks (login containers, option A)', () => {
  it('default: Sign in and Sign out are commands to copy; Check now re-checks on the daemon', async () => {
    renderPage('?fix=codex');
    const dialog = await screen.findByRole('dialog', { name: 'Codex' });
    expect(within(dialog).queryByTestId('agents-signin')).toBeNull();
    expect(within(dialog).getByTestId('agents-signout-how')).toHaveTextContent('Sign out');
    getRoster.mockResolvedValue({ roster: [claude(), codex, pi], refresh: { key: 'codex', outcome: 'probed' } });
    fireEvent.click(within(dialog).getByTestId('agents-check-now'));
    await waitFor(() => expect(within(dialog).getByTestId('agents-check-result')).toHaveAttribute('data-state', 'in'));
    expect(getRoster).toHaveBeenCalledWith('codex');
  });

  it('a provider’s hooks replace the copy steps with buttons and the re-check with its own', async () => {
    const signIn = vi.fn();
    const signOut = vi.fn();
    const checkNow = vi.fn().mockResolvedValue({ roster: [claude({ auth: 'signed_in', login_check: 'live', council_eligible: true }), codex, pi], outcome: 'probed' });
    const { unmount } = render(<AgentLoginProvider hooks={{ signIn, signOut, checkNow }}><AgentsPage search="?fix=claude" navigate={navigate} /></AgentLoginProvider>);
    fireEvent.click(await screen.findByTestId('agents-signin'));
    expect(signIn).toHaveBeenCalledWith('claude', expect.any(Function)); // its waiting-state callback
    // The container sign-in replaces the terminal step: no command to copy on the signed-out card.
    expect(screen.queryByTestId('agents-command')).toBeNull();
    fireEvent.click(screen.getByTestId('agents-check'));
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'in'));
    expect(checkNow).toHaveBeenCalledWith('claude');
    // Signed in now: Sign out is the provider's button, not a copied command.
    fireEvent.click(screen.getByTestId('agents-signout'));
    expect(signOut).toHaveBeenCalledWith('claude');
    expect(screen.queryByTestId('agents-signout-how')).toBeNull();
    unmount();
  });

  it('a hook check that never answers is retired at the client deadline; a pending sign-out holds Check now', async () => {
    let done: () => void = () => {};
    const signOut = vi.fn(() => new Promise<void>((r) => { done = r; }));
    const checkNow = vi.fn(() => new Promise<never>(() => {}));
    render(<AgentLoginProvider hooks={{ signOut, checkNow }}><AgentsPage search="?fix=codex" navigate={navigate} /></AgentLoginProvider>);
    const dialog = await screen.findByRole('dialog', { name: 'Codex' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.click(within(dialog).getByTestId('agents-check-now'));
    expect(within(dialog).getByTestId('agents-check-result')).toHaveAttribute('data-state', 'checking');
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    expect(within(dialog).getByTestId('agents-check-result')).toHaveAttribute('data-state', 'not-rechecked');
    expect(within(dialog).getByTestId('agents-check-now')).not.toBeDisabled();
    fireEvent.click(within(dialog).getByTestId('agents-signout'));
    expect(signOut).toHaveBeenCalledWith('codex');
    await waitFor(() => expect(within(dialog).getByTestId('agents-check-now')).toBeDisabled());
    // The sign-out settles: the modal re-checks the agent at once (its row must say what the hook did).
    const before = checkNow.mock.calls.length;
    await act(async () => { done(); });
    await waitFor(() => expect(checkNow.mock.calls.length).toBe(before + 1));
    expect(within(dialog).getByTestId('agents-check-result')).toHaveAttribute('data-state', 'checking');
  });

  it('a failed sign-out says so and gives the button back', async () => {
    const signOut = vi.fn(() => Promise.reject(new Error('container gone')));
    render(<AgentLoginProvider hooks={{ signOut }}><AgentsPage search="?fix=codex" navigate={navigate} /></AgentLoginProvider>);
    const dialog = await screen.findByRole('dialog', { name: 'Codex' });
    fireEvent.click(within(dialog).getByTestId('agents-signout'));
    await waitFor(() => expect(within(dialog).getByTestId('agents-check-result')).toHaveAttribute('data-state', 'signout-failed'));
    expect(within(dialog).getByTestId('agents-signout')).not.toBeDisabled();
  });

  it('a sign-in hook that fails says so; a check in flight is retired first', async () => {
    const signIn = vi.fn(() => { throw new Error('no container runtime'); });
    render(<AgentLoginProvider hooks={{ signIn }}><AgentsPage search="?fix=claude" navigate={navigate} /></AgentLoginProvider>);
    fireEvent.click(await screen.findByTestId('agents-signin'));
    expect(signIn).toHaveBeenCalledWith('claude', expect.any(Function));
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'signin-failed'));
  });

  it('a sign-out still running holds the agent after the modal closes and reopens (per-agent lock)', async () => {
    let done: () => void = () => {};
    const signOut = vi.fn(() => new Promise<void>((r) => { done = r; }));
    const first = render(<AgentLoginProvider hooks={{ signOut }}><AgentsPage search="?fix=codex" navigate={navigate} /></AgentLoginProvider>);
    fireEvent.click(await screen.findByTestId('agents-signout'));
    first.unmount();
    render(<AgentLoginProvider hooks={{ signOut }}><AgentsPage search="?fix=codex" navigate={navigate} /></AgentLoginProvider>);
    const dialog = await screen.findByRole('dialog', { name: 'Codex' });
    expect(within(dialog).getByTestId('agents-signout')).toBeDisabled();
    expect(within(dialog).getByTestId('agents-check-now')).toBeDisabled();
    await act(async () => { done(); });
    await waitFor(() => expect(within(dialog).getByTestId('agents-signout')).not.toBeDisabled());
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('a sign-out that worked says so (signed out is the success here)', async () => {
    const signOut = vi.fn(() => Promise.resolve());
    const checkNow = vi.fn().mockResolvedValue({ roster: [claude(), { ...codex, auth: 'signed_out', issues: [{ ...signedOutIssue, message: 'm' }] }, pi], outcome: 'probed' });
    render(<AgentLoginProvider hooks={{ signOut, checkNow }}><AgentsPage search="?fix=codex" navigate={navigate} /></AgentLoginProvider>);
    fireEvent.click(await screen.findByTestId('agents-signout'));
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'out-done'));
  });

  it('closed mid-sign-out: the agent stays locked until the background refresh lands in the shared roster', async () => {
    let done: () => void = () => {};
    let answer: (v: unknown) => void = () => {};
    const signOut = vi.fn(() => new Promise<void>((r) => { done = r; }));
    const checkNow = vi.fn(() => new Promise((r) => { answer = r; }));
    const first = render(<AgentLoginProvider hooks={{ signOut, checkNow: checkNow as never }}><AgentsPage search="?fix=codex" navigate={navigate} /></AgentLoginProvider>);
    fireEvent.click(await screen.findByTestId('agents-signout'));
    first.unmount();
    await act(async () => { done(); });
    await waitFor(() => expect(checkNow).toHaveBeenCalledWith('codex'));
    expect(useAuthOps.getState().pending['codex']).toBe('out');
    await act(async () => { answer({ roster: [claude(), { ...codex, auth: 'signed_out' }, pi], outcome: 'probed' }); });
    await waitFor(() => expect(useAuthOps.getState().pending['codex']).toBeUndefined());
  });
});
