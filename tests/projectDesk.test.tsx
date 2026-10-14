import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These suites exercise Desk tabs and project behavior; chart rendering is outside their scope.
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Project, ProjectMember } from '../src/api/types.js';
import { makeView } from './factories.js';

const { getProject, getRun, apiFetch, detach } = vi.hoisted(() => ({ getProject: vi.fn(), getRun: vi.fn(), apiFetch: vi.fn(), detach: vi.fn() }));
vi.mock('../src/api/client.js', () => ({
  apiBase: () => '/api/v1',
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  api: {
    getProject: (...args: unknown[]) => getProject(...args),
    getRun: (...args: unknown[]) => getRun(...args),
    detachProjectMember: (...args: unknown[]) => detach(...args),
    listProjects: () => Promise.resolve({ projects: [] }),
    listProjectMembers: () => Promise.resolve({ members: [] }),
    listRepos: () => Promise.resolve({ repos: [{ id: 'repo', name: 'Shop code', root_path: '/code', default_branch: 'main', registered_at: 1 }] }),
    listChats: () => Promise.resolve({ chats: [] }),
    getRoster: () => Promise.resolve({ roster: [] }),
    getRunEvents: () => Promise.resolve({ events: [] }),
    getSeatRecord: (_days: number, project?: string) => Promise.resolve({ seats: [], project }),
  },
}));

import { ProjectDesk } from '../src/components/desk/ProjectDesk.js';
import { useProjectsStore } from '../src/store/projects.js';
import { clearRepoCache } from '../src/store/repoCache.js';

const NOW = Date.UTC(2026, 9, 13, 12);
const project: Project = { id: 'p1', name: 'Shop', description: 'Checkout work', status: 'active', scope: 'project:p1', created_at: NOW - 1000, updated_at: NOW - 1000 };
const member = (ref: string, kind = 'crew.run'): ProjectMember => ({ id: `${kind}:${ref}`, project_id: 'p1', member_kind: kind, member_ref: ref, meta: null, attached_at: 1, attached_by: 'studio' });
const runs = [
  makeView({ id: 'filed', project_id: 'p1', problem: 'Fix checkout', status: 'completed', created_at: NOW / 1000 - 100 }),
  makeView({ id: 'member', problem: 'Improve cart', status: 'executing', created_at: NOW / 1000 - 200 }),
  makeView({ id: 'elsewhere', project_id: 'p2', problem: 'Other work', created_at: NOW / 1000 - 50 }),
];
const props = { projectId: 'p1', navigate: vi.fn(), runs, needRows: [], now: NOW, search: '', runsLoaded: true };

beforeEach(() => {
  vi.clearAllMocks();
  clearRepoCache();
  window.history.replaceState(null, '', '/projects/p1');
  useProjectsStore.setState({ projects: [project], loading: false, error: null });
  getProject.mockResolvedValue({ project, members: [member('member'), member('repo', 'crew.repo')] });
  apiFetch.mockImplementation((path: string) => {
    if (path.includes('/standing-orders')) return Promise.resolve({ away: false, orders: [] });
    if (path.includes('/requirements')) return Promise.resolve({ projectId: 'p1', totals: { repos: 1, ok: 0, absent: 1, errors: 0, dangling: 0, total: 0, corpus: 0 }, rows: [] });
    if (path.includes('/coverage')) return Promise.resolve({ projectId: 'p1', totals: { repos: 1, ok: 0, behavior_bearing: 0, resolved: 0, coverage: null }, rows: [] });
    if (path.includes('/domain')) return Promise.resolve({ projectId: 'p1', totals: { repos: 1, ok: 0, domains: 0, requirements: 0, entities: 0 }, rows: [], merged: [] });
    return Promise.resolve({});
  });
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Unexpected real HTTP read'))));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

async function loaded(): Promise<void> {
  expect(await screen.findByRole('heading', { level: 1, name: 'Shop' })).toBeInTheDocument();
}

describe('the project Desk', () => {
  it('shares the Runs tab and includes both project_id and membership, excluding other projects', async () => {
    render(<ProjectDesk {...props} search="?tab=runs" />);
    await loaded();
    await waitFor(() => expect(screen.getAllByTestId('desk-runs-row')).toHaveLength(2));
    expect(screen.getAllByTestId('desk-runs-row').map((row) => row.getAttribute('data-run-id')).sort()).toEqual(['filed', 'member']);
    expect(screen.getByRole('tab', { name: 'Repositories' })).toHaveAttribute('href', '/projects/p1?tab=repositories');
    expect(getRun).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('a member run row offers Remove from project; a run filed by project_id has no row menu', async () => {
    detach.mockResolvedValue({});
    render(<ProjectDesk {...props} search="?tab=runs" />);
    await loaded();
    await waitFor(() => expect(screen.getAllByTestId('desk-runs-row')).toHaveLength(2));
    const rowOf = (id: string): HTMLElement => screen.getAllByTestId('desk-runs-row').find((r) => r.getAttribute('data-run-id') === id)!;
    expect(within(rowOf('filed')).queryByTestId('desk-runs-row-menu-button')).not.toBeInTheDocument();
    fireEvent.click(within(rowOf('member')).getByTestId('desk-runs-row-menu-button'));
    const item = within(rowOf('member')).getByRole('menuitem', { name: /Remove .Improve cart. from this project/ });
    fireEvent.click(item);
    expect(detach).toHaveBeenCalledExactlyOnceWith('p1', 'crew.run:member');
    // The membership is gone, so the run leaves the project's list.
    await waitFor(() => expect(screen.getAllByTestId('desk-runs-row').map((r) => r.getAttribute('data-run-id'))).toEqual(['filed']));
  });

  it('keeps project actions, requirements and documents under Work without duplicate dashboard sections', async () => {
    render(<ProjectDesk {...props} />);
    await loaded();
    expect(screen.getByTestId('project-new-job')).toHaveAccessibleName('New job in this project');
    expect(screen.getByTestId('project-chat')).toBeInTheDocument();
    expect(document.getElementById('requirements')).toBeInTheDocument();
    expect(document.getElementById('project-documents')).toBeInTheDocument();
    for (const id of ['project-band', 'project-jobs', 'project-feed', 'project-needs']) expect(screen.queryByTestId(id)).toBeNull();
    expect(screen.getByTestId('project-meta')).toHaveTextContent('2 jobs');
  });

  it('hosts the project repository section and its coverage and domain reads on Repositories', async () => {
    render(<ProjectDesk {...props} search="?tab=repositories" />);
    await loaded();
    expect(await screen.findByTestId('project-repos')).toHaveAttribute('data-count', '1');
    expect(within(screen.getByTestId('project-repos')).getByTestId('project-repo-row')).toHaveAttribute('data-repo', 'repo');
    await waitFor(() => expect(apiFetch.mock.calls.some(([path]) => String(path).includes('/coverage'))).toBe(true));
    expect(apiFetch.mock.calls.some(([path]) => String(path).includes('/domain'))).toBe(true);
    expect(document.getElementById('requirements')).toBeNull();
  });

  it('waits for its own member reads before the job list counts as read (codex r3)', async () => {
    let answer: (v: unknown) => void = () => undefined;
    getRun.mockImplementation(() => new Promise((r) => { answer = r; }));
    const onlyFiled = runs.filter((v) => v.session.id !== 'member');
    render(<ProjectDesk {...props} runs={onlyFiled} search="?tab=runs" />);
    await loaded();
    await waitFor(() => expect(getRun).toHaveBeenCalledWith('member'));
    // While the member read is out, the Runs tab is still reading (no partial list, no counts).
    expect(screen.queryAllByTestId('desk-runs-row')).toHaveLength(0);
    expect(screen.getByTestId('desk-runs-stat-window').querySelector('.wk-stat-value')?.textContent ?? '').not.toMatch(/\d/);
    answer({ run: runs.find((v) => v.session.id === 'member') });
    await waitFor(() => expect(screen.getAllByTestId('desk-runs-row').map((r) => r.getAttribute('data-run-id')).sort()).toEqual(['filed', 'member']));
  });

  it('names default honestly and offers no requirements, repositories, edit or archive', async () => {
    getProject.mockResolvedValue({ project: { ...project, id: 'default' }, members: [] });
    const view = render(<ProjectDesk {...props} projectId="default" />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Not in a project' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^More actions for/ })).toBeNull();
    expect(document.getElementById('requirements')).toBeNull();
    view.rerender(<ProjectDesk {...props} projectId="default" search="?tab=repositories" />);
    expect(screen.getByText(/Work not in a project has no repositories of its own/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Desk’s Repositories/ })).toHaveAttribute('href', '/?tab=repositories');
    expect(screen.queryByTestId('project-repos')).toBeNull();
  });

  it('reads a member missing from the run list and reports failed member reads', async () => {
    getProject.mockResolvedValue({ project, members: [member('older'), member('unreadable')] });
    getRun.mockImplementation((id: string) => id === 'older' ? Promise.resolve({ run: makeView({ id, problem: 'Older work', created_at: NOW / 1000 - 500, status: 'completed' }) }) : Promise.reject(new Error('read failed')));
    render(<ProjectDesk {...props} search="?tab=runs" />);
    await loaded();
    expect(await screen.findByRole('link', { name: 'Older work' })).toBeInTheDocument();
    expect(screen.getAllByTestId('desk-runs-row').map((row) => row.getAttribute('data-run-id')).sort()).toEqual(['filed', 'older']);
    expect(await screen.findByTestId('project-jobs-unshown')).toHaveTextContent('1 job in this project');
  });

  it('replaces the old repository hash with the Repositories tab', async () => {
    window.history.replaceState(null, '', '/projects/p1#project-repos');
    const navigate = vi.fn();
    render(<ProjectDesk {...props} navigate={navigate} />);
    await loaded();
    expect(navigate).toHaveBeenCalledWith('/projects/p1?tab=repositories', { replace: true });
  });

  it.each(['requirements', 'project-documents'])('moves an old #%s address to Work, then scrolls', async (id) => {
    window.history.replaceState(null, '', `/projects/p1?tab=runs#${id}`);
    const navigate = vi.fn();
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const view = render(<ProjectDesk {...props} navigate={navigate} search="?tab=runs" />);
    await loaded();
    expect(navigate).toHaveBeenCalledWith(`/projects/p1#${id}`, { replace: true });
    view.rerender(<ProjectDesk {...props} navigate={navigate} />);
    await waitFor(() => expect(scroll.mock.instances).toContain(document.getElementById(id)));
    scroll.mockRestore();
  });

  it('Documents navigates to Work before scrolling from a hosted tab', async () => {
    const navigate = vi.fn();
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    const view = render(<ProjectDesk {...props} navigate={navigate} search="?tab=repositories" />);
    await loaded();
    fireEvent.click(screen.getByTestId('project-documents'));
    expect(navigate).toHaveBeenCalledWith('/projects/p1');
    view.rerender(<ProjectDesk {...props} navigate={navigate} />);
    await waitFor(() => expect(scroll.mock.instances).toContain(document.getElementById('project-documents')));
    scroll.mockRestore();
  });

  it.each(['steer', 'agents', 'evaluate'] as const)('passes project scope to App for %s', async (tab) => {
    const hosted = vi.fn(() => <p>Hosted page</p>);
    render(<ProjectDesk {...props} search={`?tab=${tab}&at=${encodeURIComponent('/testing/evals?project=wrong')}`} hosted={hosted} />);
    await loaded();
    expect(hosted).toHaveBeenCalledWith(tab, '/testing/evals?project=wrong', 'p1');
    // Studio-wide tabs carry no "this is all of it" note on a project's page (operator, 2026-10-14).
    expect(screen.queryByTestId('desk-hosted-note')).toBeNull();
  });

  it('first-run guidance opens the project Repositories tab', async () => {
    getProject.mockResolvedValue({ project, members: [] });
    const navigate = vi.fn();
    render(<ProjectDesk {...props} runs={[]} navigate={navigate} />);
    await loaded();
    fireEvent.click(within(screen.getByTestId('project-first-run')).getByRole('button', { name: 'Go to repositories' }));
    expect(navigate).toHaveBeenCalledWith('/projects/p1?tab=repositories');
  });

  it('combines repository aggregate failures into one banner and retries both reads', async () => {
    const read = apiFetch.getMockImplementation()!;
    apiFetch.mockImplementation((path: string) => path.includes('/coverage') || path.includes('/domain') ? Promise.reject(new TypeError('Failed to fetch')) : read(path));
    render(<ProjectDesk {...props} search="?tab=repositories" />);
    await loaded();
    await waitFor(() => expect(screen.getAllByTestId('state-banner')).toHaveLength(1));
    await waitFor(() => expect(apiFetch.mock.calls.filter(([path]) => String(path).includes('/coverage') || String(path).includes('/domain'))).toHaveLength(2));
    expect(screen.getByTestId('state-banner')).toHaveAttribute('data-kind', 'offline');
    fireEvent.click(within(screen.getByTestId('state-banner')).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(apiFetch.mock.calls.filter(([path]) => String(path).includes('/coverage') || String(path).includes('/domain'))).toHaveLength(4));
  });

  it('reports a missing project without mounting a Desk', async () => {
    getProject.mockResolvedValue({ project: null, members: [] });
    render(<ProjectDesk {...props} />);
    expect(await screen.findByText('Project not found')).toBeInTheDocument();
    expect(screen.queryByTestId('desk')).toBeNull();
  });
});
