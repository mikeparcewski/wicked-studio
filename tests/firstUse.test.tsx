import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { GovernanceScopeKind, RosterSeat, SeatGovernanceMode } from '../src/api/types.js';
import { agentRows } from '../src/board/agentsModel.js';
import { goodEnough, readSetup, realProjects, setupAgents, setupMove } from '../src/board/firstUse.js';

/**
 * DES-seats-page §5: first use. The landing rule (only `/`, only until `studio.setup` is completed or
 * skipped, only when not good enough, never on a failed read), the setup steps reading the same
 * predicates, and `studio.setup` persisted once.
 */
const getRoster = vi.fn();
const getSettings = vi.fn();
const listRepos = vi.fn();
const listProjects = vi.fn();
const putSetup = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: {
    getRoster: (k?: string) => getRoster(k), getSeatRecord: () => Promise.resolve({ days: 7, since: 0, until: 0, runsRead: 0, truncated: false, seats: [] }),
    getAppearanceSettings: () => getSettings(), listRepos: () => listRepos(), listProjects: () => listProjects(), putSetupSettings: (s: unknown) => putSetup(s),
  },
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: () => Promise.resolve({ acp: { byCli: {} } }), isDiagnosticsUnsupported: () => false }));

const { useFirstUseLanding, SETUP_PATH } = await import('../src/components/agents/useFirstUseLanding.js');
const { AgentsPage } = await import('../src/components/agents/AgentsPage.js');
const { resetAgentsReads } = await import('../src/store/agentsReads.js');
const { resetFirstUseReads } = await import('../src/store/firstUseReads.js');
const { clearCachedRoster } = await import('../src/store/rosterCache.js');

const mode = (m: SeatGovernanceMode['mode'], source: SeatGovernanceMode['source']): SeatGovernanceMode => ({ mode: m, class: null, source, reason: 'r', fence: { write_roots: [], read_roots: [], network: 'open' } });
const all = (m: SeatGovernanceMode): Record<GovernanceScopeKind, SeatGovernanceMode> => ({ unscoped: m, scoped: m, scoped_bound: m });
const signedOut = (key: string, name: string): RosterSeat => ({
  key, display_name: name, binary: key, enabled_for_council: true, auth: 'signed_out', council_eligible: false, login_invocation: `${key} login`,
  governance_mode: all(mode('admitted', 'acp_input_governance')), issues: [{ code: 'signed_out', severity: 'problem', params: {}, message: 'm' }],
});
const ready = (key: string, name: string): RosterSeat => ({ ...signedOut(key, name), auth: 'signed_in', login_check: 'live', council_eligible: true, issues: [] });
const CODEX: RosterSeat = { ...ready('codex', 'Codex'), governance_mode: all(mode('os_sandbox', 'self')) };

beforeEach(() => {
  resetAgentsReads(); resetFirstUseReads(); clearCachedRoster(); localStorage.clear();
  getRoster.mockReset().mockResolvedValue({ roster: [signedOut('claude', 'Claude Code'), CODEX] });
  getSettings.mockReset().mockResolvedValue({ settings: {} });
  listRepos.mockReset().mockResolvedValue({ repos: [] });
  listProjects.mockReset().mockResolvedValue({ projects: [{ id: 'default' }] });
  putSetup.mockReset().mockResolvedValue({ settings: {} });
});
afterEach(() => cleanup());

describe('the rule (§5.1)', () => {
  const rows = (roster: RosterSeat[]) => agentRows({ roster, defaults: null, now: Date.now() });

  it('good enough = one agent ready for repository work and a repository or a real project', () => {
    // Codex alone is benched on repository jobs (studio's constant until work_admission): not enough.
    expect(setupAgents(rows([signedOut('claude', 'Claude Code'), CODEX]))).toHaveLength(0);
    expect(goodEnough({ rows: rows([ready('claude', 'Claude Code')]), repos: 0, projects: 0 })).toBe(false);
    expect(goodEnough({ rows: rows([ready('claude', 'Claude Code')]), repos: 1, projects: 0 })).toBe(true);
    expect(goodEnough({ rows: rows([ready('claude', 'Claude Code')]), repos: 0, projects: 1 })).toBe(true);
    expect(realProjects([{ id: 'default' }, { id: 'p1' }])).toBe(1);
    expect(readSetup({ 'studio.setup': { completedAt: 5, junk: 1 } })).toEqual({ completedAt: 5 });
  });

  it('an active bench or an unchecked agent never completes setup', () => {
    const benched = { ...ready('claude', 'Claude Code'), recent_bench: { kind: 'quota_exhausted', runs: 1, last_at: new Date().toISOString(), lifts_at: new Date(Date.now() + 6e5).toISOString(), source: 'worker', reason: 'r' } };
    expect(setupAgents(rows([benched]))).toHaveLength(0);
    const unchecked = { ...ready('claude', 'Claude Code'), governance_mode: all(mode('none', 'none')) };
    expect(setupAgents(rows([unchecked]))).toHaveLength(0);
  });

  it('step 1 offers one move per agent from its top issue', () => {
    const r = rows([signedOut('claude', 'Claude Code'), CODEX]);
    expect(r.map((x) => setupMove(x, setupAgents(r))?.label ?? null)).toEqual(['Sign in Claude Code', 'Fix Codex']);
  });

  it('repository work is read from the row’s structured repoWork, not its words (codex #759 r1)', () => {
    const [codex] = rows([CODEX]);
    expect(codex!.repoWork).toBe(false);
    expect(setupAgents([{ ...codex!, ready: { ...codex!.ready, word: 'Ready' } }])).toHaveLength(0);
  });
});

describe('the landing (§5.1)', () => {
  it('not good enough at `/`: lands on the Agents tab’s setup steps, and persists nothing', async () => {
    const navigate = vi.fn();
    renderHook(() => useFirstUseLanding('/', '', navigate));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(SETUP_PATH, { replace: true }));
    expect(putSetup).not.toHaveBeenCalled();
  });

  it('good enough on arrival: stays on the Desk and persists completedAt once', async () => {
    getRoster.mockResolvedValue({ roster: [ready('claude', 'Claude Code')] });
    listRepos.mockResolvedValue({ repos: [{ id: 'r' }] });
    const navigate = vi.fn();
    renderHook(() => useFirstUseLanding('/', '', navigate));
    await waitFor(() => expect(putSetup).toHaveBeenCalledTimes(1));
    expect(putSetup.mock.calls[0]![0]).toEqual({ completedAt: expect.any(Number) });
    expect(navigate).not.toHaveBeenCalled();
  });

  it('never hijacks a deep link, a completed or skipped setup, or a failed read', async () => {
    const navigate = vi.fn();
    renderHook(() => useFirstUseLanding('/runs', '', navigate));
    getSettings.mockResolvedValue({ settings: { 'studio.setup': { skippedAt: 1 } } });
    renderHook(() => useFirstUseLanding('/', '', navigate));
    await new Promise((r) => setTimeout(r, 50));
    resetFirstUseReads();
    listRepos.mockRejectedValue(new Error('down'));
    getSettings.mockResolvedValue({ settings: {} });
    renderHook(() => useFirstUseLanding('/', '', navigate));
    await new Promise((r) => setTimeout(r, 50));
    expect(navigate).not.toHaveBeenCalled();
    expect(putSetup).not.toHaveBeenCalled();
  });
});

describe('the setup steps (§5.2)', () => {
  it('shows the steps on ?setup=1, a modal keeps them open, and Skip persists skippedAt', async () => {
    const navigate = vi.fn();
    render(<AgentsPage search="?setup=1" navigate={navigate} />);
    expect(await screen.findByTestId('agents-setup')).toHaveTextContent('Welcome to studio. Let’s get your agents ready.');
    await waitFor(() => expect(screen.getByTestId('agents-setup-count')).toHaveTextContent('No agent can take new jobs yet.'));
    fireEvent.click(screen.getByRole('button', { name: 'Sign in Claude Code' }));
    expect(navigate).toHaveBeenCalledWith('/agents?setup=1&fix=claude');
    expect(screen.queryByTestId('agents-setup-guide')).toBeNull();
    fireEvent.click(screen.getByTestId('agents-setup-skip'));
    expect(putSetup).toHaveBeenCalledWith({ skippedAt: expect.any(Number) });
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('reaching good enough on the steps persists completedAt and offers the Desk', async () => {
    getRoster.mockResolvedValue({ roster: [ready('claude', 'Claude Code')] });
    listProjects.mockResolvedValue({ projects: [{ id: 'default' }, { id: 'p1' }] });
    render(<AgentsPage search="?setup=1" navigate={vi.fn()} />);
    expect(await screen.findByTestId('agents-setup-desk')).toHaveTextContent('go to the Desk');
    await waitFor(() => expect(putSetup).toHaveBeenCalledWith({ completedAt: expect.any(Number) }));
    expect(screen.getByTestId('agents-setup-step-project')).toHaveAttribute('data-done', 'true');
  });

  it('the Setup guide on a finished install reads the real counts and never writes studio.setup again', async () => {
    getSettings.mockResolvedValue({ settings: { 'studio.setup': { completedAt: 1 } } });
    listRepos.mockResolvedValue({ repos: [{ id: 'r' }, { id: 's' }] });
    render(<AgentsPage search="?setup=1" navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('agents-setup-step-project')).toHaveTextContent('You already have 2 repositories.'));
    fireEvent.click(screen.getByTestId('agents-setup-skip'));
    expect(putSetup).not.toHaveBeenCalled();
  });

  it('while the counts are out, step 3 says it is checking, never "not done" (real-data gate)', async () => {
    let answer: (v: { repos: unknown[] }) => void = () => undefined;
    listRepos.mockReturnValue(new Promise((r) => { answer = r; }));
    listProjects.mockResolvedValue({ projects: [{ id: 'default' }, { id: 'p1' }] });
    render(<AgentsPage search="?setup=1" navigate={vi.fn()} />);
    const step = await screen.findByTestId('agents-setup-step-project');
    await waitFor(() => expect(screen.getByTestId('agents-setup-place-reading')).toHaveAttribute('data-state', 'reading'));
    expect(step).toHaveAttribute('data-done', 'false');
    expect(step).toHaveTextContent('Checking your projects and repositories…');
    expect(step).not.toHaveTextContent('Name it;');
    expect(screen.getByTestId('agents-setup-skip')).toBeDisabled();
    answer({ repos: [] });
    await waitFor(() => expect(screen.getByTestId('agents-setup-step-project')).toHaveTextContent('You already have 1 project.'));
    expect(screen.queryByTestId('agents-setup-place-reading')).toBeNull();
  });

  it('a failed count read says so, and Skip still goes to the Desk without writing studio.setup', async () => {
    listRepos.mockRejectedValue(new Error('down'));
    const navigate = vi.fn();
    render(<AgentsPage search="?setup=1" navigate={navigate} />);
    await waitFor(() => expect(screen.getByTestId('agents-setup-place-reading')).toHaveAttribute('data-state', 'failed'));
    expect(screen.getByTestId('agents-setup-step-project')).toHaveTextContent('Studio couldn’t read your projects and repositories just now.');
    const skip = screen.getByTestId('agents-setup-skip');
    expect(skip).toBeEnabled();
    fireEvent.click(skip);
    expect(navigate).toHaveBeenCalledWith('/');
    expect(putSetup).not.toHaveBeenCalled();
  });

  it('without ?setup the table carries a quiet Setup guide link back to the steps', async () => {
    const navigate = vi.fn();
    render(<AgentsPage search="" navigate={navigate} />);
    fireEvent.click(await screen.findByTestId('agents-setup-guide'));
    expect(navigate).toHaveBeenCalledWith('/agents?setup=1');
  });
});

describe('studio.setup is saved once (codex #759 r1)', () => {
  it('a second save while the first is out waits on it and shares its failure', async () => {
    const { useFirstUseReads } = await import('../src/store/firstUseReads.js');
    await useFirstUseReads.getState().load(true);
    let fail: (e: Error) => void = () => {};
    putSetup.mockReturnValue(new Promise((_, reject) => { fail = reject; }));
    const first = useFirstUseReads.getState().save({ skippedAt: 1 });
    const second = useFirstUseReads.getState().save({ skippedAt: 2 });
    fail(new Error('down'));
    expect(await Promise.all([first, second])).toEqual([false, false]);
    expect(putSetup).toHaveBeenCalledTimes(1);
    expect(useFirstUseReads.getState().saveFailed).toBe(true);
  });
});
