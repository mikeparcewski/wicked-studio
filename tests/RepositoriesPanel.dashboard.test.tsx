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
const getRepoGraph = vi.fn((...args: unknown[]) => { void args; return Promise.resolve({ graph: null as unknown }); });
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
const { clearRetryPrefill } = await import('../src/store/retryPrefill.js');
const { resetRepoLanguages } = await import('../src/hooks/useRepoLanguages.js');

async function panel(navigate: (p: string) => void = () => {}): Promise<void> {
  render(<RepositoriesPanel navigate={navigate} />);
  await screen.findByTestId('repos-kpis');
  await screen.findByTestId('repos-list');
}

beforeEach(() => {
  listRepos.mockClear();
  listRuns.mockClear();
  getRepoGraph.mockClear();
  resetRepoLanguages();
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

describe('the stat line (UI-CONTRACT §4.6: KPI tiles retired)', () => {
  it('states the fleet facts in one sentence-case line above the fleet; zeros hidden', async () => {
    await panel();
    const line = screen.getByTestId('repos-kpis');
    // 3 repos · 1 with a code map (studio-api) · 1 working now (r-a1's repo) · 2 failed in the window
    // (r-a2 + o-billing) · 2 without a code map (billing onboard failed + fresh never).
    expect(line.textContent).toBe('3 repositories · 1 with a code map · 1 working now · 2 failed (last 30) · 2 without a code map');
    expect(line.className).toContain('wk-statline');
    const list = screen.getByTestId('repos-list');
    expect(line.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // No uppercase micro-labels, no "_" placeholder, no mono on the page body.
    expect(screen.getByTestId('repos-page').textContent).not.toMatch(/PERFORMANCE|PIPELINE|RISK|_/);
    expect(screen.getByTestId('repos-page').querySelector('.font-mono')).toBeNull();
  });

  it('a failed read shows ONE banner with Retry and no counts (never 0)', async () => {
    listRepos.mockImplementationOnce(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<RepositoriesPanel navigate={() => {}} />);
    const banner = await screen.findByTestId('repos-error');
    expect(banner).toHaveAttribute('data-kind', 'offline');
    expect(banner.querySelector('.wk-state-banner-text')!.textContent).not.toContain('Failed to fetch');
    expect(screen.queryByTestId('repos-kpis')).toBeNull();
    fireEvent.click(screen.getByTestId('repos-error-retry'));
    await screen.findByTestId('repos-list');
    expect(listRepos).toHaveBeenCalledTimes(2);
  });
});

describe('the list — one row per repository, in columns; a row is a door to its page', () => {
  it('orders needs-you FIRST and derives each code-map state from the run history', async () => {
    await panel();
    const cards = screen.getAllByTestId('repo-card');
    // billing gated → first; studio-api failing (r-a2) → next; fresh quiet last.
    expect(cards.map((c) => c.getAttribute('data-repo-id'))).toEqual(['billing', 'studio-api', 'fresh']);
    expect(cards.map((c) => c.getAttribute('data-graph'))).toEqual(['failed', 'ready', 'never']);
    const map = (card: HTMLElement) => within(card).getByTestId('repo-row-map');
    expect(map(cards[0]!)).toHaveAttribute('data-tone', 'fail');
    expect(map(cards[1]!)).toHaveAttribute('data-tone', 'ok');
    expect(map(cards[2]!)).toHaveAttribute('data-tone', 'none');
  });

  it('a row opens the repository’s page; there is no expander and no box of details under it', async () => {
    const navigate = vi.fn();
    await panel(navigate);
    const card = screen.getAllByTestId('repo-card').find((c) => c.getAttribute('data-repo-id') === 'studio-api')!;
    const row = within(card).getByTestId('repo-row');
    expect(row.tagName).toBe('A');
    expect(row).toHaveAttribute('href', '/repo-detail/studio-api');
    expect(row).not.toHaveAttribute('aria-expanded');
    expect(within(card).queryByTestId('repo-details')).toBeNull();
    expect(within(card).queryByTestId('repo-know')).toBeNull();
    fireEvent.click(row);
    expect(navigate).toHaveBeenCalledWith('/repo-detail/studio-api');
  });

  it('the columns: a name with language · branch, the code map in words, and one word or one next step on the right', async () => {
    await panel();
    const card = (id: string) => screen.getAllByTestId('repo-card').find((c) => c.getAttribute('data-repo-id') === id)!;
    expect(within(card('studio-api')).getByTestId('repo-row-line')).toHaveTextContent(/^Indexed$/);
    expect(within(card('studio-api')).getByTestId('repo-row-word')).toHaveTextContent('Working now');
    expect(within(card('billing')).getByTestId('repo-row-line')).toHaveTextContent('Indexing failed');
    expect(within(card('billing')).getByTestId('repo-needs-you')).toHaveTextContent('Waiting on you');
    expect(within(card('fresh')).getByTestId('repo-row-line')).toHaveTextContent('Not indexed yet');
    expect(within(card('fresh')).getByTestId('repo-row-index')).toHaveTextContent('Index');
    expect(within(card('fresh')).getByTestId('repo-row-sub')).toHaveTextContent(/^main$/);
    // Last activity is its own column, so a quiet "Active …" word is not said again on the right.
    expect(within(card('fresh')).queryByTestId('repo-row-word')).toBeNull();
    expect(within(card('fresh')).getByTestId('repo-row-last').textContent).toMatch(/^added /);
    // No path or id on the face: where it lives is on its page (Settings).
    for (const c of screen.getAllByTestId('repo-card')) {
      expect(within(c).getByTestId('repo-row').textContent ?? '').not.toContain('/tmp/');
    }
    expect(screen.getByTestId('repos-sentence')).toHaveTextContent('Three repositories. One is indexed; one needs re-indexing; one is not indexed yet. One job waits on you.');
  });

  it('the needs-you badge jumps STRAIGHT to the gate (project known ⇒ the thread AT the gate)', async () => {
    const navigate = vi.fn();
    await panel(navigate);
    const jump = screen.getByTestId('repo-needs-you');
    expect(jump.getAttribute('data-run-id')).toBe('r-gate');
    fireEvent.click(jump);
    expect(navigate).toHaveBeenCalledWith('/s/run%3Ar-gate#gate');
    expect(navigate).not.toHaveBeenCalledWith('/repo-detail/billing'); // no row navigation leaked
  });

  it('a never-onboarded repo’s Index starts the EXISTING onboard wire, and does not open the row', async () => {
    const navigate = vi.fn();
    await panel(navigate);
    const fresh = screen.getAllByTestId('repo-card').find((c) => c.getAttribute('data-repo-id') === 'fresh')!;
    fireEvent.click(within(fresh).getByTestId('repo-row-index'));
    expect(rerunOnboarding).toHaveBeenCalledTimes(1);
    expect(navigate).not.toHaveBeenCalledWith('/repo-detail/fresh');
  });
});

describe('the filters drive the fleet; the register flow is untouched', () => {
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

  it('keeps the add affordance; the list is GET /repos + GET /runs, then one code-map read per indexed repo for its language', async () => {
    getRepoGraph.mockImplementation((id: unknown) => Promise.resolve({ graph: id === 'studio-api'
      ? { nodes: [{ file: 'src/a.ts', lang: 'typescript' }, { file: 'src/b.ts', lang: 'typescript' }, { file: 'x.py', lang: 'python' }], edges: [], stats: { nodeCount: 3, edgeCount: 0, fileCount: 3 } }
      : null }));
    await panel();
    expect(screen.getByTestId('repos-add')).toHaveTextContent('Add a repository');
    expect(screen.getByTestId('repos-add').className).toContain('wk-jr-btn--primary');
    expect(listRepos).toHaveBeenCalledTimes(1);
    expect(listRuns).toHaveBeenCalledTimes(1);
    // Only repos with a recorded onboard and no engine gap have a map to read; never-indexed fresh is not asked.
    const api = screen.getAllByTestId('repo-card').find((c) => c.getAttribute('data-repo-id') === 'studio-api')!;
    await within(api).findByText('TypeScript + Python · main');
    expect(getRepoGraph.mock.calls.map((c) => c[0]).sort()).toEqual(['billing', 'studio-api']);
  });

  it('the list is one column of rows inside the page measure', async () => {
    await panel();
    const list = screen.getByTestId('repos-list') as HTMLElement;
    expect(list.tagName).toBe('UL');
    expect(list.className).toContain('wk-rl-list');
    expect(screen.getByTestId('repos-page').querySelector('.wk-jr-col')).not.toBeNull();
  });

  it('with no repos at all, the empty state carries the creation CTA — clicking opens the form, posts nothing', async () => {
    listRepos.mockImplementationOnce(() => Promise.resolve({ repos: [] }));
    listRuns.mockImplementationOnce(() => Promise.resolve({ runs: [] }));
    render(<RepositoriesPanel navigate={() => {}} />);
    const empty = await screen.findByTestId('repos-empty');
    expect(empty.textContent).toContain('No repositories yet');
    // The CTA is the section's creation verb, INSIDE the empty state.
    const cta = within(empty).getByRole('button', { name: 'Add a repository' });
    fireEvent.click(cta);
    // The register form opens (the slice-B flow) — nothing was posted.
    expect(screen.getByTestId('repo-project-row')).toBeInTheDocument();
    expect(rerunOnboarding).not.toHaveBeenCalled();
  });
});

describe('a capture-learnings run changes nothing the list says (its state lives on the repository’s page)', () => {
  it('ordering and the numbers hold; no capture verb on the list', async () => {
    listRuns.mockImplementationOnce(() => Promise.resolve({ runs: [...RUNS, makeView({ id: 'c-api', repo_ref: 'studio-api', workflow_id: 'capture-learnings', status: 'completed' })] }));
    await panel();
    expect(screen.getAllByTestId('repo-card').map((c) => c.getAttribute('data-repo-id'))).toEqual(['billing', 'studio-api', 'fresh']);
    expect(screen.getAllByTestId('repo-card').find((c) => c.getAttribute('data-repo-id') === 'studio-api')).toHaveAttribute('data-captured', 'captured');
    expect(screen.getByTestId('repos-kpis').textContent).toContain('1 with a code map');
    expect(screen.getByTestId('repos-kpis').textContent).toContain('2 without a code map');
    expect(screen.queryByTestId('repo-capture-learnings')).toBeNull();
  });
});
