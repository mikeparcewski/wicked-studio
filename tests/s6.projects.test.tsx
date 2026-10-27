import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// These suites exercise Desk tabs and project behavior; chart rendering is outside their scope.
vi.mock('recharts', () => Object.fromEntries(['Area', 'AreaChart', 'Bar', 'BarChart', 'CartesianGrid', 'Cell', 'Pie', 'PieChart', 'ResponsiveContainer', 'Tooltip', 'XAxis', 'YAxis'].map((key) => [key, () => null])));
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Project, ProjectMember } from '../src/api/types.js';

const getProject = vi.fn();
const getRun = vi.fn();
const apiFetch = vi.fn();
const getProjectActivity = vi.fn();
vi.mock('../src/api/client.js', () => ({
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  apiBase: () => '/api/v1',
  api: {
    getProject: (...args: unknown[]) => getProject(...args),
    getProjectActivity: (...args: unknown[]) => getProjectActivity(...args),
    getRun: (...args: unknown[]) => getRun(...args),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjects: () => Promise.resolve({ projects: [] }),
  },
}));
const { ProjectDesk } = await import('../src/components/desk/ProjectDesk.js');
const { ProjectRequirementsPage } = await import('../src/components/product/ProjectRequirementsPage.js');
const { useProjectsStore } = await import('../src/store/projects.js');

const project: Project = { id: 'shop', name: 'Shop', description: null, status: 'active', scope: 'project:shop', created_at: 1, updated_at: 1 };
const uuid = 'db708484-0ba0-45f6-b6d8-7f3804d403f7';
const member: ProjectMember = { id: 'member-1', project_id: 'shop', member_kind: 'crew.run', member_ref: uuid, meta: null, attached_at: 1, attached_by: 'studio' };
const requirements = { projectId: 'shop', offset: 0, limit: 50, totals: { repos: 0, ok: 0, absent: 0, errors: 0, dangling: 0, total: 0, corpus: 0 }, rows: [] };

beforeEach(() => {
  vi.resetAllMocks();
  useProjectsStore.setState({ projects: [project], loading: false, error: null });
  getProject.mockResolvedValue({ project, members: [member] });
  getProjectActivity.mockResolvedValue({ entries: [], nextCursor: null });
  getRun.mockResolvedValue({ run: { session: { id: uuid, problem: 'Improve checkout accessibility', status: 'completed', created_at: 1_757_299_000 }, units: [] } });
  apiFetch.mockImplementation((path: string) => Promise.resolve(path.includes('/standing-orders') ? { away: false, orders: [] } : path.includes('/requirements') ? requirements : path.includes('/coverage')
    ? { projectId: 'shop', totals: { repos: 0, ok: 0, behavior_bearing: 0, resolved: 0, coverage: null }, rows: [] }
    : { projectId: 'shop', totals: { repos: 0, ok: 0, domains: 0, requirements: 0, entities: 0 }, rows: [], merged: [] }));
});
afterEach(cleanup);

describe('S6 project and requirements presentation', () => {
  it('renders member session titles and shared status words, linking to the existing session route', async () => {
    const navigate = vi.fn();
    const { container } = render(<ProjectDesk needRows={[]} now={1_757_300_000_000} runsLoaded={true} search="?tab=runs" runs={[]} projectId="shop" navigate={navigate} />);
    // The calm Jobs page opens on Active; a finished job is under Finished.
    fireEvent.click(await screen.findByTestId('desk-runs-group-finished'));
    const link = await screen.findByRole('link', { name: /^Improve checkout accessibility/ });
    expect(link).toHaveAttribute('href', `/s/run%3A${uuid}`);
    expect(screen.getByTestId('desk-runs')).toHaveTextContent('Finished');
    expect(container.textContent).not.toContain(uuid);
    expect(container.textContent).not.toContain('crew.run');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith(`/s/run%3A${uuid}`);
  });

  it('falls back to Untitled job when the job has no words — never its id', async () => {
    getRun.mockResolvedValue({ run: { session: { id: uuid, problem: '', status: 'cancelled', created_at: 1_757_299_000 }, units: [] } });
    const { container } = render(<ProjectDesk needRows={[]} now={1_757_300_000_000} runsLoaded={true} search="?tab=runs" runs={[]} projectId="shop" navigate={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('desk-runs-group-finished'));
    expect(await screen.findByRole('link', { name: /^Untitled job/ })).toBeInTheDocument();
    expect(screen.getByTestId('desk-runs')).toHaveTextContent('Stopped');
    expect(container.textContent).not.toContain(uuid);
  });

  it('uses the shared Desk for projects and the page frame for requirements', async () => {
    const detail = render(<ProjectDesk needRows={[]} now={1_757_300_000_000} runsLoaded={true} search="?tab=runs" runs={[]} projectId="shop" navigate={vi.fn()} />);
    fireEvent.click(await screen.findByTestId('desk-runs-group-finished'));
    await screen.findByRole('link', { name: /^Improve checkout accessibility/ });
    expect(detail.container.querySelector('.wk-desk2')).toBeInTheDocument();
    expect(detail.container.querySelector('.font-mono')).toBeNull();
    expect(detail.container.querySelector('[style*="monospace"], [style*="font-mono"]')).toBeNull();
    cleanup();
    const product = render(<ProjectRequirementsPage projectId="shop" navigate={vi.fn()} />);
    expect(screen.getByTestId('project-requirements-page')).toHaveClass('wk-page');
    expect(product.container.querySelector('.font-mono')).toBeNull();
    expect(product.container.querySelector('[style*="monospace"], [style*="font-mono"]')).toBeNull();
  });

});
