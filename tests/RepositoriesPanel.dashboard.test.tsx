import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { RepoEntry } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * The /repos dashboard (DES-FEEDBACK-003 §4.4, slice P): the repo register +
 * the three-tile reporting band. Pinned here: the §4.4 tiles with their named
 * questions (EC19/EC28), the repo_ref×attach-clock grouping honesty (clockless
 * or windowless runs excluded, never painted), the preserved register /
 * search / navigation affordances, and the fetch budget — exactly the page's
 * existing GET /repos + GET /runs, with the old Tracked card's per-repo graph
 * fan-out RETIRED.
 */

const NOW = Date.now();

const repo = (id: string, name: string, registered_at: number): RepoEntry => ({
  id, name, root_path: `/tmp/${id}`, default_branch: 'main', registered_at,
});

const REPOS = [
  repo('studio-api', 'studio-api', 1_700_000_000),
  repo('billing', 'billing', 1_760_000_000),
];

const RUNS = [
  makeView({ id: 'r-a1', repo_ref: 'studio-api', status: 'executing', problem: 'wire uploads' }),
  makeView({ id: 'r-a2', repo_ref: 'studio-api', status: 'failed', problem: 'refactor auth' }),
  makeView({ id: 'r-b1', repo_ref: 'billing', status: 'completed', problem: 'invoice math' }),
  makeView({ id: 'r-old', repo_ref: 'billing', status: 'failed', problem: 'stale failure' }),
  makeView({ id: 'r-none', repo_ref: null, status: 'executing', problem: 'no repo' }),
  makeView({ id: 'r-unclocked', repo_ref: 'billing', status: 'executing', problem: 'no clock' }),
];

const listRepos = vi.fn(() => Promise.resolve({ repos: REPOS }));
const listRuns = vi.fn(() => Promise.resolve({ runs: RUNS }));
const getRepoGraph = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listRuns: () => listRuns(),
    getRepoGraph: (...a: unknown[]) => getRepoGraph(...a),
    listProjects: () => Promise.resolve({ projects: [] }),
  },
}));

const { RepositoriesPanel } = await import('../src/components/RepositoriesPanel.js');
const { useMembershipStore } = await import('../src/store/membership.js');

async function panel(navigate: (p: string) => void = () => {}): Promise<void> {
  render(<RepositoriesPanel navigate={navigate} />);
  await screen.findByTestId('repos-dashboard-tiles');
  await screen.findByTestId('repos-list');
}

beforeEach(() => {
  listRepos.mockClear();
  listRuns.mockClear();
  getRepoGraph.mockClear();
  useMembershipStore.setState({
    projectNameByRun: {},
    attachedAtByRun: {
      'r-a1': NOW - 3_600_000,            // studio-api, in 7d + 24h
      'r-a2': NOW - 2 * 3_600_000,        // studio-api failed, in 24h
      'r-b1': NOW - 3 * 86_400_000,       // billing, in 7d, outside 24h
      'r-old': NOW - 8 * 86_400_000,      // billing failed, OUTSIDE 7d and 24h
      // r-unclocked: no attach clock — excluded everywhere, never invented.
    },
  });
});
afterEach(() => cleanup());

describe('the tile band (§4.4, EC19/EC28)', () => {
  it('renders the three tiles with their named questions, above the register', async () => {
    await panel();
    const band = screen.getByTestId('repos-dashboard-tiles');
    const q = (tid: string): string | null =>
      band.querySelector(`[data-testid="${tid}"]`)?.getAttribute('data-question') ?? null;
    expect(q('runs-per-repo-tile')).toBe('Where is the work concentrating?');
    expect(q('repo-count-tile')).toBe('Is the estate growing?');
    expect(q('failing-repos-tile')).toBe('Is any repo a failure hotspot?');
    const list = screen.getByTestId('repos-list');
    expect(band.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('groups 7d runs by repo_ref on the attach clock, names joined via the repo list', async () => {
    await panel();
    const tile = screen.getByTestId('runs-per-repo-tile');
    // r-a1 + r-a2 + r-b1 placed; r-old (outside 7d), r-none (no ref) and
    // r-unclocked (no clock) excluded.
    expect(tile.getAttribute('data-total')).toBe('3');
    expect(tile.getAttribute('data-repos')).toBe('2');
    expect(tile.textContent).toContain('studio-api leads (2)');
  });

  it('counts the register and names the newest registration', async () => {
    await panel();
    const tile = screen.getByTestId('repo-count-tile');
    expect(tile.getAttribute('data-count')).toBe('2');
    expect(tile.textContent).toContain('2 registered');
    expect(tile.textContent).toContain('newest:');
  });

  it('flags only 24h repo-linked failures as hotspots', async () => {
    await panel();
    const tile = screen.getByTestId('failing-repos-tile');
    // r-a2 (failed, 2h ago) counts; r-old (failed, 3d ago) does not.
    expect(tile.getAttribute('data-count')).toBe('1');
    expect(tile.getAttribute('data-failures')).toBe('1');
    expect(tile.textContent).toContain('studio-api (1)');
    expect(tile.textContent).not.toContain('billing (');
  });
});

describe('the register below — affordances preserved, budget held (§4.4)', () => {
  it('keeps the register/search/add affordances and row navigation', async () => {
    const navigate = vi.fn();
    await panel(navigate);
    expect(screen.getByText('+ Add Repository')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('Search repos…'), { target: { value: 'bill' } });
    const cards = screen.getAllByTestId('repo-card');
    expect(cards).toHaveLength(1);
    expect(cards[0]!.getAttribute('data-repo-id')).toBe('billing');
    fireEvent.click(cards[0]!);
    expect(navigate).toHaveBeenCalledWith('/repo-detail/billing');
  });

  it('fires exactly the existing GET /repos + GET /runs — the graph fan-out is retired', async () => {
    await panel();
    expect(listRepos).toHaveBeenCalledTimes(1);
    expect(listRuns).toHaveBeenCalledTimes(1);
    expect(getRepoGraph).not.toHaveBeenCalled();
  });
});
