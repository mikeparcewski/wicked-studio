import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import type { RosterSeat } from '../src/api/types.js';
import { setupChecks, setupSettled, UNCHECKED_SETUP } from '../src/board/firstUse.js';
import { normalizeSnapshot } from '../src/api/system.js';

vi.mock('../src/components/Terminal.js', () => ({
  Terminal: ({ open, onOpenError, onExit }: { open: (c: number, r: number) => Promise<unknown>; onOpenError: (e: unknown) => void; onExit: () => void }) => {
    useEffect(() => { void open(80, 24).catch(onOpenError); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <button onClick={onExit}>Finish helper sign-in</button>;
  },
}));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: async () => diagnostics, isDiagnosticsUnsupported: () => false }));
const { AgentsPage } = await import('../src/components/agents/AgentsPage.js');
const { ContainerSignInProvider } = await import('../src/components/agents/containerSignIn.js');
const { useFirstUseLanding } = await import('../src/components/agents/useFirstUseLanding.js');
const { useAuthOps } = await import('../src/components/agents/agentLogin.js');
const { resetAgentsReads } = await import('../src/store/agentsReads.js');
const { resetFirstUseReads, useFirstUseReads } = await import('../src/store/firstUseReads.js');
const { clearCachedRoster } = await import('../src/store/rosterCache.js');
let diagnostics: unknown;
let roster: RosterSeat[];
let settings: Record<string, unknown>;
let infra: unknown[];
let refusal: { status: number; body: Record<string, unknown> } | null;
let outcome: { ok: boolean } | null;
let deleteStatus: number;
let systemAvailable: boolean;
let holdSettings: Promise<void> | null;
let holdPost: Promise<void> | null;
const calls: { path: string; method: string; body: unknown }[] = [];
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const helper = (extra: Partial<RosterSeat> = {}): RosterSeat => ({
  key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true,
  auth: 'signed_out', signed_in: false, council_eligible: false, sign_in: 'container',
  issues: [{ code: 'signed_out', severity: 'problem', params: {}, message: 'not signed in' }], ...extra,
});

beforeEach(() => {
  resetAgentsReads(); resetFirstUseReads(); clearCachedRoster(); localStorage.clear();
  useAuthOps.setState({ pending: {}, checking: {} });
  diagnostics = { acp: { byCli: {} } };
  roster = [helper()]; settings = {}; infra = []; refusal = null; outcome = null;
  deleteStatus = 200; systemAvailable = true; holdSettings = null; holdPost = null; calls.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname.replace(/^\/api\/v1/, '');
    const method = init?.method ?? 'GET';
    calls.push({ path, method, body: init?.body });
    if (path === '/settings') { await holdSettings; return response({ settings }); }
    if (path === '/health') return response({ capabilities: { system: systemAvailable } });
    if (path === '/system') return response({ infra });
    if (path === '/roster') return response({ roster, refresh: { key: 'claude', outcome: 'probed' } });
    if (path === '/roster/record') return response({ seats: [], days: 7, runsRead: 0 });
    if (path === '/repos') return response({ repos: [{ id: 'r' }] });
    if (path === '/projects') return response({ projects: [] });
    if (path === '/seats/claude/container-login') {
      if (method === 'POST') { await holdPost; return refusal ? response(refusal.body, refusal.status) : response({ terminalId: 'login-1' }); }
      if (method === 'DELETE') { outcome = { ok: false }; return response({ closed: true }, deleteStatus); }
      return outcome ? response({ cli: 'claude', at: new Date().toISOString(), ...outcome }) : response({}, 404);
    }
    return response({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const page = (search = '') => render(<ContainerSignInProvider><AgentsPage search={search} navigate={vi.fn()} /></ContainerSignInProvider>);

describe('saved setup decisions', () => {
  it('does not redirect a completed install with absent or timed-out probes, or read its roster', async () => {
    settings = { 'studio.setup': { completedAt: 1 } }; systemAvailable = false;
    const navigate = vi.fn();
    renderHook(() => useFirstUseLanding('/', '', navigate));
    await waitFor(() => expect(useFirstUseReads.getState().state).toBe('ok'));
    expect(navigate).not.toHaveBeenCalled();
    expect(calls.some((c) => c.path === '/roster' || c.path === '/system' || c.path === '/repos')).toBe(false);
  });
  it('keeps completed setup settled for unknown checks but reopens for confirmed failures', () => {
    const facts = { rows: [], repos: 0, projects: 0, checks: UNCHECKED_SETUP };
    expect(setupSettled({ completedAt: 1 }, facts)).toBe(true);
    expect(setupSettled({}, facts)).toBe(false);
    for (const key of ['skills', 'estate', 'runtime'] as const) {
      expect(setupSettled({ completedAt: 1 }, { ...facts, checks: { ...UNCHECKED_SETUP, runtimeRequired: true, [key]: false } })).toBe(false);
    }
    expect(setupSettled({ skippedAt: 1 }, { ...facts, checks: { ...UNCHECKED_SETUP, estate: false } })).toBe(true);
  });
  it('does not reopen the Agents guide for unknown checks after a completed setup', async () => {
    settings = { 'studio.setup': { completedAt: 1 } };
    page();
    await waitFor(() => expect(useFirstUseReads.getState().state).toBe('ok'));
    expect(screen.queryByTestId('agents-setup')).toBeNull();
    await act(async () => { await useFirstUseReads.getState().load(true); });
    expect(screen.queryByTestId('agents-setup')).toBeNull();
  });
  it('waits for answered first-use reads before rendering the guide, even on its explicit address', async () => {
    let answer = () => {};
    holdSettings = new Promise<void>((r) => { answer = r; });
    page('?setup=1');
    expect(screen.queryByTestId('agents-setup')).toBeNull();
    await act(async () => { answer(); });
    expect(await screen.findByTestId('agents-setup')).toBeInTheDocument();
  });
  it('does not flash the automatic guide before settings arrive', async () => {
    let answer = () => {};
    holdSettings = new Promise<void>((r) => { answer = r; });
    settings = { 'studio.setup': { skippedAt: 1 } };
    page();
    expect(screen.queryByTestId('agents-setup')).toBeNull();
    await act(async () => { answer(); });
    await waitFor(() => expect(useFirstUseReads.getState().state).toBe('ok'));
    expect(screen.queryByTestId('agents-setup')).toBeNull();
  });
  it.each(["wicked-estate isn't installed: repositories need it to build their code map", 'wicked-estate is not installed'])('recognizes a confirmed missing estate installation: %s', async (reason) => {
    const system = normalizeSnapshot({ infra: [{ key: 'estate', state: 'down', reason }] });
    expect(setupChecks(system).estate).toBe(false);
    // This explicit failure also wins over a stale version reading.
    expect(setupChecks(system, null, { components: { engineBinaries: { 'wicked-estate': '1.0' } } }).estate).toBe(false);
    settings = { 'studio.setup': { completedAt: 1 } }; infra = [{ key: 'estate', state: 'down', reason }];
    page();
    expect(await screen.findByTestId('agents-setup-step-estate')).toHaveTextContent('Install the code map service');
  });
  it('retains null binary = missing, and does not treat an estate data-store failure as missing', () => {
    const system = normalizeSnapshot({ infra: [{ key: 'estate', state: 'down', reason: 'The data store could not be read' }] });
    expect(setupChecks(system).estate).toBeNull();
    expect(setupChecks(system, null, { components: { engineBinaries: { 'wicked-estate': null } } }).estate).toBe(false);
  });
});

describe('frozen sign-in refusals and next actions', () => {
  it.each([
    [502, 'container_runtime_down', 'Docker or Rancher needs to be started.', 'Start Docker Desktop or Rancher Desktop'],
    // The k8s runner's refusal kinds (crew maps wicked-core's FloorUnarmed kinds to these codes).
    [503, 'cluster_unreachable', 'Kubernetes needs to be started.', 'Start Rancher Desktop or Docker Desktop with Kubernetes on'],
    [503, 'no_cluster', 'This computer’s cluster isn’t set up for helpers yet.', 'Run wicked-core cluster install'],
    [503, 'controller_missing', 'This computer’s cluster isn’t set up for helpers yet.', 'Run wicked-core cluster install'],
    [503, 'pids_unlimited', 'The cluster needs a process limit first.', 'pod-max-pids'],
    [503, 'policy_refused', 'The cluster refused the sign-in.', 'Fix what it names'],
    [503, 'admission_pending', 'The cluster is full right now.', 'Try again when other work ends'],
    [503, 'image_unavailable', 'Claude Code’s image isn’t in the cluster yet.', 'Build Claude Code’s image'],
    [503, 'exec_stream_lost', 'The sign-in lost its connection.', 'Try signing in'],
    [502, 'cli_not_installed', 'Claude Code isn’t installed on this computer.', 'Install Claude Code on this computer'],
    [409, 'signin_already_open', 'Claude Code’s sign-in is already open.', 'Finish the open sign-in'],
    [409, 'signin_superseded', 'Another sign-in replaced this one.', 'Continue with the newer sign-in'],
    ...[400, 404, 500, 502].map((status) => [status, 'signin_failed', 'Couldn’t open Claude Code’s sign-in.', 'Try signing in again.']),
  ])('uses code %s/%s, preserves the plain line and masks paths', async (status, code, lead, action) => {
    const home = ['', 'Users', 'alice', 'x'].join('/');
    const windows = ['C:', 'Users', 'alice', 'x'].join('\\');
    refusal = { status: Number(status), body: { code, error: `Please check ${home} and ${windows}.`, cli: 'claude', terminalId: 'login-older' } };
    page('?fix=claude');
    fireEvent.click(await screen.findByTestId('agents-signin'));
    const result = await screen.findByTestId('agents-check-result');
    await waitFor(() => expect(result).toHaveAttribute('data-state', 'signin-failed'));
    expect(result).toHaveTextContent(String(lead));
    expect(result).toHaveTextContent('Please check ~/x and ~\\x.');
    // Crew's sentence already says what to do: studio adds no second action line (no Technical details either).
    if (code === 'signin_failed') expect(result).toHaveTextContent(String(action));
    else expect(result).not.toHaveTextContent(String(action));
    expect(result.textContent).not.toContain('Technical details');
    expect(result).not.toHaveTextContent('alice');
  });
  it('a coded cluster refusal without crew sentence still gets studio’s action (k8s runner)', async () => {
    refusal = { status: 503, body: { code: 'cluster_unreachable', error: '' } };
    page('?fix=claude');
    fireEvent.click(await screen.findByTestId('agents-signin'));
    const result = await screen.findByTestId('agents-check-result');
    await waitFor(() => expect(result).toHaveAttribute('data-state', 'signin-failed'));
    expect(result).toHaveTextContent('Start Rancher Desktop or Docker Desktop with Kubernetes on, then try again.');
  });
  it.each([['no_cluster'], ['controller_missing']])('a coded %s without crew sentence gives the whole install command', async (code) => {
    refusal = { status: 503, body: { code, error: '' } };
    page('?fix=claude');
    fireEvent.click(await screen.findByTestId('agents-signin'));
    const result = await screen.findByTestId('agents-check-result');
    await waitFor(() => expect(result).toHaveAttribute('data-state', 'signin-failed'));
    expect(result).toHaveTextContent('wicked-core cluster install --admin-context <your cluster context> --home <this daemon’s state home>');
  });
  it.each([[''], ['   '], [undefined]])('a policy refusal with no sentence (%j) says so and where to look', async (error) => {
    refusal = { status: 503, body: { code: 'policy_refused', ...(error !== undefined ? { error } : {}) } };
    page('?fix=claude');
    fireEvent.click(await screen.findByTestId('agents-signin'));
    const result = await screen.findByTestId('agents-check-result');
    await waitFor(() => expect(result).toHaveAttribute('data-state', 'signin-failed'));
    expect(result).toHaveTextContent('It gave no reason.');
    expect(result).toHaveTextContent('Open Nerve Center → Infra');
  });
  it('a cluster refusal masks escaped home paths and keeps the field its fix names', async () => {
    const escaped = ['C:', 'Users', 'alice', 'config'].join('\\\\');
    refusal = { status: 503, body: { code: 'policy_refused', error: `The cluster refused the Claude Code sign-in pod. The cluster said: webhook at ${escaped}: set securityContext.allowPrivilegeEscalation=false. Fix what it names, then try again.` } };
    page('?fix=claude');
    fireEvent.click(await screen.findByTestId('agents-signin'));
    const result = await screen.findByTestId('agents-check-result');
    await waitFor(() => expect(result).toHaveAttribute('data-state', 'signin-failed'));
    expect(result.textContent).not.toContain('alice');
    expect(result).toHaveTextContent('securityContext.allowPrivilegeEscalation=false');
  });
  it('a coded refusal without crew sentence still gets studio’s action', async () => {
    refusal = { status: 502, body: { code: 'container_runtime_down', error: '' } };
    page('?fix=claude');
    fireEvent.click(await screen.findByTestId('agents-signin'));
    const result = await screen.findByTestId('agents-check-result');
    await waitFor(() => expect(result).toHaveAttribute('data-state', 'signin-failed'));
    expect(result).toHaveTextContent('Start Docker Desktop or Rancher Desktop, then try again.');
  });
  it('keeps unrecognized older-service errors under Technical details', async () => {
    refusal = { status: 500, body: { error: 'internal_probe_failure: stack dump' } };
    page('?fix=claude');
    fireEvent.click(await screen.findByTestId('agents-signin'));
    const result = await screen.findByTestId('agents-check-result');
    await waitFor(() => expect(result).toHaveAttribute('data-state', 'signin-failed'));
    const main = result.cloneNode(true) as HTMLElement;
    main.querySelectorAll('details').forEach((d) => d.remove());
    expect(main).toHaveTextContent('Try again.');
    expect(main).not.toHaveTextContent('internal_probe_failure');
    expect(within(result).getByText('Technical details').closest('details')).not.toHaveAttribute('open');
  });
});

describe('unfinished sign-in cancellation', () => {
  it.each([200, 404, 405])('DELETEs without a body on close and tolerates status %s', async (status) => {
    deleteStatus = status;
    page('?fix=claude');
    fireEvent.click(await screen.findByTestId('agents-signin'));
    await screen.findByTestId('agents-login');
    fireEvent.click(screen.getByTestId('agents-login-close'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE')).toEqual([{ path: '/seats/claude/container-login', method: 'DELETE', body: undefined }]));
    await waitFor(() => expect(useAuthOps.getState().pending['claude']).toBeUndefined());
  });
  it('reports a failed cancellation plainly instead of hiding it', async () => {
    deleteStatus = 502;
    page('?fix=claude');
    fireEvent.click(await screen.findByTestId('agents-signin'));
    await screen.findByTestId('agents-login');
    fireEvent.click(screen.getByTestId('agents-login-close'));
    expect(await screen.findByTestId('agents-check-result')).toHaveTextContent('Studio couldn’t close the sign-in. Try again in a minute.');
    await waitFor(() => expect(useAuthOps.getState().pending['claude']).toBeUndefined());
  });
  it('waits for an opening POST before cancelling the same sign-in', async () => {
    let answer = () => {};
    holdPost = new Promise<void>((r) => { answer = r; });
    page('?fix=claude');
    fireEvent.click(await screen.findByTestId('agents-signin'));
    await screen.findByTestId('agents-login');
    fireEvent.click(screen.getByTestId('agents-login-close'));
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
    await act(async () => { answer(); });
    await waitFor(() => expect(calls.filter((c) => c.method === 'DELETE')).toHaveLength(1));
    await waitFor(() => expect(useAuthOps.getState().pending['claude']).toBeUndefined());
  });
  it('does not cancel a sign-in that finished', async () => {
    page('?fix=claude');
    fireEvent.click(await screen.findByTestId('agents-signin'));
    await screen.findByTestId('agents-login');
    outcome = { ok: true };
    fireEvent.click(screen.getByRole('button', { name: 'Finish helper sign-in' }));
    await waitFor(() => expect(useAuthOps.getState().pending['claude']).toBeUndefined());
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('helper sign-in wording and stopped Docker', () => {
  it('shows crew’s Kubernetes message and the Kubernetes start action (k8s runner)', async () => {
    roster = [helper({ auth: 'unknown', signed_in: null, health: { status: 'inactive', since: new Date().toISOString(), message: "Kubernetes isn't running" }, council_ineligible_reason: "Kubernetes isn't running", issues: [] })];
    page('?fix=claude');
    const row = await screen.findByTestId('agents-row');
    expect(row).toHaveTextContent("Kubernetes isn't running");
    expect(within(row).getByRole('button', { name: 'Start Kubernetes' })).toBeInTheDocument();
    expect(row).not.toHaveTextContent(/Not checked|signed out|Not signed in/i);
    const modal = await screen.findByTestId('agents-modal');
    expect(modal).toHaveTextContent('Start Rancher Desktop or Docker Desktop with Kubernetes on');
    expect(modal).not.toHaveTextContent(/Docker or Rancher is stopped|Sign-in couldn’t be read/i);
  });
  it('describes both possible sign-in paths truthfully by default, including the terminal layer', async () => {
    page('?fix=claude');
    const modal = await screen.findByTestId('agents-modal');
    expect(modal).toHaveTextContent('Studio opens Claude Code’s sign-in; follow its steps there.');
    expect(modal).not.toHaveTextContent('disposable container');
    fireEvent.click(screen.getByTestId('agents-signin'));
    const login = await screen.findByTestId('agents-login');
    expect(login).toHaveTextContent('Studio opens Claude Code’s sign-in; follow its steps there.');
    expect(login).not.toHaveTextContent('disposable container');
    outcome = { ok: true };
    fireEvent.click(screen.getByRole('button', { name: 'Finish helper sign-in' }));
    await waitFor(() => expect(useAuthOps.getState().pending['claude']).toBeUndefined());
  });
  it('shows crew’s Docker message and the start action in both row and modal for unknown auth', async () => {
    roster = [helper({ auth: 'unknown', signed_in: null, health: { status: 'inactive', since: new Date().toISOString(), message: "Docker isn't running" }, council_ineligible_reason: "Docker isn't running", issues: [] })];
    page('?fix=claude');
    const row = await screen.findByTestId('agents-row');
    expect(row).toHaveTextContent("Docker isn't running");
    expect(within(row).getByRole('button', { name: 'Start Docker or Rancher' })).toBeInTheDocument();
    expect(row).not.toHaveTextContent(/Not checked|signed out|Not signed in/i);
    const modal = await screen.findByTestId('agents-modal');
    expect(modal).toHaveTextContent("Docker isn't running");
    expect(modal).toHaveTextContent('Start Docker Desktop or Rancher Desktop');
    expect(modal).not.toHaveTextContent(/Not checked|signed out|Sign-in couldn’t be read/i);
  });
});
