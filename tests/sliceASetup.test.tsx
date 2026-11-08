import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useEffect } from 'react';
import type { RosterSeat } from '../src/api/types.js';
import { normalizeSnapshot } from '../src/api/system.js';
import { goodEnough, setupChecks, setupSettled } from '../src/board/firstUse.js';
import { agentRows } from '../src/board/agentsModel.js';
import { agentStatus } from '../src/board/calmAgents.js';
import { issueCopy } from '../src/board/agentsCopy.js';

vi.mock('../src/components/Terminal.js', () => ({
  Terminal: ({ open, onOpenError }: { open: (cols: number, rows: number) => Promise<unknown>; onOpenError: (e: unknown) => void }) => {
    useEffect(() => { void open(80, 24).catch(onOpenError); }, []); // eslint-disable-line react-hooks/exhaustive-deps
    return <div />;
  },
}));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: async () => ({ acp: { byCli: {} }, components: { engineBinaries: { 'wicked-estate': estateVersion } } }), isDiagnosticsUnsupported: () => false }));

const { AgentsPage } = await import('../src/components/agents/AgentsPage.js');
const { ContainerSignInProvider } = await import('../src/components/agents/containerSignIn.js');
const { useAuthOps } = await import('../src/components/agents/agentLogin.js');
const { resetAgentsReads } = await import('../src/store/agentsReads.js');
const { resetFirstUseReads, useFirstUseReads } = await import('../src/store/firstUseReads.js');
const { clearCachedRoster } = await import('../src/store/rosterCache.js');

const helper = (extra: Partial<RosterSeat> = {}): RosterSeat => ({
  key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true,
  auth: 'signed_out', council_eligible: false, sign_in: 'container',
  issues: [{ code: 'signed_out', severity: 'problem', params: {}, message: 'signed out' }], ...extra,
});
let estateVersion: string | null | undefined;
let roster: RosterSeat[];
let refusal: { status: number; body: Record<string, unknown> };
let infra: { key: string; state: string }[];
let settings: Record<string, unknown>;
let warnings: unknown[];
let writes: unknown[];
const response = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  resetAgentsReads(); resetFirstUseReads(); clearCachedRoster(); localStorage.clear();
  useAuthOps.setState({ pending: {}, checking: {} });
  estateVersion = null;
  roster = [helper()];
  refusal = { status: 503, body: { error: 'docker API unavailable' } };
  infra = [{ key: 'skills', state: 'down' }, { key: 'estate', state: 'down' }, { key: 'seat_images', state: 'down' }];
  settings = {}; warnings = []; writes = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const path = new URL(input).pathname.replace(/^\/api\/v1/, '');
    if (path === '/roster') return response({ roster });
    if (path === '/roster/record') return response({ seats: [], days: 7, runsRead: 0 });
    if (path === '/seats/claude/container-login') return response(refusal.body, refusal.status);
    if (path === '/health') return response({ status: 'ok', capabilities: { system: true }, warnings });
    if (path === '/system') return response({ infra });
    if (path === '/settings') {
      if (init?.method === 'PUT' || init?.method === 'PATCH') writes.push(init.body);
      return response({ settings });
    }
    if (path === '/repos') return response({ repos: [{ id: 'r' }] });
    if (path === '/projects') return response({ projects: [] });
    return response({});
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const page = (search = '?fix=claude') => render(<ContainerSignInProvider><AgentsPage search={search} navigate={vi.fn()} /></ContainerSignInProvider>);
async function failSignIn(): Promise<HTMLElement> {
  page();
  fireEvent.click(await screen.findByTestId('agents-signin'));
  const result = await screen.findByTestId('agents-check-result');
  await waitFor(() => expect(result).toHaveAttribute('data-state', 'signin-failed'));
  return result;
}

describe('A-C3 sign-in opening failures', () => {
  it.each([
    [502, { error: 'Cannot connect to the Docker daemon at unix:///var/run/docker.sock' }],
    [503, { error: 'docker API unavailable' }],
    [503, { error: 'the container runtime did not start' }],
    [502, { error: 'Docker is not running' }],
    [502, { error: 'container runtime stopped' }],
  ])('explains the runtime action for HTTP %s and %j', async (status, body) => {
    refusal = { status, body };
    const result = await failSignIn();
    expect(result).toHaveTextContent('The container runtime isn’t running. Start Docker Desktop or Rancher Desktop, then try again.');
    const main = result.cloneNode(true) as HTMLElement;
    main.querySelectorAll('details').forEach((d) => d.remove());
    expect(main).not.toHaveTextContent(/docker.sock|unix:|docker API|Cannot connect/);
  });
  it.each([
    { error: 'claude is not installed on this host' },
  ])('explains how to install the helper for %j', async (body) => {
    refusal = { status: 502, body };
    expect(await failSignIn()).toHaveTextContent('Claude Code signs in with its own program on this computer, and it isn’t installed here. Install Claude Code on this computer, then try again.');
  });
  it.each([
    { error: 'a sign-in is already open for claude' },
    { error: 'a sign-in is already open' },
  ])('explains an already-open sign-in for %j', async (body) => {
    refusal = { status: 409, body };
    expect(await failSignIn()).toHaveTextContent('A sign-in for Claude Code is already open (perhaps in a window you closed). Finish it, or wait a minute and try again.');
  });
  it('keeps an unfamiliar reason visible and conceals home paths on both platforms', async () => {
    const home = ['', 'Users', 'alice', 'x'].join('/');
    const windows = 'C:' + '\\' + 'Users' + '\\' + 'alice' + '\\' + 'x';
    refusal = { status: 422, body: { code: 'signin_failed', error: `Could not read ${home} or ${windows}.` } };
    const result = await failSignIn();
    expect(result).toHaveTextContent('Could not read ~/x or ~\\x.');
    expect(result).not.toHaveTextContent('alice');
  });
  it('describes the helper’s own host sign-in when the roster marks it', async () => {
    roster = [helper({ sign_in_on: 'host' })];
    page();
    const dialog = await screen.findByTestId('agents-modal');
    expect(dialog).toHaveTextContent('Studio opens Claude Code’s own sign-in on this computer; follow its steps there.');
    expect(dialog).not.toHaveTextContent('disposable');
  });
  it('keeps the host sign-in window free of container promises', async () => {
    roster = [helper({ sign_in_on: 'host' })];
    vi.mocked(fetch).mockImplementation(async (input) => {
      const path = new URL(String(input)).pathname;
      if (path.endsWith('/roster')) return response({ roster });
      if (path.endsWith('/container-login')) return new Promise<Response>(() => undefined);
      return response({});
    });
    page();
    fireEvent.click(await screen.findByTestId('agents-signin'));
    const login = await screen.findByTestId('agents-login');
    expect(login).toHaveTextContent('Opening Claude Code’s own sign-in on this computer');
    expect(login).not.toHaveTextContent('disposable container');
  });
  it('uses wording valid for either helper sign-in path', () => {
    const [row] = agentRows({ roster: [helper()], defaults: null, now: Date.now() });
    expect(issueCopy(row!.issues[0]!, row!, [row!], Date.now(), true).fix[0]!.text).toContain('Studio opens Claude Code’s sign-in; follow its steps there.');
    const hostSeat = helper();
    delete hostSeat.sign_in;
    const [host] = agentRows({ roster: [hostSeat], defaults: null, now: Date.now() });
    expect(issueCopy(host!.issues[0]!, host!, [host!], Date.now(), true).fix[0]!.text).toContain('own sign-in on this computer');
  });
});

describe('A-C9 missing helper', () => {
  it('shows one install problem for missing opencode, without safety or version warnings', async () => {
    roster = [helper({ key: 'opencode', binary: 'opencode', display_name: 'opencode', sign_in_on: 'host',
      version: { installed: null, install_source: null, checked_at: new Date().toISOString(), status: 'unproven', proven: '1.17.18', why: 'no_answer' },
      issues: [{ code: 'version_unproven', severity: 'warning', params: {}, message: 'not found' },
        { code: 'signed_out', severity: 'problem', params: {}, message: 'signed out' }],
    })];
    page('?fix=opencode');
    const modal = await screen.findByTestId('agents-modal');
    expect(modal).toHaveTextContent('opencode isn’t installed on this computer');
    expect(modal).toHaveTextContent('Install opencode on this computer, or turn it off in the helpers choice.');
    expect(within(modal).getAllByTestId('agents-issue')).toHaveLength(1);
    const [row] = agentRows({ roster, defaults: null, now: Date.now() });
    expect(agentStatus(row!)).toEqual({ word: 'Not installed', tone: 'fail', move: null });
    expect(modal).not.toHaveTextContent(/Safety checks are off|didn’t answer when studio asked|actions run unchecked/);
  });
  // fix-notinstalled (first-run-2): on the container floor the helper runs from its seat image and claude signs in
  // through a login container, so no claude on this computer's PATH is not "not installed".
  it('offers Sign in for claude on the container floor with no claude on this computer', async () => {
    const missing = { installed: null, install_source: null, checked_at: new Date().toISOString(), status: 'no_pin' as const, proven: null };
    roster = [helper({ sign_in_on: 'container', version: missing })];
    const [row] = agentRows({ roster, defaults: null, now: Date.now() });
    expect(agentStatus(row!).word).not.toBe('Not installed');
    page('?fix=claude');
    const modal = await screen.findByTestId('agents-modal');
    expect(modal).not.toHaveTextContent('isn’t installed');
    expect(within(modal).getByTestId('agents-signin')).toBeInTheDocument();
    // A crew that doesn't say where sign-in runs leaves a container helper signable (its refusal is C3's).
    const [older] = agentRows({ roster: [helper({ version: missing })], defaults: null, now: Date.now() });
    expect(agentStatus(older!).word).not.toBe('Not installed');
    // A host-sign-in helper (codex) already signed in keeps working from its image; signed out, it needs this computer's codex.
    const codex = (extra: Partial<RosterSeat>) => agentRows({ roster: [helper({ key: 'codex', binary: 'codex', display_name: 'Codex', sign_in_on: 'host', version: missing, ...extra })], defaults: null, now: Date.now() })[0]!;
    expect(agentStatus(codex({})).word).toBe('Not installed');
    expect(agentStatus(codex({ auth: 'signed_in', signed_in: true, issues: [] })).word).not.toBe('Not installed');
    // The host floor still calls a missing program not installed.
    const hostSeat = helper({ version: missing });
    delete hostSeat.sign_in;
    expect(agentStatus(agentRows({ roster: [hostSeat], defaults: null, now: Date.now() })[0]!).word).toBe('Not installed');
  });
  it('does not claim a signed-out helper with an unreadable version is taking unchecked actions', () => {
    const [row] = agentRows({ roster: [helper({ version: { installed: null, install_source: 'other', checked_at: new Date().toISOString(), status: 'unproven', proven: '1.17.18', why: 'no_answer' },
      issues: [{ code: 'version_unproven', severity: 'warning', params: {}, message: '' }] })], defaults: null, now: Date.now() });
    const copy = issueCopy(row!.issues.find((i) => i.code === 'version_unproven')!, row!, [row!], Date.now());
    expect(copy.what).toContain('can’t take work right now');
    expect(copy.what).not.toContain('actions run unchecked');
  });
});

describe('A-C4 complete setup guide', () => {
  it('stays on the Agents page on a second mount while skills and the code map service are not ready, even with a saved completion', async () => {
    settings = { 'studio.setup': { completedAt: 1 } };
    const first = page('');
    expect(await screen.findByTestId('agents-setup')).toBeInTheDocument();
    first.unmount(); resetFirstUseReads();
    page('');
    expect(await screen.findByTestId('agents-setup')).toBeInTheDocument();
    expect(writes).toHaveLength(0);
  });
  it('lists every blocking step with live done states and links, and uses accurate sign-in words', async () => {
    page('?setup=1');
    const guide = await screen.findByTestId('agents-setup');
    await waitFor(() => expect(screen.getByTestId('agents-setup-step-skills')).toHaveTextContent('Not done. Publish skills'));
    expect(guide).toHaveTextContent('Let’s get your helpers ready.');
    expect(guide).toHaveTextContent('Get one helper ready.');
    expect(guide).toHaveTextContent('Each sign-in opens the helper’s own sign-in; studio never sees your password.');
    expect(screen.getByTestId('agents-setup-step-estate')).toHaveTextContent('Install the code map service (wicked-estate) to add a repository.');
    expect(screen.getByTestId('agents-setup-step-runtime')).toHaveTextContent('Start Docker Desktop or Rancher Desktop');
    expect(within(guide).getByRole('button', { name: 'Open Skills' })).toBeInTheDocument();
    expect(within(guide).getAllByRole('button', { name: 'Open Nerve Center' })).toHaveLength(2);
    for (const key of ['skills', 'estate', 'runtime']) expect(screen.getByTestId(`agents-setup-step-${key}`)).toHaveAttribute('data-done', 'false');
  });
  it('treats absent readings as not checked, never done', async () => {
    infra = []; estateVersion = undefined;
    page('?setup=1');
    for (const key of ['skills', 'estate', 'runtime']) {
      const step = await screen.findByTestId(`agents-setup-step-${key}`);
      expect(step).toHaveAttribute('data-done', 'false');
      expect(step).toHaveTextContent('Not checked yet.');
    }
  });
  it('updates the skills, code map and runtime steps from fresh reads', async () => {
    page('?setup=1');
    await waitFor(() => expect(screen.getByTestId('agents-setup-step-skills')).toHaveTextContent('Not done.'));
    estateVersion = '1.0.0';
    infra = [{ key: 'skills', state: 'ok' }, { key: 'seat_images', state: 'ok' }];
    await act(async () => { await useFirstUseReads.getState().load(true); });
    for (const key of ['skills', 'estate', 'runtime']) expect(screen.getByTestId(`agents-setup-step-${key}`)).toHaveAttribute('data-done', 'true');
    expect(writes).toHaveLength(0); // A helper still needs to sign in.
  });
  it('calls an unread helper sign-in not checked yet', async () => {
    roster = [helper({ auth: 'unknown', issues: [] })];
    page('?setup=1');
    await waitFor(() => expect(screen.getByTestId('agents-setup-step-agents')).toHaveTextContent('Not checked yet.'));
    expect(screen.getByTestId('agents-setup-step-agents')).toHaveAttribute('data-done', 'false');
  });
  it('requires every check for first completion, but unknown readings do not undo a saved completion', () => {
    const mode = { mode: 'admitted', class: null, source: 'acp_input_governance', reason: '', fence: { write_roots: [], read_roots: [], network: 'open' as const } };
    const governed = { ...mode, mode: 'admitted' as const, source: 'acp_input_governance' as const };
    const [row] = agentRows({ roster: [helper({ auth: 'signed_in', council_eligible: true, issues: [],
      governance_mode: { unscoped: governed, scoped: governed, scoped_bound: governed },
    })], defaults: null, now: Date.now() });
    const facts = { rows: [row!], repos: 1, projects: 0, checks: { skills: true, estate: true, runtime: true, runtimeRequired: true } };
    expect(goodEnough(facts)).toBe(true);
    for (const key of ['skills', 'estate', 'runtime', 'runtimeRequired'] as const) {
      const incomplete = { ...facts, checks: { ...facts.checks, [key]: null } };
      expect(goodEnough(incomplete)).toBe(false);
      expect(setupSettled({ completedAt: 1 }, incomplete)).toBe(true);
    }
    expect(setupSettled({ skippedAt: 1 })).toBe(true);
    expect(goodEnough({ ...facts, checks: { ...facts.checks, runtime: null, runtimeRequired: false } })).toBe(true);
  });
  it('reads host mode and skills launch refusals without repeating raw errors', () => {
    const system = normalizeSnapshot({ infra: [{ key: 'skills', state: 'ok' }, { key: 'estate', state: 'ok' }, { key: 'seat_images', state: 'off' }] });
    expect(setupChecks(system)).toEqual({ skills: true, estate: null, runtime: false, runtimeRequired: false });
    expect(setupChecks(system, null, { components: { engineBinaries: { 'wicked-estate': null } } }).estate).toBe(false);
    expect(setupChecks(system, { warnings: [{ kind: 'skills.garden', severity: 'error', message: 'raw error' }] }).skills).toBe(false);
  });
});
