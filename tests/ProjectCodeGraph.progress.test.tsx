import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProjectGraphRefreshResult, ProjectGraphRefreshState, ProjectGraphStatus } from '../src/api/types.js';

/**
 * studio#1104: a build whose cross-repo link step failed (or left members incomplete) published no new links, so it
 * never reads "Built". studio#1099: a running refresh shows its time against its budget and the member being indexed;
 * between refreshes, the last failure (a timeout names the budget it hit).
 */

const getProjectGraph = vi.fn();
const refreshProjectGraph = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    getProjectGraph: (...a: unknown[]) => getProjectGraph(...a),
    refreshProjectGraph: (...a: unknown[]) => refreshProjectGraph(...a),
  },
}));

const { ProjectCodeGraph, resetProjectGraphBuilds, PROJECT_GRAPH_POLL_MS } = await import('../src/components/ProjectCodeGraph.js');

const REPOS = [
  { repoId: 'r1', label: 'svc-a', rootPath: '/src/svc-a', indexed: true },
  { repoId: 'r2', label: 'tiny-tip', rootPath: '/src/tiny-tip', indexed: true },
] as ProjectGraphStatus['repos'];

function status(over: Partial<ProjectGraphStatus>): ProjectGraphStatus {
  return {
    projectId: 'proj-1', state: 'ready', detail: 'Built from 2 repositories.',
    dbPath: null, repos: REPOS, missingRepos: [], staleRepos: [],
    linkage: {} as ProjectGraphStatus['linkage'], note: '', updatedAt: null,
    ...over,
  };
}

function refreshing(t0: number, over: Partial<ProjectGraphRefreshState> = {}): ProjectGraphRefreshState {
  return {
    state: 'refreshing', startedAt: t0 - 240_000, finishedAt: null, budgetMs: 760_000,
    repoId: 'r2', repoStartedAt: t0 - 62_000, repoBudgetMs: 180_000, lastFailure: null, ...over,
  };
}

function built(over: Partial<ProjectGraphRefreshResult>): ProjectGraphRefreshResult {
  return { status: status({}), indexed: ['svc-a', 'tiny-tip'], skipped: [], failed: [], ...over };
}

beforeEach(() => {
  resetProjectGraphBuilds();
  getProjectGraph.mockReset();
  refreshProjectGraph.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

async function buildWith(answer: ProjectGraphRefreshResult): Promise<HTMLElement> {
  getProjectGraph.mockResolvedValue({ status: status({}) });
  refreshProjectGraph.mockResolvedValueOnce(answer);
  render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
  fireEvent.click(await screen.findByTestId('project-graph-build'));
  return screen.findByTestId('project-graph-result');
}

describe('a build whose cross-repo links were not rebuilt (studio#1104)', () => {
  it('a link error never reads "Built": it says the links were not rebuilt, with the error in the details', async () => {
    const line = await buildWith(built({ link: { error: 'link exited 2' } }));
    expect(line).toHaveAttribute('data-link', 'failed');
    expect(line.textContent).not.toMatch(/Built|Start a new chat/);
    expect(line).toHaveTextContent('Indexed: 2 indexed, 0 already up to date, but the cross-repo links weren’t rebuilt; answers keep the links from the last build.');
    expect(screen.getByTestId('tech-details')).toHaveTextContent('cross-repo links: link exited 2');
  });

  it('incomplete members never read "Built", and are named', async () => {
    const line = await buildWith(built({ link: { generation: 4, incomplete: ['tiny-tip'] } }));
    expect(line).toHaveAttribute('data-link', 'failed');
    expect(line.textContent).not.toMatch(/Built|Start a new chat/);
    expect(line).toHaveTextContent('(incomplete: tiny-tip)');
    expect(screen.getByTestId('tech-details')).toHaveTextContent('cross-repo links incomplete for: tiny-tip');
  });

  it('a link step that published still reads "Built"', async () => {
    const line = await buildWith(built({ link: { generation: 4, links: 12, incomplete: [] } }));
    expect(line).toHaveAttribute('data-link', 'ok');
    expect(line).toHaveTextContent('Built: 2 indexed, 0 already up to date. Start a new chat to use it.');
  });

  it('a failed repository and a failed link are both said', async () => {
    const line = await buildWith(built({ indexed: ['svc-a'], failed: [{ repoId: 'r2', label: 'tiny-tip', error: 'estate exited 2' }], link: { error: 'link exited 2' } }));
    expect(line).toHaveTextContent('1 repository couldn’t be indexed; the graph keeps what it had. Also, the cross-repo links weren’t rebuilt');
  });

  it('a repository stopped at its budget says so (studio#1099)', async () => {
    const line = await buildWith(built({
      indexed: ['svc-a'],
      failed: [{ repoId: 'r2', label: 'tiny-tip', error: 'wicked-estate index timed out' }],
      repos: [{ repoId: 'r2', label: 'tiny-tip', action: 'failed', error: 'wicked-estate index timed out', timedOut: true, budget: { budgetMs: 180_000, trackedFiles: 500 } }],
    }));
    expect(line).toHaveTextContent('1 repository couldn’t be indexed (1 ran past its time budget); the graph keeps what it had.');
    expect(screen.getByTestId('tech-details')).toHaveTextContent('tiny-tip: ran past its 3 min 0 s budget and was stopped.');
  });
});

describe('a running refresh and the last failure (studio#1099)', () => {
  it('a refresh crew is running shows its time against the budget and the member being indexed', async () => {
    const t0 = Date.now();
    getProjectGraph.mockResolvedValue({ status: status({ refresh: refreshing(t0) }) });
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    expect(await screen.findByTestId('project-graph-progress'))
      .toHaveTextContent('Running for 4 min 0 s of its 12 min 40 s budget; indexing tiny-tip (1 min 2 s of 3 min 0 s).');
  });

  it('with no budget sized yet it says the time so far', async () => {
    const t0 = Date.now();
    getProjectGraph.mockResolvedValue({ status: status({ refresh: refreshing(t0, { budgetMs: null, repoId: null, repoStartedAt: null, repoBudgetMs: null }) }) });
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    expect(await screen.findByTestId('project-graph-progress')).toHaveTextContent('Running for 4 min 0 s so far.');
  });

  it('during this page\'s build, a progress read shows the budget and never moves the standing; the answer ends it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t0 = Date.now();
    getProjectGraph.mockResolvedValueOnce({ status: status({ state: 'not-indexed', detail: 'Not built yet.', action: 'projects.graph.refresh' }) });
    let finish: (r: ProjectGraphRefreshResult) => void = () => undefined;
    refreshProjectGraph.mockImplementation(() => new Promise<ProjectGraphRefreshResult>((done) => { finish = done; }));
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    fireEvent.click(await screen.findByTestId('project-graph-build'));
    expect(screen.queryByTestId('project-graph-progress')).toBeNull();
    getProjectGraph.mockResolvedValue({ status: status({ state: 'ready', detail: 'progress read standing', refresh: refreshing(t0) }) });
    await act(async () => { vi.advanceTimersByTime(PROJECT_GRAPH_POLL_MS); });
    expect(await screen.findByTestId('project-graph-progress')).toHaveTextContent('of its 12 min 40 s budget; indexing tiny-tip');
    // The progress read took only the refresh: the standing is the one read before the build.
    expect(screen.getByTestId('project-graph')).toHaveAttribute('data-state', 'not-indexed');
    expect(screen.getByTestId('project-graph-detail')).toHaveTextContent('Not built yet.');
    finish(built({ status: status({ refresh: { ...refreshing(t0), state: 'idle', finishedAt: t0, repoId: null } }) }));
    expect(await screen.findByTestId('project-graph-result')).toHaveTextContent('Built: 2 indexed');
    expect(screen.queryByTestId('project-graph-progress')).toBeNull();
  });

  it('between refreshes, a timeout names the member and the budget it hit, with the error in the details', async () => {
    const t0 = Date.now();
    const lastFailure = { at: t0 - 300_000, repoId: 'r2', label: 'tiny-tip', error: 'wicked-estate index timed out after 760000 ms', timedOut: true, budgetMs: 760_000 };
    getProjectGraph.mockResolvedValue({ status: status({ refresh: { ...refreshing(t0), state: 'idle', finishedAt: t0 - 300_000, repoId: null, lastFailure } }) });
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    const line = await screen.findByTestId('project-graph-last-failure');
    expect(line).toHaveAttribute('data-timed-out', 'true');
    expect(line).toHaveTextContent('The last refresh stopped at tiny-tip: it ran past its 12 min 40 s budget (5 minutes ago). The graph keeps what it had.');
    expect(screen.getByTestId('tech-details')).toHaveTextContent('wicked-estate index timed out after 760000 ms');
    expect(screen.queryByTestId('project-graph-progress')).toBeNull();
  });

  it('a failure that was not a timeout says the refresh failed', async () => {
    const t0 = Date.now();
    const lastFailure = { at: t0 - 300_000, repoId: null, label: null, error: 'estate db locked', timedOut: false, budgetMs: null };
    getProjectGraph.mockResolvedValue({ status: status({ refresh: { ...refreshing(t0), state: 'idle', repoId: null, lastFailure } }) });
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    expect(await screen.findByTestId('project-graph-last-failure')).toHaveTextContent('The last refresh failed (5 minutes ago). The graph keeps what it had.');
  });

  it('an older crew (no refresh) shows neither line', async () => {
    getProjectGraph.mockResolvedValue({ status: status({}) });
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    await screen.findByTestId('project-graph-detail');
    await waitFor(() => expect(screen.queryByTestId('project-graph-progress')).toBeNull());
    expect(screen.queryByTestId('project-graph-last-failure')).toBeNull();
  });
});
