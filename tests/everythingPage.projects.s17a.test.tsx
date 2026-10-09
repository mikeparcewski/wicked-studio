import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '../src/api/types.js';

const updateProject = vi.fn();
const listProjects = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: (_target, key) => key === 'updateProject' ? updateProject : key === 'listProjects' ? listProjects : () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/hooks/useBoardModel.js', () => ({ useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null }) }));

const { EverythingPage } = await import('../src/components/everything/EverythingPage.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const p = (id: string, name: string, status: 'active' | 'archived' = 'active'): Project =>
  ({ id, name, status, description: '', updated_at: 1, created_at: 1 } as Project);

beforeEach(() => {
  useProjectsStore.setState({ projects: [p('default', 'Unfiled'), p('scratch', 'Scratch'), p('alpha', 'Alpha')] });
  updateProject.mockReset().mockImplementation(async (id: string, body: Record<string, unknown>) => ({ project: { ...p(id, id === 'scratch' ? 'Scratch' : 'Alpha'), ...body } }));
  listProjects.mockReset().mockResolvedValue({ projects: [p('old', 'Old sprint', 'archived')] });
});
afterEach(cleanup);

describe('S17a Projects surface', () => {
  it('shows empty projects, excludes default, and opens scoped Sessions', () => {
    const navigate = vi.fn();
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={navigate} search="?tab=projects" />);
    expect(screen.getByTestId('projects-tab')).toBeInTheDocument();
    expect(screen.getAllByTestId('projects-row')).toHaveLength(2);
    fireEvent.click(screen.getAllByTestId('projects-row-open')[0]!);
    expect(navigate).toHaveBeenCalledWith(expect.stringContaining('/everything?tab=sessions&project='));
  });

  it('sends rename and archive PATCH bodies, with row-local refusal', async () => {
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => undefined} search="?tab=projects" />);
    const row = screen.getAllByTestId('projects-row').find((el) => el.dataset.projectId === 'scratch')!;
    fireEvent.click(row.querySelector('[data-testid="projects-row-rename"]')!);
    fireEvent.change(screen.getByLabelText('Project name'), { target: { value: 'New scratch' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('scratch', { name: 'New scratch', description: '' }));
    updateProject.mockRejectedValueOnce(new Error('refused'));
    fireEvent.click(row.querySelector('[data-testid="projects-row-archive"]')!);
    await waitFor(() => expect(row.querySelector('[data-testid="projects-row-error"]')?.textContent).toContain('refused'));
    fireEvent.click(row.querySelector('[data-testid="projects-row-archive"]')!);
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('scratch', { status: 'archived' }));
  });

  it('reads archived projects and sends the unarchive PATCH body', async () => {
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => undefined} search="?tab=projects&filter=archived" />);
    const row = await screen.findByText('Old sprint');
    fireEvent.click(row.closest('[data-testid="projects-row"]')!.querySelector('[data-testid="projects-row-unarchive"]')!);
    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('old', { status: 'active' }));
    expect(listProjects).toHaveBeenCalledWith('archived');
  });

  it('resets the Archived lens when crossing to Projects', () => {
    const navigate = vi.fn();
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={navigate} search="?tab=sessions&filter=archived" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));
    expect(navigate).toHaveBeenCalledWith('/everything?tab=projects');
  });

  it('studio#613: the lens is a chip group, the card is titled with controls, and no separator dangles', () => {
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => undefined} search="?tab=projects" />);
    const lens = screen.getByTestId('projects-filter');
    expect(lens.className).toContain('wk-everything-chips');
    expect([...lens.querySelectorAll('button')].every((b) => b.className.includes('wk-chip'))).toBe(true);
    const row = screen.getAllByTestId('projects-row')[0]!;
    expect(row.querySelector('h2')?.className).toContain('wk-project-title');
    expect(row.querySelector('[data-testid="projects-row-rename"]')?.className).toContain('wk-btn');
    const counts = row.querySelector('[data-state="quiet"]')!.parentElement!.textContent!;
    expect(counts.trim().endsWith('·')).toBe(false);
    expect(counts).toContain('blocked: 0 · quiet: 0');
  });
});
