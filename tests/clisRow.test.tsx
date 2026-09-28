/**
 * CLIs chip row (#302). DocumentThread: real seat toggles whose choice rides the create as
 * `clisJson` (crew#631). TestingLaunchPanel: still disabled chips — no
 * clis/clisJson key enters those bodies yet.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RosterSeat } from '../src/api/types.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';
import { useDocThreadStore } from '../src/store/docThread.js';

const SEAT: RosterSeat = {
  key: 'claude', display_name: 'Claude Code', binary: 'claude',
  enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true,
};
const ROSTER: RosterSeat[] = [SEAT];

const createDoc = vi.fn();
const getRoster = vi.fn();
const listProjectMembers = vi.fn();
const listRepos = vi.fn();
const listProjects = vi.fn();
const listWorkflows = vi.fn();
const apiFetch = vi.fn();

vi.mock('../src/api/interactive.js', () => ({
  createDoc: (...a: unknown[]) => createDoc(...a),
  docBinding: (pid: string) => (pid === 'default' ? {} : { project: pid }),
  postFork: vi.fn(),
  postEvent: vi.fn(),
  injectDocMessage: vi.fn(),
  getVersions: vi.fn(),
  interactiveUrl: (p: string, path: string) => `/api/v1/projects/${p}/interactive${path}`,
  UNFILED_MOUNT: 'default',
}));

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
    listRepos: () => listRepos(),
    getRoster: () => getRoster(),
    listWorkflows: () => listWorkflows(),
    listProjects: () => listProjects(),
  },
  apiFetch: (...a: unknown[]) => apiFetch(...a),
}));

// Dynamic imports so the mocks above are applied before module code runs.
const { DocumentThread } = await import('../src/components/DocumentThread.js');
const { TestingLaunchPanel } = await import('../src/components/TestingLaunchPanel.js');

// ── DocumentThread ────────────────────────────────────────────────────────────

const PI: RosterSeat = {
  key: 'pi', display_name: 'Pi', binary: 'pi',
  enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true,
};
const COPILOT: RosterSeat = {
  key: 'copilot', display_name: 'Copilot', binary: 'copilot',
  enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true,
  council_eligible: false, council_ineligible_reason: 'quota_exhausted',
};
const OPENCODE: RosterSeat = {
  key: 'opencode', display_name: 'OpenCode', binary: 'opencode',
  enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true,
};
const FOUR: RosterSeat[] = [SEAT, PI, COPILOT, OPENCODE];

describe('doc-clis-row (DocumentThread in launching mode) — studio#302 seat control', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCachedRoster();
    localStorage.clear();
    useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, bindings: {}, held: {} });
    createDoc.mockResolvedValue({ name: 'doc-out', head: 0, generating: true });
    listProjectMembers.mockResolvedValue({ members: [] });
    listRepos.mockResolvedValue({ repos: [] });
    getRoster.mockResolvedValue({ roster: FOUR });
    listWorkflows.mockResolvedValue({ workflows: [] });
    listProjects.mockResolvedValue({ projects: [] });
    apiFetch.mockRejectedValue(new Error('not wired'));
  });
  afterEach(cleanup);

  it('unchecking seats sends only the chosen council as clisJson', async () => {
    setCachedRoster(FOUR);
    const user = userEvent.setup();
    render(<DocumentThread projectId="default" docId={null} selectedVersion={null} navigate={vi.fn()} />);
    // Default: the council-enabled seats minus the one the roster says a council would bench.
    expect(screen.getByTestId('doc-seat-claude').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('doc-seat-copilot').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('doc-council-line').textContent).toContain('council: claude · pi · opencode');
    expect(screen.getByTestId('doc-council-left-out').textContent).toContain('copilot (not council-eligible — quota_exhausted)');
    await user.click(screen.getByTestId('doc-seat-opencode'));
    expect(screen.getByTestId('doc-council-line').textContent).toContain('council: claude · pi');
    await user.type(screen.getByTestId('doc-composer'), 'a deck for the product');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    const body = createDoc.mock.calls[0]![1] as Record<string, unknown>;
    expect(JSON.parse(body['clisJson'] as string).map((s: RosterSeat) => s.key)).toEqual(['claude', 'pi']);
  });

  it('a stored Build default wins over enabled_for_council', async () => {
    localStorage.setItem('wicked_default_clis', JSON.stringify(['pi']));
    setCachedRoster(FOUR);
    render(<DocumentThread projectId="default" docId={null} selectedVersion={null} navigate={vi.fn()} />);
    expect(screen.getByTestId('doc-council-line').textContent).toBe('council: pi');
  });

  it('with every seat unchecked, Create is refused and nothing is sent', async () => {
    setCachedRoster([SEAT]);
    const user = userEvent.setup();
    render(<DocumentThread projectId="default" docId={null} selectedVersion={null} navigate={vi.fn()} />);
    await user.click(screen.getByTestId('doc-seat-claude'));
    await user.type(screen.getByTestId('doc-composer'), 'a deck for the product');
    expect((screen.getByTestId('doc-composer-submit') as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard('{Enter}');
    expect(createDoc).not.toHaveBeenCalled();
    expect(screen.getByTestId('doc-council-line').textContent).toContain('Choose at least one seat');
  });

  it('a roster refresh that drops every chosen seat refuses Create, never sends an empty council', async () => {
    const PI: RosterSeat = { ...SEAT, key: 'pi', display_name: 'Pi', binary: 'pi' };
    setCachedRoster([SEAT, PI]);
    const user = userEvent.setup();
    render(<DocumentThread projectId="default" docId={null} selectedVersion={null} navigate={vi.fn()} />);
    // The user's pick: claude only. A refresh then drops claude from the roster.
    await user.click(screen.getByTestId('doc-seat-pi'));
    expect(screen.getByTestId('doc-seat-claude').getAttribute('aria-pressed')).toBe('true');
    act(() => { setCachedRoster([PI]); });
    await user.type(screen.getByTestId('doc-composer'), 'a deck for the product');
    expect((screen.getByTestId('doc-composer-submit') as HTMLButtonElement).disabled).toBe(true);
    await user.keyboard('{Enter}');
    expect(createDoc).not.toHaveBeenCalled();
    expect(screen.getByTestId('doc-council-line').textContent).toContain('Choose at least one seat');
  });

  it('a new launch context re-defaults the council', async () => {
    setCachedRoster(FOUR);
    const user = userEvent.setup();
    const { rerender } = render(<DocumentThread projectId="default" docId={null} selectedVersion={null} navigate={vi.fn()} />);
    await user.click(screen.getByTestId('doc-seat-opencode'));
    expect(screen.getByTestId('doc-seat-opencode').getAttribute('aria-pressed')).toBe('false');
    rerender(<DocumentThread projectId="other" docId={null} selectedVersion={null} navigate={vi.fn()} />);
    // Same render as the switch — no frame with a roster but no council.
    expect(screen.getByTestId('doc-seat-opencode').getAttribute('aria-pressed')).toBe('true');
  });

  it('cold cache: the chips appear after api.getRoster resolves', async () => {
    render(<DocumentThread projectId="default" docId={null} selectedVersion={null} navigate={vi.fn()} />);
    expect(screen.queryByTestId('doc-clis-row')).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('doc-seat-claude')).not.toBeNull());
    expect(getRoster).toHaveBeenCalledTimes(1);
  });
});

// ── TestingLaunchPanel ────────────────────────────────────────────────────────

describe('testing-clis-row (TestingLaunchPanel)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCachedRoster();
    clearCachedWorkflows();
    getRoster.mockResolvedValue({ roster: ROSTER });
    listRepos.mockResolvedValue({ repos: [] });
    listProjects.mockResolvedValue({ projects: [] });
    listProjectMembers.mockResolvedValue({ members: [] });
    listWorkflows.mockResolvedValue({ workflows: [] });
    apiFetch.mockImplementation((path: unknown) => {
      if (String(path) === '/testing/recon')
        return Promise.resolve({ runId: 'r-1', runIds: ['r-1'], campaign: 'c-1' });
      return Promise.reject(new Error('not wired: ' + String(path)));
    });
  });
  afterEach(cleanup);

  it('warm cache: renders one disabled chip per seat, note contains crew#631; launch body carries no clis/clisJson', async () => {
    setCachedRoster(ROSTER);
    const user = userEvent.setup();
    render(<TestingLaunchPanel intent="recon" navigate={vi.fn()} onClose={vi.fn()} />);
    // wait for mount effects (listWorkflows, listRepos, listProjects) to settle
    await act(async () => { await Promise.resolve(); });
    const row = screen.getByTestId('testing-clis-row');
    expect(row.querySelectorAll('span[title]')).toHaveLength(ROSTER.length);
    expect(row.querySelectorAll('span[title]')[0]!.textContent).toBe(SEAT.key);
    expect(row.textContent).toContain('crew#631');
    // submit: type instructions + select unscoped + launch
    await user.type(screen.getByTestId('testing-launch-instructions'), 'cover checkout end to end');
    await user.click(screen.getByTestId('testing-launch-unscoped'));
    await user.click(screen.getByTestId('testing-launch-submit'));
    await waitFor(() =>
      expect(apiFetch).toHaveBeenCalledWith('/testing/recon', expect.anything()),
    );
    const call = apiFetch.mock.calls.find(([p]) => String(p) === '/testing/recon')!;
    const body = JSON.parse((call[1] as { body: string }).body) as Record<string, unknown>;
    expect('clis' in body).toBe(false);
    expect('clisJson' in body).toBe(false);
  });

  it('cold cache: chip row appears after api.getRoster resolves', async () => {
    render(<TestingLaunchPanel intent="recon" navigate={vi.fn()} onClose={vi.fn()} />);
    // immediately after mount (before any async effects flush) no row yet
    expect(screen.queryByTestId('testing-clis-row')).toBeNull();
    // row appears once the fetch resolves
    await waitFor(() => expect(screen.queryByTestId('testing-clis-row')).not.toBeNull());
    expect(getRoster).toHaveBeenCalledTimes(1);
  });
});
