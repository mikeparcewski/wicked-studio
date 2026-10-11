import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const { ProjectDetailPage } = await import('../src/components/ProjectDetailPage.js');
const { ProductPage } = await import('../src/components/product/ProductPage.js');
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
  getRun.mockResolvedValue({ run: { session: { id: uuid, problem: 'Improve checkout accessibility', status: 'completed' }, units: [] } });
  apiFetch.mockImplementation((path: string) => Promise.resolve(path.includes('/requirements') ? requirements : path.includes('/coverage')
    ? { projectId: 'shop', totals: { repos: 0, ok: 0, behavior_bearing: 0, resolved: 0, coverage: null }, rows: [] }
    : { projectId: 'shop', totals: { repos: 0, ok: 0, domains: 0, requirements: 0, entities: 0 }, rows: [], merged: [] }));
});
afterEach(cleanup);

describe('S6 project and Product presentation', () => {
  it('renders member session titles and shared status words, linking to the existing session route', async () => {
    const navigate = vi.fn();
    const { container } = render(<ProjectDetailPage projectId="shop" navigate={navigate} />);
    const link = await screen.findByRole('link', { name: 'Improve checkout accessibility' });
    expect(link).toHaveAttribute('href', `/s/run%3A${uuid}`);
    expect(screen.getByRole('region', { name: 'Sessions' })).toHaveTextContent('Finished');
    expect(container.textContent).not.toContain(uuid);
    expect(container.textContent).not.toContain('crew.run');
    fireEvent.click(link);
    expect(navigate).toHaveBeenCalledWith(`/s/run%3A${uuid}`);
  });

  it('falls back to Untitled session when the session has no title', async () => {
    getRun.mockResolvedValue({ run: { session: { id: uuid, problem: '', status: 'cancelled' }, units: [] } });
    render(<ProjectDetailPage projectId="shop" navigate={vi.fn()} />);
    expect(await screen.findByRole('link', { name: 'Untitled session' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Sessions' })).toHaveTextContent('Cancelled');
  });

  it('disables Draft epics and Search with visible reasons when a project has no repository', async () => {
    const navigate = vi.fn();
    render(<ProductPage search="?project=shop" navigate={navigate} />);
    await screen.findByTestId('product-empty');
    const draft = screen.getByTestId('product-draft');
    const search = screen.getByRole('button', { name: 'Search' });
    for (const control of [draft, search]) {
      expect(control).toBeDisabled();
      const reason = document.getElementById(control.getAttribute('aria-describedby')!);
      expect(reason).toBeVisible();
      expect(reason).toHaveClass('wk-field-note');
      expect(reason).toHaveTextContent('Attach a repository to this project first.');
    }
    const attach = screen.getByRole('link', { name: 'Attach a repository' });
    expect(attach).toHaveClass('wk-btn--primary');
    expect(attach).toHaveAttribute('href', '/repos/new?project=shop');
    fireEvent.click(attach);
    expect(navigate).toHaveBeenCalledWith('/repos/new?project=shop');
  });

  it('uses the page frame and sans-serif body text on both routes', async () => {
    const detail = render(<ProjectDetailPage projectId="shop" navigate={vi.fn()} />);
    await screen.findByRole('link', { name: 'Improve checkout accessibility' });
    expect(detail.container.querySelector('.wk-page')).toBeInTheDocument();
    expect(detail.container.querySelector('.font-mono')).toBeNull();
    expect(detail.container.querySelector('[style*="monospace"], [style*="font-mono"]')).toBeNull();
    cleanup();
    const product = render(<ProductPage search="" navigate={vi.fn()} />);
    expect(within(screen.getByTestId('product-page')).getByLabelText('Project')).toHaveClass('wk-field');
    expect(product.container.querySelector('.font-mono')).toBeNull();
    expect(product.container.querySelector('[style*="monospace"], [style*="font-mono"]')).toBeNull();
  });

  it('combines failed reads into one banner and retries the failed sections', async () => {
    apiFetch.mockRejectedValue(new TypeError('Failed to fetch'));
    render(<ProjectDetailPage projectId="shop" navigate={vi.fn()} />);
    await screen.findByRole('link', { name: 'Improve checkout accessibility' });
    await waitFor(() => expect(screen.getAllByTestId('state-banner')).toHaveLength(1));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('state-banner')).toHaveAttribute('data-kind', 'offline');
    expect(screen.queryByTestId('project-coverage-totals')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(4));
  });
});
