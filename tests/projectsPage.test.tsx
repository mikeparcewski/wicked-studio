import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { Project } from '../src/api/types.js';

// PROJECTS (`/projects`, operator 2026-10-27): the sidebar's first WORK item. For now it is the projects
// list See everything's Projects tab shows, under the calm page's title, with its own address for the lens.

const listProjects = vi.fn();
vi.mock('../src/api/client.js', () => ({
  api: new Proxy({}, { get: (_target, key) => key === 'listProjects' ? listProjects : () => Promise.resolve({}) }),
  apiFetch: () => Promise.resolve({}),
}));
vi.mock('../src/hooks/useBoardModel.js', () => ({ useBoardModel: () => ({ items: [], unfiled: [], loading: false, error: null }) }));

const { ProjectsPage } = await import('../src/components/everything/ProjectsPage.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useSystemStore } = await import('../src/store/systemSnapshot.js');
const { parseRoute } = await import('../src/hooks/useRoute.js');
const { pageNameFor } = await import('../src/board/pageNames.js');
const { navCurrent } = await import('../src/board/navModel.js');
const p = (id: string, name: string, status: 'active' | 'archived' = 'active'): Project =>
  ({ id, name, status, description: '', updated_at: 1, created_at: 1 } as Project);

beforeEach(() => {
  useProjectsStore.setState({ projects: [p('default', 'Unfiled'), p('alpha', 'Alpha'), p('beta', 'Beta')] });
  listProjects.mockReset().mockResolvedValue({ projects: [p('old', 'Old sprint', 'archived')] });
  // An older crew has answered (no ranked list): the fold is the needs-you source.
  useSystemStore.setState({ mode: 'fallback', healthAt: Date.now(), healthError: null, snapshot: null });
});
afterEach(cleanup);

describe('the Projects page', () => {
  it('is the projects list under one title, and its lens keeps the /projects address', async () => {
    const navigate = vi.fn();
    const { rerender } = render(<ProjectsPage runs={[]} runsLoaded needRows={[]} navigate={navigate} search="" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Projects');
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getAllByTestId('projects-row').map((r) => r.dataset.projectId)).toEqual(['alpha', 'beta']);
    fireEvent.click(screen.getByRole('radio', { name: 'Archived' }));
    expect(navigate).toHaveBeenCalledWith('/projects?filter=archived', { replace: true });
    rerender(<ProjectsPage runs={[]} runsLoaded needRows={[]} navigate={navigate} search="?filter=archived" />);
    await waitFor(() => expect(screen.getAllByTestId('projects-row').map((r) => r.dataset.projectId)).toEqual(['old']));
    fireEvent.click(screen.getByRole('radio', { name: 'Active' }));
    expect(navigate).toHaveBeenLastCalledWith('/projects', { replace: true });
  });

  it('one card per project: its state, one sentence, New project; the card opens the homepage and holds no rename or archive', () => {
    const navigate = vi.fn();
    render(<ProjectsPage runs={[]} runsLoaded needRows={[]} navigate={navigate} search="" />);
    expect(screen.getByTestId('projects-sentence')).toHaveTextContent('Two projects. Nothing needs you.');
    const alpha = screen.getAllByTestId('projects-row')[0]!;
    expect(alpha).toHaveTextContent('Quiet');
    expect(alpha).toHaveTextContent('No jobs yet.');
    expect(screen.getByTestId('projects-new')).toHaveTextContent('New project');
    fireEvent.click(alpha.querySelector('[data-testid="projects-row-open"]')!);
    expect(navigate).toHaveBeenCalledWith('/projects/alpha');
    // Operator 2026-11-09: name, description, Archive and Restore live in the project's Settings, and only there.
    expect(screen.queryByRole('button', { name: 'More actions for Alpha' })).toBeNull();
    for (const card of screen.getAllByTestId('projects-row')) {
      expect([...card.querySelectorAll('a, button')].map((el) => el.getAttribute('data-testid'))).toEqual(['projects-row-open']);
    }
  });

  it('an archived card says Archived, opens its homepage and offers no Unarchive', async () => {
    render(<ProjectsPage runs={[]} runsLoaded needRows={[]} navigate={vi.fn()} search="?filter=archived" />);
    const card = await waitFor(() => screen.getAllByTestId('projects-row').find((r) => r.dataset.projectId === 'old')!);
    expect(card.querySelector('[data-testid="projects-row-state"]')).toHaveTextContent('Archived');
    expect(card.querySelector('[data-testid="projects-row-open"]')?.getAttribute('href')).toBe('/projects/old');
    expect(card.querySelector('button')).toBeNull();
  });

  it('/projects is its own page, named Projects, current under the sidebar item; a project keeps its own name', () => {
    expect(parseRoute('/projects').panel).toBe('projects');
    expect(pageNameFor('/projects')).toBe('Projects');
    expect(pageNameFor('/projects/alpha')).toBeNull();
    expect(navCurrent('/projects')).toBe('projects');
    expect(navCurrent('/projects/alpha')).toBe('projects');
    expect(navCurrent('/')).toBe('home');
    expect(navCurrent('/needs')).toBe('home');
  });
});
