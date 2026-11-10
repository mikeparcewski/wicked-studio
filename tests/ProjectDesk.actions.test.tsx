import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These suites exercise Desk tabs and project behavior; chart rendering is outside their scope.
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project, ProjectDetail } from '../src/api/types.js';

/** A project's own moves (operator 2026-11-09): rename, describe, archive and restore live in its Settings tab, and only there. */

const getProject = vi.fn();
const getProjectActivity = vi.fn();
const updateProject = vi.fn();

vi.mock('../src/api/client.js', () => ({
  apiFetch: (path: string) => Promise.resolve(path.includes('/standing-orders') ? { away: false, orders: [] } : path.includes('/coverage')
    ? { totals: { repos: 0, ok: 0, behavior_bearing: 0, resolved: 0, coverage: null }, rows: [] }
    : { totals: { repos: 0, ok: 0, domains: 0, requirements: 0, entities: 0 }, rows: [], merged: [] }),
  api: {
    getProject: (...a: unknown[]) => getProject(...a),
    getProjectActivity: (...a: unknown[]) => getProjectActivity(...a),
    updateProject: (...a: unknown[]) => updateProject(...a),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjectMembers: () => Promise.resolve({ members: [] }),
  },
}));

const { ProjectDesk } = await import('../src/components/desk/ProjectDesk.js');

const NOW = 1_757_300_000_000;

function proj(id: string, extra: Partial<Project> = {}): Project {
  return {
    id, name: `Project ${id}`, description: null, status: 'active',
    scope: `project:${id}`, created_at: NOW - 1000, updated_at: NOW - 1000,
    ...extra,
  };
}

function detail(p: Project): ProjectDetail {
  return { project: p, members: [] } as ProjectDetail;
}

beforeEach(() => {
  getProject.mockReset();
  getProjectActivity.mockReset();
  updateProject.mockReset();
  getProjectActivity.mockResolvedValue({ entries: [], nextCursor: null, projectId: 'proj-1' });
});
afterEach(cleanup);

/** The project's tabbed views (`?tab=work`): the home (no `?tab=`) has its own suite below. */
async function renderLoaded(projectId: string, navigate = vi.fn(), search = '?tab=work'): Promise<void> {
  render(<ProjectDesk needRows={[]} now={1_757_300_000_000} runsLoaded={true} search={search} runs={[]} projectId={projectId} navigate={navigate} />);
  await waitFor(() => expect(getProject).toHaveBeenCalledWith(projectId));
  // wait for the page to finish loading
  await screen.findByRole('heading', { level: 1, name: projectId === 'default' ? 'Not in a project' : `Project ${projectId}` });
}

async function renderSettings(): Promise<void> {
  cleanup();
  await renderLoaded('proj-1', vi.fn(), '?tab=settings');
  await screen.findByTestId('project-settings');
}

/** No project page offers a ⋯ with the project's moves any more. */
const noMenu = (): void => {
  expect(screen.queryByRole('button', { name: /^More actions for Project / })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: /^Edit|^Archive|^Restore|^Documents/ })).toBeNull();
};

describe('ProjectDesk — Settings edits the name and description', () => {
  it('saves name + description via updateProject; the header has no Edit', async () => {
    getProject.mockResolvedValue(detail(proj('proj-1')));
    updateProject.mockResolvedValue({ project: proj('proj-1', { name: 'renamed' }) });
    await renderLoaded('proj-1');
    noMenu();
    await renderSettings();
    fireEvent.change(screen.getByTestId('project-settings-name'), { target: { value: 'renamed' } });
    fireEvent.click(screen.getByTestId('project-settings-save'));
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('proj-1', { name: 'renamed', description: '' }));
    expect(await screen.findByTestId('project-settings-saved')).toBeInTheDocument();
  });

  it('Save is disabled on an empty name', async () => {
    getProject.mockResolvedValue(detail(proj('proj-1')));
    await renderSettings();
    fireEvent.change(screen.getByTestId('project-settings-name'), { target: { value: '' } });
    expect(screen.getByTestId('project-settings-save')).toBeDisabled();
    expect(updateProject).not.toHaveBeenCalled();
  });
});

describe('ProjectDesk — Archive / Restore (the Settings danger zone)', () => {
  it('Archive asks inline, then sends {status: "archived"}, and the button becomes Restore', async () => {
    getProject.mockResolvedValue(detail(proj('proj-1', { status: 'active' })));
    updateProject.mockResolvedValue({ project: proj('proj-1', { status: 'archived' }) });
    await renderSettings();
    fireEvent.click(screen.getByTestId('project-archive'));
    expect(updateProject).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('project-archive-confirm'));
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('proj-1', { status: 'archived' }));
    expect(await screen.findByTestId('project-restore')).toBeInTheDocument();
    expect(screen.queryByTestId('project-archive')).toBeNull();
  });

  it('Restore sends {status: "active"} with no confirm, and the button becomes Archive', async () => {
    getProject.mockResolvedValue(detail(proj('proj-1', { status: 'archived' })));
    updateProject.mockResolvedValue({ project: proj('proj-1', { status: 'active' }) });
    await renderSettings();
    fireEvent.click(screen.getByTestId('project-restore'));
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('proj-1', { status: 'active' }));
    expect(await screen.findByTestId('project-archive')).toBeInTheDocument();
    expect(screen.queryByTestId('project-restore')).toBeNull();
  });
});

describe('ProjectDesk — default-project guard', () => {
  it('the synthesized default project exposes no Settings, Edit or Archive/Restore', async () => {
    getProject.mockResolvedValue(detail(proj('default')));
    getProjectActivity.mockResolvedValue({ entries: [], nextCursor: null, projectId: 'default' });
    await renderLoaded('default');
    noMenu();
    expect(screen.queryByTestId('desk-tab-settings')).toBeNull();
    expect(screen.queryByTestId('project-archive')).toBeNull();
  });
});

describe('ProjectDesk — the home', () => {
  it('the home has More info (to Work) and no ⋯; Settings is one of its views', async () => {
    getProject.mockResolvedValue(detail(proj('proj-1')));
    const navigate = vi.fn();
    await renderLoaded('proj-1', navigate, '');
    expect(screen.getByTestId('project-home')).toBeInTheDocument();
    expect(screen.queryByTestId('desk-tabs')).toBeNull();
    noMenu();
    fireEvent.click(screen.getByTestId('project-more-info'));
    expect(navigate).toHaveBeenCalledWith('/projects/proj-1?tab=work');
    expect(screen.getAllByTestId('project-view').at(-1)).toHaveAttribute('href', '/projects/proj-1?tab=settings');
  });

  it('work in no project is not a project: no ask box, no ⋯, one line offering to file it', async () => {
    getProject.mockResolvedValue(detail(proj('default')));
    getProjectActivity.mockResolvedValue({ entries: [], nextCursor: null, projectId: 'default' });
    await renderLoaded('default', vi.fn(), '');
    expect(screen.queryByTestId('project-ask')).toBeNull();
    expect(screen.queryByRole('button', { name: /^More actions for/ })).toBeNull();
    expect(screen.getByTestId('project-unfiled')).toHaveTextContent('These jobs aren\u2019t filed in a project · Move to a project'.replace('\u2019', "'"));
    // Its documents stay one link away (the Work view).
    expect(screen.getAllByTestId('project-view')[0]).toHaveAttribute('href', '/projects/default?tab=work');
  });
});
