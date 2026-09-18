/**
 * CLIs chip row (#302): disabled seat chips on DocumentThread, DemoWizard, and
 * TestingLaunchPanel — present so operators see the roster, inert so no clis/clisJson
 * key ever enters the create/launch body (strict-schema contract; pending crew#631).
 *
 * Six cases: one warm-cache + one cold-cache test per surface.
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
const { DemoWizard } = await import('../src/components/DemoWizard.js');
const { TestingLaunchPanel } = await import('../src/components/TestingLaunchPanel.js');

// ── DocumentThread ────────────────────────────────────────────────────────────

describe('doc-clis-row (DocumentThread in launching mode)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCachedRoster();
    useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, bindings: {}, held: {} });
    createDoc.mockResolvedValue({ name: 'doc-out', head: 0, generating: true });
    listProjectMembers.mockResolvedValue({ members: [] });
    listRepos.mockResolvedValue({ repos: [] });
    getRoster.mockResolvedValue({ roster: ROSTER });
    listWorkflows.mockResolvedValue({ workflows: [] });
    listProjects.mockResolvedValue({ projects: [] });
    apiFetch.mockRejectedValue(new Error('not wired'));
  });
  afterEach(cleanup);

  it('warm cache: renders one disabled chip per seat, note contains crew#631; create body carries no clis/clisJson', async () => {
    setCachedRoster(ROSTER);
    const user = userEvent.setup();
    render(<DocumentThread projectId="default" docId={null} selectedVersion={null} navigate={vi.fn()} mode="document" />);
    const row = screen.getByTestId('doc-clis-row');
    // one chip per seat (chips carry the `title` attribute; the note span does not)
    expect(row.querySelectorAll('span[title]')).toHaveLength(ROSTER.length);
    expect(row.querySelectorAll('span[title]')[0]!.textContent).toBe(SEAT.key);
    expect(row.textContent).toContain('crew#631');
    // submit and check the create body
    await user.type(screen.getByTestId('doc-composer'), 'a deck for the product');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    const body = createDoc.mock.calls[0]![1] as Record<string, unknown>;
    expect('clis' in body).toBe(false);
    expect('clisJson' in body).toBe(false);
  });

  it('cold cache: chip row appears after api.getRoster resolves', async () => {
    render(<DocumentThread projectId="default" docId={null} selectedVersion={null} navigate={vi.fn()} mode="document" />);
    // no roster yet
    expect(screen.queryByTestId('doc-clis-row')).toBeNull();
    // row appears once the fetch resolves
    await waitFor(() => expect(screen.queryByTestId('doc-clis-row')).not.toBeNull());
    expect(getRoster).toHaveBeenCalledTimes(1);
  });
});

// ── DemoWizard ────────────────────────────────────────────────────────────────

describe('demo-clis-row (DemoWizard)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearCachedRoster();
    useDocThreadStore.setState({ messages: {}, genState: {}, pending: {}, hydrated: {}, bindings: {}, held: {} });
    createDoc.mockResolvedValue({ name: 'demo-out', head: 0, generating: true });
    getRoster.mockResolvedValue({ roster: ROSTER });
    apiFetch.mockRejectedValue(new Error('not wired'));
  });
  afterEach(cleanup);

  it('warm cache: renders one disabled chip per seat, note contains crew#631; create body carries no clis/clisJson', async () => {
    setCachedRoster(ROSTER);
    const user = userEvent.setup();
    render(<DemoWizard projectId="proj" seed="test demo" msgId="msg-1" onCancel={vi.fn()} onCreated={vi.fn()} />);
    const row = screen.getByTestId('demo-clis-row');
    expect(row.querySelectorAll('span[title]')).toHaveLength(ROSTER.length);
    expect(row.querySelectorAll('span[title]')[0]!.textContent).toBe(SEAT.key);
    expect(row.textContent).toContain('crew#631');
    // fill in targetUrl to satisfy draftReady (the seed provides name + description)
    await user.type(screen.getByTestId('wizard-target'), 'https://example.com');
    await user.click(screen.getByTestId('wizard-create'));
    await waitFor(() => expect(createDoc).toHaveBeenCalledTimes(1));
    // createDemoFromDraft → demoDraftBody → createDoc; no clis/clisJson in that body
    const body = createDoc.mock.calls[0]![1] as Record<string, unknown>;
    expect('clis' in body).toBe(false);
    expect('clisJson' in body).toBe(false);
  });

  it('cold cache: chip row appears after api.getRoster resolves', async () => {
    render(<DemoWizard projectId="proj" seed="test demo" msgId="msg-1" onCancel={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.queryByTestId('demo-clis-row')).toBeNull();
    await waitFor(() => expect(screen.queryByTestId('demo-clis-row')).not.toBeNull());
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
