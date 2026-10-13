import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These suites exercise Desk tabs and project behavior; chart rendering is outside their scope.
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project, ProjectDetail } from '../src/api/types.js';

/** Project actions remain available in the shared Desk header, with editing on Work. */

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

async function renderLoaded(projectId: string, navigate = vi.fn()): Promise<void> {
  render(<ProjectDesk needRows={[]} now={1_757_300_000_000} runsLoaded={true} search="" runs={[]} projectId={projectId} navigate={navigate} />);
  await waitFor(() => expect(getProject).toHaveBeenCalledWith(projectId));
  // wait for the page to finish loading
  await screen.findByRole('heading', { level: 1, name: projectId === 'default' ? 'Not in a project' : `Project ${projectId}` });
}

/** DES-frontdoor P: Edit and Archive / Restore live in the header's ⋯ menu. */
function menuItem(name: RegExp): HTMLElement | null {
  const button = screen.queryByRole('button', { name: /^More actions for Project / });
  if (button === null) return null;
  if (button.getAttribute('aria-expanded') !== 'true') fireEvent.click(button);
  return screen.queryByRole('menuitem', { name });
}

describe('ProjectDesk — Edit', () => {
  it('opens an inline editor on Edit click and saves name + description via updateProject', async () => {
    getProject.mockResolvedValue(detail(proj('proj-1')));
    updateProject.mockResolvedValue({ project: proj('proj-1', { name: 'renamed' }) });
    await renderLoaded('proj-1');

    fireEvent.click(menuItem(/^Edit/)!);
    const nameInput = screen.getByDisplayValue('Project proj-1') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: 'renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('proj-1', {
      name: 'renamed', description: '',
    }));
    // Cancel no longer in the DOM once saved
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull());
  });

  it('Save is disabled on an empty name', async () => {
    getProject.mockResolvedValue(detail(proj('proj-1')));
    await renderLoaded('proj-1');

    fireEvent.click(menuItem(/^Edit/)!);
    const nameInput = screen.getByDisplayValue('Project proj-1') as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: '' } });

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(updateProject).not.toHaveBeenCalled();
  });
});

describe('ProjectDesk — Archive / Restore', () => {
  it('Archive sends {status: "archived"} and the button flips to Restore', async () => {
    const active = proj('proj-1', { status: 'active' });
    getProject.mockResolvedValue(detail(active));
    updateProject.mockResolvedValue({ project: proj('proj-1', { status: 'archived' }) });
    await renderLoaded('proj-1');

    fireEvent.click(menuItem(/^Archive/)!);

    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('proj-1', { status: 'archived' }));
    await waitFor(() => expect(menuItem(/^Restore/)).not.toBeNull());
    expect(menuItem(/^Archive/)).toBeNull();
  });

  it('Restore sends {status: "active"} and the button flips back to Archive', async () => {
    const archived = proj('proj-1', { status: 'archived' });
    getProject.mockResolvedValue(detail(archived));
    updateProject.mockResolvedValue({ project: proj('proj-1', { status: 'active' }) });
    await renderLoaded('proj-1');

    fireEvent.click(menuItem(/^Restore/)!);

    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('proj-1', { status: 'active' }));
    await waitFor(() => expect(menuItem(/^Archive/)).not.toBeNull());
    expect(menuItem(/^Restore/)).toBeNull();
  });
});

describe('ProjectDesk — default-project guard', () => {
  it('the synthesized default project exposes neither Edit nor Archive/Restore', async () => {
    getProject.mockResolvedValue(detail(proj('default')));
    getProjectActivity.mockResolvedValue({ entries: [], nextCursor: null, projectId: 'default' });
    await renderLoaded('default');

    expect(screen.queryByRole('button', { name: /^More actions for/ })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /^Edit|^Archive|^Restore/ })).toBeNull();
  });
});
