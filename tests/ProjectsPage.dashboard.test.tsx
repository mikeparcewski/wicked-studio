import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Project, ProjectMember } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * The /projects landing as a command surface (lane B): a FULL-WIDTH reporting
 * dashboard — the command-center KPI band (performance / pipeline / risk) with
 * honest window deltas ("—" when no prior bucket exists), then a filterable
 * grid of project cards, each a mini-dashboard row. Cards are doors; needs-you
 * floats first and jumps straight to the waiting run's gate; unfiled runs get
 * an honest card of their own.
 */

const NOW = Date.now();
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const project = (over: Partial<Project> & { id: string; name: string }): Project => ({
  description: null, status: 'active', scope: `project:${over.id}`,
  created_at: 1, updated_at: 1, ...over,
});

const PROJECTS: Project[] = [
  project({ id: 'default', name: 'Unfiled' }),
  project({ id: 'p-hot', name: 'auth-refactor', updated_at: NOW }),
  project({ id: 'p-cold', name: 'smoke-tests', updated_at: NOW - 30 * DAY }),
  project({ id: 'p-old', name: 'retired-spike', status: 'archived', updated_at: 1 }),
];

const member = (project_id: string, ref: string, attached_at: number, kind = 'crew.run'): ProjectMember => ({
  id: `${project_id}:${kind}:${ref}`, project_id, member_kind: kind,
  member_ref: ref, meta: null, attached_at, attached_by: 'studio',
});

const MEMBERS: Record<string, ProjectMember[]> = {
  'p-hot': [
    member('p-hot', 'r-gated', NOW - 60_000),
    member('p-hot', 'r-failed', NOW - 3 * DAY),
    member('p-hot', 'repo-a', NOW - 5 * DAY, 'crew.repo'),
    member('p-hot', 'repo-b', NOW - 5 * DAY, 'crew.repo'),
  ],
  'p-cold': [member('p-cold', 'r-done', NOW - 2 * DAY)],
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
vi.mock('../src/api/interactive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/interactive.js')>()),
  listDocs: () => Promise.resolve([]),
}));

const { ProjectsPage } = await import('../src/components/ProjectsPage.js');
const { useGateStore } = await import('../src/store/gates.js');

const RUNS = [
  makeView({ id: 'r-gated', workflow_id: 'wf-w2', status: 'awaiting_human', problem: 'refactor auth' }),
  makeView({ id: 'r-failed', workflow_id: 'wf-w2', status: 'failed', problem: 'ship the uploader' }),
  makeView({ id: 'r-done', workflow_id: 'wf-w2', status: 'completed', problem: 'smoke it' }),
  // A member of NO project and carrying no project_id claim — unfiled once the join lands.
  makeView({ id: 'r-stray', workflow_id: 'wf-w2', status: 'completed', problem: 'stray work' }),
];

async function page(navigate: (p: string) => void = () => {}): Promise<ReturnType<typeof render>> {
  const view = render(<ProjectsPage runs={RUNS} navigate={navigate} />);
  await screen.findByTestId('projects-list');
  // Both async settles: the register GET and the board's membership join.
  await vi.waitFor(() => {
    const hot = screen.getAllByTestId('project-card')
      .find((c) => c.getAttribute('data-project-id') === 'p-hot');
    expect(hot?.getAttribute('data-gates')).toBe('1');
  });
  return view;
}

beforeEach(() => {
  listProjects.mockClear();
  useGateStore.setState({ gates: {} });
});
afterEach(() => cleanup());

describe('full width — a reporting dashboard, not a 760px column', () => {
  it('the page root carries NO maxWidth and the grid is a real CSS grid', async () => {
    await page();
    const root = screen.getByTestId('projects-page') as HTMLElement;
    expect(root.style.maxWidth).toBe('');
    const grid = screen.getByTestId('projects-list') as HTMLElement;
    expect(grid.style.display).toBe('grid');
    expect(grid.style.gridTemplateColumns).toContain('auto-fill');
  });
});

describe('the KPI band — performance / pipeline / risk, honest numbers', () => {
  it('renders the command-center tiles with live values', async () => {
    useGateStore.getState().setGate({
      runId: 'r-gated', ord: 0, prompt: 'Approve the refactor?', lifecycle: 'open',
      receivedAt: NOW - 3 * 60_000,
    });
    await page();
    const band = screen.getByTestId('projects-kpis');
    const value = (tid: string): string | null =>
      band.querySelector(`[data-testid="${tid}"]`)?.getAttribute('data-value') ?? null;
    expect(value('stat-projects')).toBe('2');       // p-hot + p-cold (default/archived never cards)
    expect(value('stat-runs')).toBe('4');           // all four live runs sit in the last-30 window
    expect(value('stat-active')).toBe('0');
    expect(value('stat-gates')).toBe('1');
    expect(value('stat-failed')).toBe('1');
    expect(value('stat-unfiled')).toBe('1');        // r-stray, honest and visible
    // The gate tile wears the gate token — it means something.
    const gatesValue = within(band.querySelector('[data-testid="stat-gates"]') as HTMLElement).getByTestId('stat-value');
    expect((gatesValue as HTMLElement).style.color).toBe('var(--status-gate)');
  });

  it('4 runs against a 30-run window has NO prior bucket — the delta reads "—", never 0%', async () => {
    await page();
    const runsTile = screen.getByTestId('stat-runs');
    expect(runsTile.getAttribute('data-delta')).toBe('none');
    expect(within(runsTile).getByTestId('stat-delta')).toHaveTextContent('—');
  });

  it('tiles are doors: Failed opens the Work list pre-filtered', async () => {
    const navigate = vi.fn();
    await page(navigate);
    fireEvent.click(screen.getByTestId('stat-failed'));
    expect(navigate).toHaveBeenCalledWith('/work?filter=failed');
  });
});

describe('the project cards — mini-dashboard rows, needs-you first', () => {
  it('cards carry runs (window), the success/failed split, repo count, and last activity', async () => {
    await page();
    const hot = screen.getAllByTestId('project-card')
      .find((c) => c.getAttribute('data-project-id') === 'p-hot')! as HTMLElement;
    expect(hot.getAttribute('data-runs')).toBe('2');
    expect(within(hot).getByTestId('card-runs')).toHaveTextContent('2 runs · last 30');
    // 0 done of 1 terminal (the failed run) — red, never success-green.
    const split = within(hot).getByTestId('card-split');
    expect(split.getAttribute('data-health')).toBe('bad');
    expect(split).toHaveTextContent('✓0 · ✕1');
    expect(hot).toHaveTextContent('2 repos');
    expect(hot).toHaveTextContent(/ago/);
  });

  it('needs-you sorts FIRST and its badge deep-links STRAIGHT to the waiting run’s gate', async () => {
    const navigate = vi.fn();
    await page(navigate);
    const ids = within(screen.getByTestId('projects-list'))
      .getAllByTestId('project-card').map((c) => c.getAttribute('data-project-id'));
    expect(ids[0]).toBe('p-hot'); // the gated project floats first
    const badge = screen.getByTestId('project-needs-you');
    expect(badge).toHaveTextContent('needs you · 1');
    fireEvent.click(badge);
    expect(navigate).toHaveBeenCalledWith('/p/p-hot/build/r-gated#gate');
    // The badge click never triggered the card's own navigation.
    expect(navigate).not.toHaveBeenCalledWith('/p/p-hot');
  });

  it('the card itself is a door to the project homepage /p/:id', async () => {
    const navigate = vi.fn();
    await page(navigate);
    const cold = screen.getAllByTestId('project-card')
      .find((c) => c.getAttribute('data-project-id') === 'p-cold')!;
    fireEvent.click(cold);
    expect(navigate).toHaveBeenCalledWith('/p/p-cold');
  });

  it('unfiled runs get a card too — honest, not hidden — opening the Work list', async () => {
    const navigate = vi.fn();
    await page(navigate);
    const unfiled = screen.getByTestId('unfiled-card');
    expect(unfiled.getAttribute('data-runs')).toBe('1');
    fireEvent.click(unfiled);
    expect(navigate).toHaveBeenCalledWith('/work');
  });
});

describe('the FilterStrip drives the grid', () => {
  it('the needs-you chip narrows the grid to gated projects', async () => {
    await page();
    const chip = screen.getAllByTestId('projects-filter-chip')
      .find((c) => c.getAttribute('data-chip') === 'needs-you')!;
    fireEvent.click(chip);
    const ids = within(screen.getByTestId('projects-list'))
      .getAllByTestId('project-card').map((c) => c.getAttribute('data-project-id'));
    expect(ids).toEqual(['p-hot']);
    expect(screen.queryByTestId('unfiled-card')).toBeNull(); // no unfiled gate waits
  });

  it('search narrows by name and the empty state offers clearing', async () => {
    await page();
    fireEvent.change(screen.getByTestId('projects-filter-search'), { target: { value: 'smoke' } });
    const ids = within(screen.getByTestId('projects-list'))
      .getAllByTestId('project-card').map((c) => c.getAttribute('data-project-id'));
    expect(ids).toEqual(['p-cold']);
    fireEvent.change(screen.getByTestId('projects-filter-search'), { target: { value: 'zzz-nothing' } });
    expect(screen.getByTestId('projects-empty-filter')).toHaveTextContent('No projects match');
  });
});

describe('the register stays complete', () => {
  it('archived projects stay reachable behind the toggle', async () => {
    await page();
    fireEvent.click(screen.getByText(/Show 1 archived project/));
    const all = screen.getAllByTestId('project-card').map((c) => c.getAttribute('data-project-id'));
    expect(all).toContain('p-old');
  });

  it('preserves create and the creation verbs in the header', async () => {
    const navigate = vi.fn();
    await page(navigate);
    expect(screen.getByText('New project')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('projects-do-work'));
    expect(navigate).toHaveBeenCalledWith('/runs/new');
  });
});
