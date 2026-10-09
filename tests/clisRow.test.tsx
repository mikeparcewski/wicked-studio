/**
 * CLIs chip row (#302). TestingLaunchPanel: still disabled chips — no clis/clisJson key enters
 * those bodies yet (crew#631 shipped the daemon half; studio#302 wires it). (S16a-4h: the Document thread's seat toggles went with the project shell.)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { RosterSeat } from '../src/api/types.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { clearCachedWorkflows } from '../src/store/workflowCache.js';

const SEAT: RosterSeat = {
  key: 'claude', display_name: 'Claude Code', binary: 'claude',
  enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true,
};
// Two seats (studio#311 R9): "one chip per seat" must be able to tell "per seat" from "exactly one".
const SEAT_2: RosterSeat = {
  key: 'codex', display_name: 'Codex', binary: 'codex',
  enabled_for_council: true, health: { status: 'active', since: 'x' }, signed_in: true,
};
const ROSTER: RosterSeat[] = [SEAT, SEAT_2];

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
const { TestingLaunchPanel } = await import('../src/components/TestingLaunchPanel.js');

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

  it('warm cache: renders one disabled chip per seat, note cites studio#302; launch body carries no clis/clisJson', async () => {
    setCachedRoster(ROSTER);
    const user = userEvent.setup();
    render(<TestingLaunchPanel intent="recon" navigate={vi.fn()} onClose={vi.fn()} />);
    // wait for mount effects (listWorkflows, listRepos, listProjects) to settle
    await act(async () => { await Promise.resolve(); });
    const row = screen.getByTestId('testing-clis-row');
    expect(row.querySelectorAll('span[title]')).toHaveLength(ROSTER.length);
    expect([...row.querySelectorAll('span[title]')].map((c) => c.textContent)).toEqual([SEAT.key, SEAT_2.key]);
    expect(row.querySelectorAll('span[title]')[0]!.getAttribute('title')).toContain('studio#302');
    expect(row.textContent).toContain('studio#302');
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
