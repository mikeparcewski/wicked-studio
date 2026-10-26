import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { REPO_CLEAN, REPO_INTREE_LIVE, REPO_INTREE_NO_LIVE, REPO_PREDATES_FINDINGS, REPO_ROOT_UNRESOLVABLE } from './fixtures/wave2.js';
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
  // studio-api: the in-tree graph beside a LIVE one — the downgraded warning after a re-onboard.
  makeView({ id: 'o-api', repo_ref: 'studio-api', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard studio-api' }),
];

const listRepos = vi.fn(() => Promise.resolve({ repos: [REPO_INTREE_NO_LIVE, REPO_CLEAN, REPO_ROOT_UNRESOLVABLE, REPO_INTREE_LIVE] }));
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
    expect(repoGraphGap(REPO_INTREE_LIVE)).toBeNull(); // a live graph beside the ignored in-tree one: no gap
    const fleet = repoFleetModels([REPO_INTREE_NO_LIVE, REPO_CLEAN, REPO_INTREE_LIVE], RUNS, {}, new Set(RUNS.map((v) => v.session.id)));
    const studio = fleet.find((m) => m.repo.id === 'wicked-studio')!;
    const billing = fleet.find((m) => m.repo.id === 'billing')!;
    const api = fleet.find((m) => m.repo.id === 'studio-api')!;
    expect(studio.onboard.state).toBe('ready');           // the run history alone says ready…
    expect(graphReady(studio)).toBe(false);               // …the engine says otherwise
    expect(graphReady(billing)).toBe(true);
    expect(graphReady(api)).toBe(true);
    expect(matchesRepoChip(api, 'ready')).toBe(true);
    expect(matchesRepoChip(studio, 'ready')).toBe(false);
    expect(matchesRepoChip(studio, 'graph-missing')).toBe(true);
    expect(matchesRepoChip(billing, 'graph-missing')).toBe(false);
  });
});

describe('the /repos surface', () => {
  it('the stat line counts a graph-less repo as WITHOUT a code map, not as ready', async () => {
    await panel();
    const line = screen.getByTestId('repos-kpis').textContent ?? '';
    expect(line).toContain('2 with a code map');     // billing + studio-api (in-tree beside a LIVE graph = ready)
    expect(line).toContain('2 without a code map');  // wicked-studio (no live graph) + orphan (no graph root)
  });

  it('the card says "No code map yet" with Re-run onboarding, never "ready", for the in-tree repo', async () => {
    await panel();
    const cards = screen.getAllByTestId('repo-card');
    const studio = cards.find((c) => c.getAttribute('data-repo-id') === 'wicked-studio')!;
    const state = within(studio).getByTestId('repo-graph-state');
    expect(state).toHaveAttribute('data-state', 'missing');
    expect(state.textContent).toContain('No code map yet');
    expect(state.textContent).not.toContain('ready');
    // The gap is said once: the finding row under it carries only its action.
    expect(within(studio).getByTestId('repo-card-findings-row').querySelector('.wk-pg-repo-finding-text')).toBeNull();
    // The finding row with its action still rides the card (studio#253).
    expect(within(studio).getByTestId('repo-card-findings-reonboard')).toBeInTheDocument();

    // The row's face says it too, and offers the next step: Re-index (a prefill of the recorded onboard).
    expect(within(studio).getByTestId('repo-row-line')).toHaveTextContent('no code map');
    expect(within(studio).getByTestId('repo-row-reindex')).toHaveTextContent('Re-index');
    expect(studio).toHaveAttribute('data-ready', 'missing');

    const orphan = cards.find((c) => c.getAttribute('data-repo-id') === 'orphan')!;
    expect(within(orphan).getByTestId('repo-row-line')).toHaveTextContent('no place to keep a code map');
    expect(within(orphan).getByTestId('repo-graph-state').textContent).toContain('No code map: Studio’s service has nowhere to keep one');

    const billing = cards.find((c) => c.getAttribute('data-repo-id') === 'billing')!;
    expect(within(billing).getByTestId('repo-graph-state')).toHaveAttribute('data-state', 'ready');
    // The second half of the daemon's semantics: an in-tree graph beside a LIVE graph (the finding
    // downgraded to a tidy-up warning after the re-onboard) reads READY — the warning chip stays,
    // no re-onboard action, no gap.
    const api = cards.find((c) => c.getAttribute('data-repo-id') === 'studio-api')!;
    expect(within(api).getByTestId('repo-graph-state')).toHaveAttribute('data-state', 'ready');
    expect(within(api).getByTestId('repo-graph-state').textContent).toContain('Code map ready');
    expect(within(api).getByTestId('repo-card-findings')).toHaveAttribute('data-count', '1');
    expect(within(api).queryByTestId('repo-card-findings-reonboard')).toBeNull();
  });

  it('the No code map chip filters to the graph-less repos', async () => {
    await panel();
    const chip = (id: string) => screen.getAllByTestId('repos-filter-chip').find((c) => c.getAttribute('data-chip') === id)!;
    fireEvent.click(chip('graph-missing'));
    expect(screen.getByTestId('repos-filter').getAttribute('data-filter')).toBe('graph-missing');
    expect(screen.getAllByTestId('repo-card').map((c) => c.getAttribute('data-repo-id')).sort()).toEqual(['orphan', 'wicked-studio']);
    // …and the Ready chip holds the two with a live graph, the live-in-tree repo included.
    fireEvent.click(chip('ready'));
    expect(screen.getByTestId('repos-filter').getAttribute('data-filter')).toBe('ready');
    expect(screen.getAllByTestId('repo-card').map((c) => c.getAttribute('data-repo-id')).sort()).toEqual(['billing', 'studio-api']);
  });
});
