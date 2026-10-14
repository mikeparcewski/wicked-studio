import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { RosterSeat } from '../src/api/types.js';

/**
 * The container sign-in hooks (crew#1006) against a FAKE DAEMON: `fetch` is stubbed with a small
 * in-test crew that answers the real client's requests (`/roster`, `/seats/:key/container-login`,
 * `/seats/:key/container-logout`), so the URLs, methods and bodies studio sends are the ones under
 * test. The terminal is a stand-in that opens through the same `open` prop the real one calls and can
 * "exit" on demand (xterm needs a real layout). Nothing here signs anyone in.
 */
vi.mock('../src/components/Terminal.js', () => ({
  Terminal: ({ open, onOpenError, onExit }: { open?: (c: number, r: number) => Promise<{ id: string }>; onOpenError?: (e: unknown) => void; onExit?: () => void }) => {
    const [id, setId] = useState<string | null>(null);
    useEffect(() => { open?.(100, 30).then((r) => setId(r.id), (e) => onOpenError?.(e)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div data-testid="terminal-stub" data-id={id ?? ''}><button type="button" data-testid="terminal-stub-exit" onClick={() => onExit?.()}>exit</button></div>;
  },
}));
vi.mock('../src/api/diagnostics.js', () => ({
  getDiagnostics: () => Promise.resolve({ acp: { byCli: {} }, seatGovernance: { rosterFile: null, hostBoundary: 'sandbox-exec', seats: [] } }),
  isDiagnosticsUnsupported: () => false,
}));

const { AgentsPage } = await import('../src/components/agents/AgentsPage.js');
const { ContainerSignInProvider, offersContainer, waitForOutcome } = await import('../src/components/agents/containerSignIn.js');
const { useAuthOps } = await import('../src/components/agents/agentLogin.js');
const { resetAgentsReads } = await import('../src/store/agentsReads.js');
const { holdInert } = await import('../src/components/agents/inertHold.js');
const { clearCachedRoster } = await import('../src/store/rosterCache.js');

// ── the fake daemon ──────────────────────────────────────────────────────────
interface Daemon {
  signedIn: Record<string, boolean>;
  container: string[];
  /** GETs of the outcome that answer 404 before the ingest "lands". */
  ingestAfter: number;
  outcome: Record<string, { cli: string; ok: boolean; at: string; files?: string[]; expires_at?: number | null; error?: string }>;
  open: string | null;
  loginStatus: number;
  logoutStatus: number;
  calls: { method: string; path: string; body: unknown }[];
}
let d: Daemon;

const seat = (key: string, name: string): RosterSeat => {
  const on = d.signedIn[key] === true;
  return {
    key, display_name: name, binary: key, enabled_for_council: true, auth: on ? 'signed_in' : 'signed_out', signed_in: on,
    login_check: 'status', probed_at: new Date().toISOString(), council_eligible: on,
    login_invocation: `${key} login`, logout_invocation: `${key} logout`,
    // Like crew#1006: a signed-in seat whose check is `status` (every container seat) carries live_check_failed.
    issues: on ? [{ code: 'live_check_failed', severity: 'warning', params: {}, message: `${name}'s one live request did not answer` }]
      : [{ code: 'signed_out', severity: 'problem', params: {}, message: `${name} is signed out` }],
    ...(d.container.includes(key) ? { sign_in: 'container' } : {}),
  } as RosterSeat;
};

function respond(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

async function daemon(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? 'GET';
  const path = url.pathname.replace(/^\/api\/v1/, '');
  const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null;
  d.calls.push({ method, path: path + url.search, body });
  if (method === 'GET' && path === '/roster') {
    const refresh = url.searchParams.get('refresh');
    return respond(200, { roster: [seat('claude', 'Claude Code'), seat('codex', 'Codex')], ...(refresh !== null ? { refresh: { key: refresh, outcome: 'probed' } } : {}) });
  }
  if (method === 'GET' && path === '/roster/record') return respond(200, { days: 7, since: 0, until: 0, runsRead: 0, truncated: false, seats: [] });
  const m = /^\/seats\/([^/]+)\/container-(login|logout)$/.exec(path);
  if (m !== null) {
    const [, cli, verb] = m as unknown as [string, string, string];
    if (!d.container.includes(cli)) return respond(404, { error: `container ${verb} unavailable for seat: ${cli}` });
    if (verb === 'login' && method === 'GET') {
      if (d.outcome[cli] === undefined || d.ingestAfter-- > 0) return respond(404, { error: 'no outcome yet' });
      return respond(200, d.outcome[cli]);
    }
    if (verb === 'login') {
      if (d.loginStatus !== 201) return respond(d.loginStatus, { error: 'seat-login failed: no container runtime' });
      if (d.open !== null) return respond(409, { error: `a sign-in is already open for ${cli}` });
      d.open = cli;
      return respond(201, { terminalId: `login-${cli}-1`, cli, action: 'sign_in' });
    }
    if (d.logoutStatus !== 200) return respond(d.logoutStatus, { error: 'seat-login sign-out failed' });
    d.signedIn[cli] = false;
    return respond(200, { cli, action: 'sign_out' });
  }
  return respond(404, { error: `fake daemon: no ${method} ${path}` });
}

/** The login container's terminal exits after the user finished the CLI's sign-in: crew ingests it. */
function finishSignIn(cli: string): void {
  d.open = null;
  d.signedIn[cli] = true;
  d.outcome[cli] = { cli, ok: true, files: ['credentials.json'], expires_at: Date.now() + 3_600_000, at: new Date().toISOString() };
  fireEvent.click(screen.getByTestId('terminal-stub-exit'));
}

const navigate = vi.fn();
const renderTab = (search: string): ReturnType<typeof render> =>
  render(<ContainerSignInProvider><AgentsPage search={search} navigate={navigate} /></ContainerSignInProvider>);

beforeEach(() => {
  d = { signedIn: { claude: false, codex: true }, container: ['claude', 'codex'], ingestAfter: 2, outcome: {}, open: null, loginStatus: 201, logoutStatus: 200, calls: [] };
  vi.stubGlobal('fetch', vi.fn(daemon));
  useAuthOps.setState({ pending: {} });
  resetAgentsReads();
  clearCachedRoster();
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

const posts = (): { path: string; body: unknown }[] => d.calls.filter((c) => c.method === 'POST').map(({ path, body }) => ({ path, body }));

describe('container sign-in hooks (crew#1006)', () => {
  it('offers its buttons only for the agents crew marks sign_in: container', () => {
    expect(offersContainer({ key: 'claude', sign_in: 'container' } as unknown as RosterSeat)).toBe(true);
    expect(offersContainer({ key: 'claude' } as RosterSeat)).toBe(false);
    expect(offersContainer({ key: 'claude', sign_in: 'host' } as unknown as RosterSeat)).toBe(false);
  });

  it('a seat without a container sign-in keeps the copy-the-command steps', async () => {
    d.container = ['codex'];
    renderTab('?fix=claude');
    const dialog = await screen.findByRole('dialog', { name: 'Claude Code' });
    expect(within(dialog).queryByTestId('agents-signin')).toBeNull();
    expect(within(dialog).getByTestId('agents-command')).toHaveTextContent('claude login');
  });

  it('Sign in opens the login container’s terminal, and its exit flips the row to signed in', async () => {
    renderTab('?fix=claude');
    const modal = await screen.findByRole('dialog', { name: 'Claude Code' });
    expect(within(modal).queryByTestId('agents-command')).toBeNull();
    fireEvent.click(within(modal).getByTestId('agents-signin'));

    // The login terminal opens over the modal, through crew's route, with the terminal's size.
    const login = await screen.findByTestId('agents-login');
    expect(login).toHaveAttribute('data-agent', 'claude');
    await waitFor(() => expect(login).toHaveAttribute('data-state', 'open'));
    expect(screen.getByTestId('terminal-stub')).toHaveAttribute('data-id', 'login-claude-1');
    expect(posts()).toEqual([{ path: '/seats/claude/container-login', body: { cols: 100, rows: 30 } }]);
    expect(within(modal).getByTestId('agents-check-result')).toHaveAttribute('data-state', 'signing-in');

    // The CLI's sign-in finished: the terminal exits, studio waits for crew's ingest, then re-checks.
    finishSignIn('claude');
    await waitFor(() => expect(screen.queryByTestId('agents-login')).toBeNull());
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'container-in'), { timeout: 8000 });
    const gets = d.calls.filter((c) => c.method === 'GET').map((c) => c.path);
    expect(gets.filter((p) => p === '/seats/claude/container-login').length).toBeGreaterThanOrEqual(3); // 404, 404, then the outcome
    expect(gets.lastIndexOf('/roster?refresh=claude')).toBeGreaterThan(gets.lastIndexOf('/seats/claude/container-login'));
    expect(screen.getByTestId('agents-check-result')).toHaveTextContent('Claude Code is signed in.');
    expect(useAuthOps.getState().pending).toEqual({});
    // Signed in now: the footer's Sign out is the container button.
    expect(screen.getByTestId('agents-signout')).toHaveTextContent('Sign Claude Code out');
    // The broker's reading is no failed request (crew#1006 codes one): no such card, and the row says Signed in.
    expect(screen.queryAllByTestId('agents-issue').map((c) => c.getAttribute('data-code'))).not.toContain('live_check_failed');
    const row = screen.getAllByTestId('agents-row').find((r) => r.getAttribute('data-agent') === 'claude')!;
    expect(row).toHaveTextContent('Signed in');
    expect(row).not.toHaveTextContent('Looks signed in');
  }, 15_000);

  it('a container that cannot be opened says so and frees the agent', async () => {
    d.loginStatus = 502;
    renderTab('?fix=claude');
    const modal = await screen.findByRole('dialog', { name: 'Claude Code' });
    fireEvent.click(within(modal).getByTestId('agents-signin'));
    await waitFor(() => expect(within(modal).getByTestId('agents-check-result')).toHaveAttribute('data-state', 'signin-failed'));
    expect(screen.queryByTestId('agents-login')).toBeNull();
    expect(useAuthOps.getState().pending).toEqual({});
    expect(within(modal).getByTestId('agents-signin')).not.toBeDisabled();
  });

  it('closing the login window before the container opened holds the agent until its POST answers (codex r4)', async () => {
    const release: ((r: Response) => void)[] = [];
    let held = 0;
    vi.stubGlobal('fetch', vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      // The first two sign-ins' POSTs hang (the engine building the seat image); later ones are the daemon's.
      if (init?.method === 'POST' && held++ < 2) { d.calls.push({ method: 'POST', path: String(input), body: null }); return new Promise<Response>((r) => { release.push(r); }); }
      return daemon(input, init);
    }));
    renderTab('?fix=claude');
    const modal = await screen.findByRole('dialog', { name: 'Claude Code' });
    fireEvent.click(within(modal).getByTestId('agents-signin'));
    const login = await screen.findByTestId('agents-login');
    expect(login).toHaveAttribute('data-state', 'opening');
    expect(screen.getByTestId('agents-login-line')).toHaveTextContent('The first sign-in can take a few minutes');
    fireEvent.click(screen.getByTestId('agents-login-close'));
    await waitFor(() => expect(screen.queryByTestId('agents-login')).toBeNull());
    // The window is gone, but the agent stays held: a retry now would meet crew's 409.
    expect(within(modal).getByTestId('agents-signin')).toBeDisabled();
    await act(async () => { release[0]!(respond(502, { error: 'no container runtime' })); await new Promise((r) => setTimeout(r, 20)); });
    await waitFor(() => expect(within(modal).getByTestId('agents-check-result')).toHaveAttribute('data-state', 'still'));
    expect(d.calls.some((c) => c.method === 'GET' && c.path === '/seats/claude/container-login')).toBe(false);

    // Again, and this time crew DID open it: studio waits for the closed terminal's ingest before handing back.
    fireEvent.click(within(modal).getByTestId('agents-signin'));
    await screen.findByTestId('agents-login');
    fireEvent.click(screen.getByTestId('agents-login-close'));
    d.outcome['claude'] = { cli: 'claude', ok: false, error: 'no credential', at: new Date().toISOString() };
    await act(async () => { release[1]!(respond(201, { terminalId: 'login-claude-9', cli: 'claude', action: 'sign_in' })); await new Promise((r) => setTimeout(r, 20)); });
    await waitFor(() => expect(within(modal).getByTestId('agents-check-result')).toHaveAttribute('data-state', 'still'), { timeout: 8000 });
    expect(d.calls.some((c) => c.method === 'GET' && c.path === '/seats/claude/container-login')).toBe(true);
    // The late open never reopens a window.
    expect(screen.queryByTestId('agents-login')).toBeNull();
  }, 15_000);

  it('an unknown container sign-in keeps a Sign in button (codex r4)', async () => {
    d.container = ['claude', 'codex'];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await daemon(input, init);
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      if (url.pathname !== '/api/v1/roster') return res;
      const body = await res.json() as { roster: Record<string, unknown>[] };
      body.roster = body.roster.map((x) => (x['key'] === 'claude' ? { ...x, auth: 'unknown', signed_in: null, issues: [] } : x));
      return respond(200, body);
    }));
    renderTab('?fix=claude');
    const modal = await screen.findByRole('dialog', { name: 'Claude Code' });
    const card = within(modal).getAllByTestId('agents-issue').find((c) => c.getAttribute('data-code') === 'auth_unknown')!;
    expect(card).toHaveTextContent('If it stays unknown, sign in again here.');
    expect(within(card).getByTestId('agents-signin')).toHaveTextContent('Sign in to Claude Code');
    expect(within(card).queryByTestId('agents-command')).toBeNull();
  });

  it('the login window is the one modal: the agent’s modal beneath is inert, and focus returns to it on close', async () => {
    renderTab('?fix=claude');
    const modal = await screen.findByRole('dialog', { name: 'Claude Code' });
    const button = within(modal).getByTestId('agents-signin');
    button.focus();
    fireEvent.click(button);
    const login = await screen.findByTestId('agents-login');
    expect(modal.closest('.wk-agents-scrim')).toHaveAttribute('inert');
    expect(document.activeElement).toBe(login);
    fireEvent.click(screen.getByTestId('agents-login-close'));
    await waitFor(() => expect(screen.queryByTestId('agents-login')).toBeNull());
    expect(modal.closest('.wk-agents-scrim')).not.toHaveAttribute('inert');
    // Its trigger is disabled while the sign-in settles, so the agent's dialog holds focus (codex r2).
    expect(document.activeElement).toBe(modal);
    // Let this sign-in settle here, so nothing of it runs into the next test (codex r6).
    d.outcome['claude'] = { cli: 'claude', ok: false, error: 'closed early', at: new Date().toISOString() };
    await waitFor(() => expect(useAuthOps.getState().pending).toEqual({}), { timeout: 8000 });
  }, 12_000);

  it('Escape closes the login window first, and an agent modal mounted beneath it meanwhile stays inert (codex r6)', async () => {
    const view = renderTab('?fix=claude');
    const first = await screen.findByRole('dialog', { name: 'Claude Code' });
    fireEvent.click(within(first).getByTestId('agents-signin'));
    const login = await screen.findByTestId('agents-login');
    expect(first.closest('.wk-agents-scrim')).toHaveAttribute('inert');
    // Back, then Forward: the agent modal unmounts and mounts again under the open login window.
    view.rerender(<ContainerSignInProvider><AgentsPage search="" navigate={navigate} /></ContainerSignInProvider>);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Claude Code' })).toBeNull());
    view.rerender(<ContainerSignInProvider><AgentsPage search="?fix=claude" navigate={navigate} /></ContainerSignInProvider>);
    const again = await screen.findByTestId('agents-modal');
    await waitFor(() => expect(again.closest('.wk-agents-scrim')).toHaveAttribute('inert'));
    expect(again.contains(document.activeElement)).toBe(false);
    fireEvent.keyDown(login, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('agents-login')).toBeNull());
    // The agent modal stays (Escape closed one layer), and is no longer inert.
    expect(screen.getByTestId('agents-modal')).toBeInTheDocument();
    expect(screen.getByTestId('agents-modal').closest('.wk-agents-scrim')).not.toHaveAttribute('inert');
    d.outcome['claude'] = { cli: 'claude', ok: false, error: 'closed early', at: new Date().toISOString() };
    await waitFor(() => expect(useAuthOps.getState().pending).toEqual({}), { timeout: 8000 });
  }, 12_000);

  it('an outcome crew recorded without the terminal ever closing still ends the sign-in (codex r2)', async () => {
    d.ingestAfter = 0;
    renderTab('?fix=claude');
    const modal = await screen.findByRole('dialog', { name: 'Claude Code' });
    fireEvent.click(within(modal).getByTestId('agents-signin'));
    await waitFor(() => expect(screen.getByTestId('agents-login')).toHaveAttribute('data-state', 'open'));
    // The PTY exited before its socket registered: crew ingested, the socket never closes.
    d.signedIn['claude'] = true;
    d.outcome['claude'] = { cli: 'claude', ok: true, files: ['credentials.json'], expires_at: null, at: new Date().toISOString() };
    await waitFor(() => expect(screen.queryByTestId('agents-login')).toBeNull(), { timeout: 5000 });
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'container-in'), { timeout: 5000 });
  }, 10_000);

  it('the app root stays inert until the last modal over it lets go (codex r5: Back unmounts the agent modal first)', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const agentModal = holdInert(root);
    const loginWindow = holdInert(root);
    agentModal();
    agentModal(); // a second release of the same hold changes nothing
    expect(root).toHaveAttribute('inert');
    loginWindow();
    expect(root).not.toHaveAttribute('inert');
    // Inert for someone else's reason: left alone.
    root.setAttribute('inert', '');
    holdInert(root)();
    expect(root).toHaveAttribute('inert');
    root.remove();
  });

  it('a container seat’s signed-out card says to sign in here, never to run a command', async () => {
    renderTab('?fix=claude');
    const modal = await screen.findByRole('dialog', { name: 'Claude Code' });
    const card = within(modal).getAllByTestId('agents-issue').find((c) => c.getAttribute('data-code') === 'signed_out')!;
    expect(card).toHaveTextContent('Sign in here.');
    expect(card).not.toHaveTextContent('Run this');
    expect(card).not.toHaveTextContent('terminal');
    expect(card).toHaveTextContent('reads Claude Code’s sign-in from studio’s service');
  });

  it('Sign out calls the container sign-out and the re-check reads it signed out', async () => {
    renderTab('?fix=codex');
    const modal = await screen.findByRole('dialog', { name: 'Codex' });
    fireEvent.click(within(modal).getByTestId('agents-signout'));
    await waitFor(() => expect(screen.getByTestId('agents-check-result')).toHaveAttribute('data-state', 'out-done'));
    expect(posts()).toEqual([{ path: '/seats/codex/container-logout', body: null }]);
    expect(d.calls.some((c) => c.path === '/roster?refresh=codex')).toBe(true);
  });

  it('a refused sign-out says so', async () => {
    d.logoutStatus = 502;
    renderTab('?fix=codex');
    const modal = await screen.findByRole('dialog', { name: 'Codex' });
    fireEvent.click(within(modal).getByTestId('agents-signout'));
    await waitFor(() => expect(within(modal).getByTestId('agents-check-result')).toHaveAttribute('data-state', 'signout-failed'));
  });

  it('waits for crew’s ingest only so long (a lost outcome still hands back)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const pending = waitForOutcome('claude', 3_000, 1_000);
    await act(async () => { await vi.advanceTimersByTimeAsync(4_000); });
    await expect(pending).resolves.toBeNull();
    // A read that stalls is aborted at the deadline (codex r1), so the agent's lock is never held past it.
    const aborted: boolean[] = [];
    vi.stubGlobal('fetch', vi.fn((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => { aborted.push(true); reject(new DOMException('aborted', 'AbortError')); });
    })));
    const stalled = waitForOutcome('claude', 2_000, 500);
    await act(async () => { await vi.advanceTimersByTimeAsync(2_500); });
    await expect(stalled).resolves.toBeNull();
    expect(aborted).toEqual([true]);
    vi.stubGlobal('fetch', vi.fn(daemon));
    d.outcome['claude'] = { cli: 'claude', ok: false, error: 'no credential', at: new Date().toISOString() };
    d.ingestAfter = 0;
    await expect(waitForOutcome('claude', 3_000, 1_000)).resolves.toMatchObject({ ok: false });
  });
});
