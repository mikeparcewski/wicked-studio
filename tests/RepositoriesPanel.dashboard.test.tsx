import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { RepoEntry } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * The /repos landing as a COMMAND SURFACE (lane B, the 0.4.6 treatment): the
 * fleet view of what the agents work ON. Pinned here: the KPI band under the
 * three operator questions with honest window deltas ("—" when no full prior
 * bucket exists), the graph story derived from the run history (the repos
 * wire carries NO index-freshness field — never invented), needs-you-first
 * ordering + the gate jump, Re-index as PREFILL (posts NOTHING), the
 * first-class FilterStrip, and the fetch budget — exactly the page's
 * GET /repos + GET /runs, the per-repo graph fan-out still retired.
 */

const NOW = Date.now();

const repo = (id: string, name: string, registered_at: number): RepoEntry => ({
  id, name, root_path: `/tmp/${id}`, default_branch: 'main', registered_at,
});

const REPOS = [
  repo('studio-api', 'studio-api', 1_700_000_000),
  repo('billing', 'billing', 1_760_000_000),
  repo('fresh', 'fresh', 1_760_100_000),
];

const RUNS = [
  makeView({ id: 'r-gate', repo_ref: 'billing', workflow_id: 'feature', status: 'awaiting_human', problem: 'invoice gate' }),
  makeView({ id: 'r-a1', repo_ref: 'studio-api', workflow_id: 'feature', status: 'executing', problem: 'wire uploads' }),
  makeView({ id: 'r-a2', repo_ref: 'studio-api', workflow_id: 'feature', status: 'failed', problem: 'refactor auth' }),
  makeView({ id: 'r-b1', repo_ref: 'billing', workflow_id: 'feature', status: 'completed', problem: 'invoice math' }),
  makeView({ id: 'o-api', repo_ref: 'studio-api', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard studio-api', clis: ['claude'] }),
  makeView({ id: 'o-billing', repo_ref: 'billing', workflow_id: 'onboarding', status: 'failed', problem: 'Onboard billing' }),
  // 'fresh' has NO onboard run on record — the honest "never onboarded" state.
];

const listRepos = vi.fn(() => Promise.resolve({ repos: REPOS }));
const listRuns = vi.fn(() => Promise.resolve({ runs: RUNS }));
const getRepoGraph = vi.fn();
const rerunOnboarding = vi.fn(() => Promise.resolve({ runId: 'r-new' }));

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listRuns: () => listRuns(),
    getRepoGraph: (...a: unknown[]) => getRepoGraph(...a),
    rerunOnboarding: () => rerunOnboarding(),
    listProjects: () => Promise.resolve({ projects: [] }),
  },
}));

const { RepositoriesPanel } = await import('../src/components/RepositoriesPanel.js');
const { useMembershipStore } = await import('../src/store/membership.js');
const { clearRetryPrefill, peekRetryPrefill } = await import('../src/store/retryPrefill.js');

async function panel(navigate: (p: string) => void = () => {}): Promise<void> {
  render(<RepositoriesPanel navigate={navigate} />);
  await screen.findByTestId('repos-kpis');
  await screen.findByTestId('repos-list');
}

beforeEach(() => {
  listRepos.mockClear();
  listRuns.mockClear();
  getRepoGraph.mockClear();
  rerunOnboarding.mockClear();
  clearRetryPrefill();
  useMembershipStore.setState({
    projectNameByRun: {},
    projectIdByRun: { 'r-gate': 'p-billing' },
    attachedAtByRun: {
      'r-a1': NOW - 3_600_000,
      'r-a2': NOW - 2 * 3_600_000,
      'r-b1': NOW - 3 * 86_400_000,
      'o-api': NOW - 5 * 86_400_000,
      // o-billing / r-gate: no attach clock — excluded from clocks, never invented.
    },
  });
});
afterEach(() => cleanup());

describe('the KPI band — performance / pipeline / risk', () => {
  it('renders the six tiles above the fleet with live values', async () => {
    await panel();
    const band = screen.getByTestId('repos-kpis');
    const value = (tid: string): string | null =>
      band.querySelector(`[data-testid="${tid}"]`)?.getAttribute('data-value') ?? null;
    expect(value('stat-repos')).toBe('3');
    expect(value('stat-repo-runs')).toBe('6');   // every repo-linked run sits in the last-30 window
    expect(value('stat-active')).toBe('1');      // r-a1 moving
    expect(value('stat-ready')).toBe('1');       // studio-api's onboard completed
    expect(value('stat-failed')).toBe('2');      // r-a2 + o-billing failed in the window
    expect(value('stat-gaps')).toBe('2');        // billing (onboard failed) + fresh (never)
    const list = screen.getByTestId('repos-list');
    expect(band.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('6 runs against a 30-run window has NO prior bucket — the delta reads "—", never 0%', async () => {
    await panel();
    expect(screen.getByTestId('stat-repo-runs').getAttribute('data-delta')).toBe('none');
    expect(within(screen.getByTestId('stat-repo-runs')).getByTestId('stat-delta')).toHaveTextContent('—');
    expect(screen.getByTestId('stat-repo-runs').textContent).toContain('no prior window');
  });

  it('the index-gaps tile names both gap kinds and doors into the fleet filter', async () => {
    await panel();
    const gaps = screen.getByTestId('stat-gaps');
    expect(gaps.textContent).toContain('1 onboard failed · 1 never onboarded');
    fireEvent.click(gaps);
    // An onboard failure outranks "never" — the door lands on Failing.
    expect(screen.getByTestId('repos-filter').getAttribute('data-filter')).toBe('failing');
    expect(screen.getAllByTestId('repo-card').map((c) => c.getAttribute('data-repo-id'))).toEqual(['billing', 'studio-api']);
  });
});

describe('the fleet grid — graph honesty, needs-you first, cards are doors', () => {
  it('orders needs-you FIRST and derives each graph state from the run history', async () => {
    await panel();
    const cards = screen.getAllByTestId('repo-card');
    // billing gated → first; studio-api failing (r-a2) → next; fresh quiet last.
    expect(cards.map((c) => c.getAttribute('data-repo-id'))).toEqual(['billing', 'studio-api', 'fresh']);
    const state = (card: HTMLElement) => within(card).getByTestId('repo-graph-state');
    expect(state(cards[0]!).getAttribute('data-state')).toBe('failed');
    expect(state(cards[0]!).textContent).toContain('onboard FAILED');
    expect(state(cards[1]!).getAttribute('data-state')).toBe('ready');
    expect(state(cards[1]!).textContent).toContain('graph ready — onboard completed');
    // The honest never state SAYS it is a no-record claim, not a fact about disk.
    expect(state(cards[2]!).getAttribute('data-state')).toBe('never');
    expect(state(cards[2]!).textContent).toContain('never onboarded — no onboard run on record');
  });

  it('a card is a door: clicking it opens the repo detail', async () => {
    const navigate = vi.fn();
    await panel(navigate);
    const card = screen.getAllByTestId('repo-card').find((c) => c.getAttribute('data-repo-id') === 'studio-api')!;
    fireEvent.click(card);
    expect(navigate).toHaveBeenCalledWith('/repo-detail/studio-api');
  });

  it('the needs-you badge jumps STRAIGHT to the gate (project known ⇒ the thread AT the gate)', async () => {
    const navigate = vi.fn();
    await panel(navigate);
    const jump = screen.getByTestId('repo-needs-you');
    expect(jump.getAttribute('data-run-id')).toBe('r-gate');
    fireEvent.click(jump);
    expect(navigate).toHaveBeenCalledWith('/p/p-billing/build/r-gate#gate');
    expect(navigate).not.toHaveBeenCalledWith('/repo-detail/billing'); // no card navigation leaked
  });

  it('shows the windowed run counts with the ✓/✕ split', async () => {
    await panel();
    const api = screen.getAllByTestId('repo-card').find((c) => c.getAttribute('data-repo-id') === 'studio-api')!;
    expect(within(api).getByTestId('repo-card-runs').textContent).toContain('3 runs · last 30');
    expect(within(api).getByTestId('repo-card-split').textContent).toBe('✓1 · ✕1');
  });
});

describe('Re-index is a PREFILL — never a hidden relaunch', () => {
  it('deposits the recorded onboard run\'s setup and opens the composer; NOTHING posts', async () => {
    const navigate = vi.fn();
    await panel(navigate);
    const reindex = screen.getAllByTestId('repo-reindex').find((b) => b.getAttribute('data-repo-id') === 'studio-api')!;
    fireEvent.click(reindex);
    const prefill = peekRetryPrefill();
    expect(prefill).not.toBeNull();
    expect(prefill!.retryOf).toBe('o-api');
    expect(prefill!.workflowId).toBe('onboarding');
    expect(prefill!.repoRef).toBe('studio-api');
    expect(prefill!.problem).toBe('Onboard studio-api');
    expect(prefill!.clis).toEqual(['claude']);
    expect(navigate).toHaveBeenCalledWith('/runs/new');
    expect(navigate).not.toHaveBeenCalledWith('/repo-detail/studio-api'); // Re-index is not Open
    expect(rerunOnboarding).not.toHaveBeenCalled(); // the prefill posts nothing
  });

  it('a never-onboarded repo keeps the existing Onboard launch verb instead', async () => {
    await panel();
    const fresh = screen.getAllByTestId('repo-card').find((c) => c.getAttribute('data-repo-id') === 'fresh')!;
    expect(within(fresh).queryByTestId('repo-reindex')).toBeNull();
    expect(within(fresh).getByTestId('repo-onboard')).toBeInTheDocument();
  });
});

describe('the FilterStrip drives the fleet; the register flow is untouched', () => {
  it('chips narrow the cards; search matches name and path; clear-filters restores', async () => {
    await panel();
    const chip = (id: string) => screen.getAllByTestId('repos-filter-chip')
      .find((c) => c.getAttribute('data-chip') === id)!;
    fireEvent.click(chip('never'));
    expect(screen.getAllByTestId('repo-card').map((c) => c.getAttribute('data-repo-id'))).toEqual(['fresh']);
    fireEvent.click(chip('needs-you'));
    expect(screen.getAllByTestId('repo-card').map((c) => c.getAttribute('data-repo-id'))).toEqual(['billing']);
    fireEvent.change(screen.getByTestId('repos-filter-search'), { target: { value: 'studio' } });
    expect(screen.getByTestId('repos-empty-filter')).toBeInTheDocument(); // studio-api holds no gate
    fireEvent.click(screen.getByTestId('repos-clear-filters'));
    expect(screen.getAllByTestId('repo-card')).toHaveLength(3);
  });

  it('keeps the add affordance and fires exactly GET /repos + GET /runs — the graph fan-out stays retired', async () => {
    await panel();
    expect(screen.getByText('+ Add Repository')).toBeInTheDocument();
    expect(listRepos).toHaveBeenCalledTimes(1);
    expect(listRuns).toHaveBeenCalledTimes(1);
    expect(getRepoGraph).not.toHaveBeenCalled();
  });

  it('the fleet is a real CSS grid with no maxWidth anywhere on the surface', async () => {
    await panel();
    const grid = screen.getByTestId('repos-list') as HTMLElement;
    expect(grid.style.maxWidth).toBe('');
    expect(grid.style.gridTemplateColumns).toContain('auto-fill');
  });

  it('with no repos at all, the empty state carries the creation CTA — clicking opens the form, posts nothing', async () => {
    listRepos.mockImplementationOnce(() => Promise.resolve({ repos: [] }));
    listRuns.mockImplementationOnce(() => Promise.resolve({ runs: [] }));
    render(<RepositoriesPanel navigate={() => {}} />);
    const empty = await screen.findByTestId('repos-empty');
    expect(empty.textContent).toContain('No repositories');
    // The CTA is the section's creation verb, INSIDE the empty state.
    const cta = within(empty).getByRole('button', { name: '+ Add Repository' });
    fireEvent.click(cta);
    // The register form opens (the slice-B flow) — nothing was posted.
    expect(screen.getByTestId('repo-project-row')).toBeInTheDocument();
    expect(rerunOnboarding).not.toHaveBeenCalled();
  });
});
