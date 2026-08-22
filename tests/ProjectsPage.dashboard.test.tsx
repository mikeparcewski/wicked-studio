import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Project, ProjectMember } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * The /projects dashboard (DES-FEEDBACK-003 §4.1, slice P): the complete
 * register + the three-tile reporting band. Pinned here: the §4.1 tiles with
 * their named questions (EC19/EC28) above the list, the REGISTER completeness
 * (every project incl. archived — never the board mirror's active-only
 * subset), the row sparklines off the board's attach clocks, and the
 * preserved create/archive-toggle/navigation affordances.
 */

const NOW = Date.now();

const project = (over: Partial<Project> & { id: string; name: string }): Project => ({
  description: null, status: 'active', scope: `project:${over.id}`,
  created_at: 1, updated_at: 1, ...over,
});

const PROJECTS: Project[] = [
  project({ id: 'default', name: 'Unfiled' }),
  project({ id: 'p-hot', name: 'auth-refactor', updated_at: NOW }),
  project({ id: 'p-cold', name: 'smoke-tests', updated_at: NOW - 30 * 86_400_000 }),
  project({ id: 'p-old', name: 'retired-spike', status: 'archived', updated_at: 1 }),
];

const member = (project_id: string, ref: string, attached_at: number): ProjectMember => ({
  id: `${project_id}:crew.run:${ref}`, project_id, member_kind: 'crew.run',
  member_ref: ref, meta: null, attached_at, attached_by: 'studio',
});

const MEMBERS: Record<string, ProjectMember[]> = {
  'p-hot': [member('p-hot', 'r-gated', NOW - 60_000)],
  'p-cold': [member('p-cold', 'r-done', NOW - 2 * 86_400_000)],
};

const listProjects = vi.fn(() => Promise.resolve({ projects: PROJECTS }));
vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => listProjects(),
    listRepos: () => Promise.resolve({ repos: [] }),
    listProjectMembers: (id: string) => Promise.resolve({ members: MEMBERS[id] ?? [] }),
    getRunEvents: () => Promise.resolve({ events: [] }),
  },
}));
vi.mock('../src/api/interactive.js', () => ({
  listDocs: () => Promise.resolve([]),
}));

const { ProjectsPage } = await import('../src/components/ProjectsPage.js');
const { useGateStore } = await import('../src/store/gates.js');

const RUNS = [
  makeView({ id: 'r-gated', workflow_id: 'wf-w2', status: 'awaiting_human', problem: 'refactor auth' }),
  makeView({ id: 'r-done', workflow_id: 'wf-w2', status: 'completed', problem: 'smoke it' }),
];

async function page(navigate: (p: string) => void = () => {}): Promise<void> {
  render(<ProjectsPage runs={RUNS} navigate={navigate} />);
  // The register (page-owned GET) and the board model both settle async.
  await screen.findByTestId('projects-list');
  await vi.waitFor(() => {
    expect(screen.getByTestId('attention-split-tile').getAttribute('data-total')).toBe('2');
  });
}

beforeEach(() => {
  listProjects.mockClear();
  useGateStore.setState({ gates: {} });
});
afterEach(() => cleanup());

describe('the tile band (§4.1, EC19/EC28)', () => {
  it('renders the three tiles with their named questions, above the register', async () => {
    useGateStore.getState().setGate({
      runId: 'r-gated', ord: 0, prompt: 'Approve the refactor?', lifecycle: 'open',
      receivedAt: NOW - 3 * 60_000,
    });
    await page();
    const band = screen.getByTestId('projects-dashboard-tiles');
    const q = (tid: string): string | null =>
      band.querySelector(`[data-testid="${tid}"]`)?.getAttribute('data-question') ?? null;
    expect(q('attention-split-tile')).toBe('How much of my estate needs me?');
    expect(q('run-outcome-bar')).toBe('Is the system healthy right now?');
    expect(q('gates-waiting-tile')).toBe('Am I the blocker anywhere?');
    const list = screen.getByTestId('projects-list');
    expect(band.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('reads the board bands, never re-deriving them: a fresh gate = needs-you', async () => {
    await page();
    const split = screen.getByTestId('attention-split-tile');
    expect(split.getAttribute('data-needs-you')).toBe('1'); // p-hot's waiting run
    expect(split.getAttribute('data-quiet')).toBe('1');
    expect(split.textContent).toContain('1 need you · 1 quiet · 2 total');
  });

  it('buckets the outcome bar on the merged attach clocks (24h window)', async () => {
    await page();
    const bar = screen.getByTestId('run-outcome-bar');
    // r-gated attached 1min ago (in window); r-done 2 days ago (outside).
    expect(bar.getAttribute('data-total')).toBe('1');
    expect(bar.getAttribute('data-unplaced')).toBe('1');
  });

  it('counts waiting gates with the oldest age', async () => {
    useGateStore.getState().setGate({
      runId: 'r-gated', ord: 0, prompt: 'Approve the refactor?', lifecycle: 'open',
      receivedAt: NOW - 3 * 60_000,
    });
    await page();
    const tile = screen.getByTestId('gates-waiting-tile');
    expect(tile.getAttribute('data-count')).toBe('1');
    expect(tile.textContent).toContain('1 waiting');
    expect(tile.textContent).toContain('Approve the refactor?');
  });
});

describe('the complete register (§4.1: every project, incl. archived)', () => {
  it('lists every active project (default included) and archived behind the toggle', async () => {
    await page();
    const activeIds = within(screen.getByTestId('projects-list'))
      .getAllByTestId('project-card').map((c) => c.getAttribute('data-project-id'));
    expect(new Set(activeIds)).toEqual(new Set(['default', 'p-hot', 'p-cold']));
    // Archived: present, behind the existing toggle — completeness survives the
    // board mirror's active-only store write.
    fireEvent.click(screen.getByText(/Show 1 archived project/));
    const all = screen.getAllByTestId('project-card').map((c) => c.getAttribute('data-project-id'));
    expect(all).toContain('p-old');
    expect(all).toHaveLength(4);
  });

  it('rows carry the 7-day sparkline where the board holds in-window runs', async () => {
    await page();
    const hot = screen.getAllByTestId('project-card')
      .find((c) => c.getAttribute('data-project-id') === 'p-hot')!;
    expect(within(hot as HTMLElement).getByTestId('project-sparkline')).toBeInTheDocument();
    // p-old (archived) has no board entry — absence stays absent.
    fireEvent.click(screen.getByText(/Show 1 archived project/));
    const old = screen.getAllByTestId('project-card')
      .find((c) => c.getAttribute('data-project-id') === 'p-old')!;
    expect(within(old as HTMLElement).queryByTestId('project-sparkline')).toBeNull();
  });

  it('preserves create and row navigation', async () => {
    const navigate = vi.fn();
    await page(navigate);
    expect(screen.getByText('New project')).toBeInTheDocument();
    const hot = screen.getAllByTestId('project-card')
      .find((c) => c.getAttribute('data-project-id') === 'p-hot')!;
    fireEvent.click(hot);
    expect(navigate).toHaveBeenCalledWith('/projects/p-hot');
  });
});
