import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { REPO_CLEAN, REPO_INTREE_NO_LIVE, REPO_PREDATES_FINDINGS, REPO_ROOT_UNRESOLVABLE } from './fixtures/wave2.js';
import { makeView } from './factories.js';

/**
 * F-2R2-003 — /repos KPIs and the card's status line derive graph readiness from the
 * engine's checkout findings, not from the newest onboarding run alone. The phase2-r2
 * rig: two in-tree repos read "graph ready — onboard completed" and the tiles said
 * "GRAPHS READY 9 of 9 · INDEX GAPS 0" while their findings said no live graph existed.
 */

const RUNS = [
  makeView({ id: 'o-studio', repo_ref: 'wicked-studio', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard wicked-studio' }),
  makeView({ id: 'o-billing', repo_ref: 'billing', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard billing' }),
  makeView({ id: 'o-orphan', repo_ref: 'orphan', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard orphan' }),
];

const listRepos = vi.fn(() => Promise.resolve({ repos: [REPO_INTREE_NO_LIVE, REPO_CLEAN, REPO_ROOT_UNRESOLVABLE] }));
const listRuns = vi.fn(() => Promise.resolve({ runs: RUNS }));
const rerunOnboarding = vi.fn<(id: string) => Promise<{ runId: string }>>(() => Promise.resolve({ runId: 'r-new' }));

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listRuns: () => listRuns(),
    rerunOnboarding: (id: string) => rerunOnboarding(id),
    listProjects: () => Promise.resolve({ projects: [] }),
  },
}));

const { RepositoriesPanel } = await import('../src/components/RepositoriesPanel.js');
const { graphReady, matchesRepoChip, repoFleetModels, repoGraphGap } = await import('../src/board/repoStats.js');

async function panel(): Promise<void> {
  render(<RepositoriesPanel navigate={() => {}} />);
  await screen.findByTestId('repos-kpis');
  await screen.findByTestId('repos-list');
}

beforeEach(() => { listRepos.mockClear(); listRuns.mockClear(); rerunOnboarding.mockClear(); });
afterEach(() => cleanup());

describe('the fold (repoStats)', () => {
  it('reads the engine\'s gap off the findings and outranks a completed onboard', () => {
    expect(repoGraphGap(REPO_CLEAN)).toBeNull();
    expect(repoGraphGap(REPO_PREDATES_FINDINGS)).toBeNull(); // an older daemon: no field, no gap invented
    expect(repoGraphGap(REPO_INTREE_NO_LIVE)?.kind).toBe('no-live-graph');
    expect(repoGraphGap(REPO_ROOT_UNRESOLVABLE)?.kind).toBe('no-graph-root');
    const fleet = repoFleetModels([REPO_INTREE_NO_LIVE, REPO_CLEAN], RUNS, {}, new Set(RUNS.map((v) => v.session.id)));
    const studio = fleet.find((m) => m.repo.id === 'wicked-studio')!;
    const billing = fleet.find((m) => m.repo.id === 'billing')!;
    expect(studio.onboard.state).toBe('ready');           // the run history alone says ready…
    expect(graphReady(studio)).toBe(false);               // …the engine says otherwise
    expect(graphReady(billing)).toBe(true);
    expect(matchesRepoChip(studio, 'ready')).toBe(false);
    expect(matchesRepoChip(studio, 'graph-missing')).toBe(true);
    expect(matchesRepoChip(billing, 'graph-missing')).toBe(false);
  });
});

describe('the /repos surface', () => {
  it('the KPI tiles count a graph-less repo as an INDEX GAP, not as ready — and name the kind', async () => {
    await panel();
    const band = screen.getByTestId('repos-kpis');
    const value = (tid: string): string | null =>
      band.querySelector(`[data-testid="${tid}"]`)?.getAttribute('data-value') ?? null;
    expect(value('stat-ready')).toBe('1');   // billing only — three onboards completed
    expect(value('stat-gaps')).toBe('2');    // wicked-studio (no live graph) + orphan (no graph root)
    expect(screen.getByTestId('stat-gaps').textContent).toContain('2 graph missing');
    expect(screen.getByTestId('stat-gaps').textContent).not.toContain('every graph ready');
    expect(screen.getByTestId('stat-gaps').getAttribute('title')).toContain('checkout findings');
  });

  it('the card says "graph missing — re-run onboarding", never "graph ready", for the in-tree repo', async () => {
    await panel();
    const cards = screen.getAllByTestId('repo-card');
    const studio = cards.find((c) => c.getAttribute('data-repo-id') === 'wicked-studio')!;
    const state = within(studio).getByTestId('repo-graph-state');
    expect(state).toHaveAttribute('data-state', 'missing');
    expect(state.textContent).toContain('graph missing — re-run onboarding');
    expect(state.textContent).not.toContain('graph ready');
    expect(state.getAttribute('title')).toContain('checkout findings');
    // The finding row with its action still rides the card (studio#253).
    expect(within(studio).getByTestId('repo-card-findings-reonboard')).toBeInTheDocument();

    const orphan = cards.find((c) => c.getAttribute('data-repo-id') === 'orphan')!;
    expect(within(orphan).getByTestId('repo-graph-state').textContent).toContain('graph missing — no graph root resolves');

    const billing = cards.find((c) => c.getAttribute('data-repo-id') === 'billing')!;
    expect(within(billing).getByTestId('repo-graph-state')).toHaveAttribute('data-state', 'ready');
  });

  it('the gaps tile doors into the Graph missing chip, which filters to the graph-less repos', async () => {
    await panel();
    fireEvent.click(screen.getByTestId('stat-gaps'));
    expect(screen.getByTestId('repos-filter').getAttribute('data-filter')).toBe('graph-missing');
    expect(screen.getAllByTestId('repo-card').map((c) => c.getAttribute('data-repo-id')).sort()).toEqual(['orphan', 'wicked-studio']);
  });
});
