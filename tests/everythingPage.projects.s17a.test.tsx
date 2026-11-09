import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  it('shows empty projects, excludes default, and a row opens the project homepage (operator 2026-11-09)', () => {
    const navigate = vi.fn();
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={navigate} search="?tab=projects" />);
    expect(screen.getByTestId('projects-tab')).toBeInTheDocument();
    expect(screen.getAllByTestId('projects-row')).toHaveLength(2);
    const open = screen.getAllByTestId('projects-row-open')[0]!;
    expect(open.getAttribute('href')).toMatch(/^\/projects\/(scratch|alpha)$/);
    fireEvent.click(open);
    expect(navigate).toHaveBeenCalledWith(open.getAttribute('href'));
  });

  it('a row has no rename or archive control: those live in the project\'s Settings, and only there', async () => {
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => undefined} search="?tab=projects" />);
    for (const row of screen.getAllByTestId('projects-row')) {
      expect([...row.querySelectorAll('button, a')].map((el) => el.textContent?.trim())).toEqual(['Open']);
      expect(row.querySelector('input, textarea')).toBeNull();
    }
    expect(updateProject).not.toHaveBeenCalled();
  });

  it('the Archived lens lists archived projects with their tag and no Unarchive button', async () => {
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => undefined} search="?tab=projects&filter=archived" />);
    const row = (await screen.findByText('Old sprint')).closest('[data-testid="projects-row"]')!;
    expect(row.querySelector('[data-testid="projects-row-archived"]')).toHaveTextContent('Archived');
    expect(row.querySelector('[data-testid="projects-row-unarchive"]')).toBeNull();
    expect(row.querySelector('[data-testid="projects-row-open"]')?.getAttribute('href')).toBe('/projects/old');
    expect(listProjects).toHaveBeenCalledWith('archived');
  });

  it('the Sessions list filtered to a project draws no second project card (operator 2026-11-09: it looked incomplete)', async () => {
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => undefined} search="?tab=sessions&project=alpha" />);
    expect(screen.getByTestId('everything-sessions')).toHaveAttribute('data-project', 'alpha');
    expect(screen.queryByTestId('everything-project-header')).toBeNull();
    expect(screen.queryByText('Rename')).toBeNull();
    // An archived project named under the list links to its Settings, where it is restored.
    const archived = await screen.findByTestId('everything-archived-project');
    expect(archived.getAttribute('href')).toBe('/projects/old?tab=settings');
  });

  it('resets the Archived lens when crossing to Projects', () => {
    const navigate = vi.fn();
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={navigate} search="?tab=sessions&filter=archived" />);
    fireEvent.click(screen.getByRole('tab', { name: 'Projects' }));
    expect(navigate).toHaveBeenCalledWith('/everything?tab=projects');
  });

  it('studio#613: the lens is a chip group, the card is titled, and no separator dangles', () => {
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => undefined} search="?tab=projects" />);
    const lens = screen.getByTestId('projects-filter');
    expect(lens.className).toContain('wk-everything-chips');
    expect([...lens.querySelectorAll('button')].every((b) => b.className.includes('wk-chip'))).toBe(true);
    const row = screen.getAllByTestId('projects-row')[0]!;
    expect(row.querySelector('h2')?.className).toContain('wk-project-title');
    expect(row.querySelector('[data-testid="projects-row-open"]')?.className).toContain('wk-btn--secondary');
    // studio#687 row 35: no "working: 0 · waiting: 0 …" dump — zero counts say nothing.
    expect(row.querySelector('[data-testid="project-counts"]')).toBeNull();
    expect(row.textContent).not.toMatch(/working: 0|quiet: 0|Latest activity/);
  });

  it('the Archived lens says "Nothing is archived" only after its read answered (codex r1)', async () => {
    let resolve: (v: { projects: Project[] }) => void = () => undefined;
    listProjects.mockReset().mockReturnValue(new Promise((r) => { resolve = r; }));
    render(<EverythingPage runs={[]} runsLoaded needRows={[]} navigate={() => undefined} search="?tab=projects&filter=archived" />);
    expect(screen.queryByText('Nothing is archived.')).toBeNull();
    expect(screen.getByTestId('projects-checking')).toBeInTheDocument();
    resolve({ projects: [] });
    expect(await screen.findByText('Nothing is archived.')).toBeInTheDocument();
  });

  it('studio#684 row 11: a failed runs read hides every count on Projects (never "Not in a project: 0")', () => {
    render(<EverythingPage runs={[]} runsLoaded={false} runsError="Failed to fetch" needRows={[]} navigate={() => undefined} search="?tab=projects" />);
    expect(screen.getByTestId('projects-failed').getAttribute('data-kind')).toBe('offline');
    expect(screen.queryByTestId('projects-unfiled')).toBeNull();
    expect(screen.queryByTestId('project-counts')).toBeNull();
    expect(screen.getByTestId('projects-tab').textContent).not.toMatch(/Not in a project: 0|0 sessions/);
  });
});
