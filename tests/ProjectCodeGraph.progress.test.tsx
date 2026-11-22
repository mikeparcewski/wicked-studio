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

const { ProjectCodeGraph, resetProjectGraphBuilds, PROJECT_GRAPH_POLL_MS, PROJECT_GRAPH_IDLE_POLL_MS } = await import('../src/components/ProjectCodeGraph.js');

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

describe('following refreshes over time (studio#1099, xreview r1)', () => {
  it('a refresh crew starts after the page read idle is seen on the next idle read', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t0 = Date.now();
    getProjectGraph.mockResolvedValueOnce({ status: status({ refresh: { ...refreshing(t0), state: 'idle', repoId: null } }) });
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    await screen.findByTestId('project-graph-detail');
    expect(screen.queryByTestId('project-graph-progress')).toBeNull();
    getProjectGraph.mockResolvedValue({ status: status({ refresh: refreshing(Date.now()) }) });
    await act(async () => { vi.advanceTimersByTime(PROJECT_GRAPH_IDLE_POLL_MS); });
    expect(await screen.findByTestId('project-graph-progress')).toHaveTextContent('of its 12 min 40 s budget; indexing tiny-tip');
  });

  it('a build answered here gives way when crew reports a newer refresh that then times out', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t0 = Date.now();
    getProjectGraph.mockResolvedValueOnce({ status: status({}) });
    refreshProjectGraph.mockResolvedValueOnce(built({ status: status({ refresh: { ...refreshing(t0), state: 'idle', startedAt: t0 - 10_000, repoId: null } }) }));
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    fireEvent.click(await screen.findByTestId('project-graph-build'));
    expect(await screen.findByTestId('project-graph-result')).toHaveTextContent('Built: 2 indexed');
    const lastFailure = { at: t0 + 2_000, repoId: 'r2', label: 'tiny-tip', error: 'index timed out', timedOut: true, budgetMs: 180_000 };
    getProjectGraph.mockResolvedValue({ status: status({ refresh: { ...refreshing(t0), state: 'idle', startedAt: t0 + 1_000, repoId: null, lastFailure } }) });
    await act(async () => { vi.advanceTimersByTime(PROJECT_GRAPH_IDLE_POLL_MS); });
    expect(await screen.findByTestId('project-graph-last-failure')).toHaveTextContent('The last refresh stopped at tiny-tip: it ran past its 3 min 0 s budget');
    expect(screen.queryByTestId('project-graph-result')).toBeNull();
  });

  it('a read of the same refresh as the answer keeps the answer', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t0 = Date.now();
    const answered = { ...refreshing(t0), state: 'idle' as const, startedAt: t0 - 10_000, repoId: null };
    getProjectGraph.mockResolvedValueOnce({ status: status({}) });
    refreshProjectGraph.mockResolvedValueOnce(built({ status: status({ refresh: answered }) }));
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    fireEvent.click(await screen.findByTestId('project-graph-build'));
    await screen.findByTestId('project-graph-result');
    getProjectGraph.mockResolvedValue({ status: status({ refresh: answered }) });
    await act(async () => { vi.advanceTimersByTime(PROJECT_GRAPH_IDLE_POLL_MS); });
    await waitFor(() => expect(getProjectGraph).toHaveBeenCalledTimes(2));
    expect(screen.getByTestId('project-graph-result')).toHaveTextContent('Built: 2 indexed');
  });

  it('one read at a time: a slow progress read is waited for, then lands', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t0 = Date.now();
    getProjectGraph.mockResolvedValueOnce({ status: status({ state: 'not-indexed', action: 'projects.graph.refresh' }) });
    refreshProjectGraph.mockImplementation(() => new Promise<ProjectGraphRefreshResult>(() => undefined));
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    fireEvent.click(await screen.findByTestId('project-graph-build'));
    let slow: (v: { status: ProjectGraphStatus }) => void = () => undefined;
    getProjectGraph.mockImplementationOnce(() => new Promise((done) => { slow = done; }));
    await act(async () => { vi.advanceTimersByTime(PROJECT_GRAPH_POLL_MS); });
    await waitFor(() => expect(getProjectGraph).toHaveBeenCalledTimes(2));
    await act(async () => { vi.advanceTimersByTime(PROJECT_GRAPH_POLL_MS * 3); });
    expect(getProjectGraph).toHaveBeenCalledTimes(2);
    await act(async () => { slow({ status: status({ refresh: refreshing(t0) }) }); });
    expect(await screen.findByTestId('project-graph-progress')).toHaveTextContent('indexing tiny-tip');
  });

  it('a build refused after progress was shown stops counting and says only the refusal', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t0 = Date.now();
    getProjectGraph.mockResolvedValueOnce({ status: status({ state: 'not-indexed', action: 'projects.graph.refresh' }) });
    let fail: (e: Error) => void = () => undefined;
    refreshProjectGraph.mockImplementation(() => new Promise<ProjectGraphRefreshResult>((_d, reject) => { fail = reject; }));
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    fireEvent.click(await screen.findByTestId('project-graph-build'));
    getProjectGraph.mockResolvedValueOnce({ status: status({ state: 'not-indexed', refresh: refreshing(t0) }) });
    await act(async () => { vi.advanceTimersByTime(PROJECT_GRAPH_POLL_MS); });
    await screen.findByTestId('project-graph-progress');
    const lastFailure = { at: t0, repoId: 'r2', label: 'tiny-tip', error: 'estate exited 2', timedOut: false, budgetMs: null };
    getProjectGraph.mockResolvedValue({ status: status({ state: 'not-indexed', action: 'projects.graph.refresh', refresh: { ...refreshing(t0), state: 'idle', repoId: null, lastFailure } }) });
    await act(async () => { fail(new Error('502 bad gateway')); });
    expect(await screen.findByTestId('project-graph-build-error')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('project-graph-progress')).toBeNull());
    // The refusal speaks for that refresh: crew's record of the same refresh does not repeat it.
    expect(screen.queryByTestId('project-graph-last-failure')).toBeNull();
    // (xreview r2) crew then runs another refresh, which times out: that is said, and the old refusal gives way.
    const later = { at: t0 + 2_000, repoId: 'r2', label: 'tiny-tip', error: 'index timed out', timedOut: true, budgetMs: 180_000 };
    getProjectGraph.mockResolvedValue({ status: status({ refresh: { ...refreshing(t0), state: 'idle', startedAt: t0 + 1_000, repoId: null, lastFailure: later } }) });
    await act(async () => { vi.advanceTimersByTime(PROJECT_GRAPH_IDLE_POLL_MS); });
    expect(await screen.findByTestId('project-graph-last-failure')).toHaveTextContent('The last refresh stopped at tiny-tip');
    expect(screen.queryByTestId('project-graph-build-error')).toBeNull();
  });

  it('a slow first read is waited for: a timed read joins it instead of starting another', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let first: (v: { status: ProjectGraphStatus }) => void = () => undefined;
    getProjectGraph.mockImplementationOnce(() => new Promise((done) => { first = done; }));
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    await waitFor(() => expect(getProjectGraph).toHaveBeenCalledTimes(1));
    await act(async () => { vi.advanceTimersByTime(PROJECT_GRAPH_IDLE_POLL_MS * 2); });
    expect(getProjectGraph).toHaveBeenCalledTimes(1);
    await act(async () => { first({ status: status({ detail: 'the slow answer' }) }); });
    expect(await screen.findByTestId('project-graph-detail')).toHaveTextContent('the slow answer');
  });

  it('a progress read that fails during a build says so and stops showing progress; the next answer brings it back', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const t0 = Date.now();
    getProjectGraph.mockResolvedValueOnce({ status: status({ state: 'not-indexed', action: 'projects.graph.refresh' }) });
    refreshProjectGraph.mockImplementation(() => new Promise<ProjectGraphRefreshResult>(() => undefined));
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    fireEvent.click(await screen.findByTestId('project-graph-build'));
    getProjectGraph.mockResolvedValueOnce({ status: status({ refresh: refreshing(t0) }) });
    await act(async () => { vi.advanceTimersByTime(PROJECT_GRAPH_POLL_MS); });
    await screen.findByTestId('project-graph-progress');
    getProjectGraph.mockRejectedValueOnce(new Error('503 daemon busy'));
    await act(async () => { vi.advanceTimersByTime(PROJECT_GRAPH_POLL_MS); });
    expect(await screen.findByTestId('project-graph-read-error')).toBeInTheDocument();
    expect(screen.queryByTestId('project-graph-progress')).toBeNull();
    getProjectGraph.mockResolvedValueOnce({ status: status({ refresh: refreshing(t0) }) });
    await act(async () => { vi.advanceTimersByTime(PROJECT_GRAPH_POLL_MS); });
    expect(await screen.findByTestId('project-graph-progress')).toBeInTheDocument();
    expect(screen.queryByTestId('project-graph-read-error')).toBeNull();
  });

  it('coming back to a build still running shows its progress from the first read', async () => {
    const t0 = Date.now();
    getProjectGraph.mockResolvedValue({ status: status({ state: 'not-indexed', action: 'projects.graph.refresh' }) });
    refreshProjectGraph.mockImplementation(() => new Promise<ProjectGraphRefreshResult>(() => undefined));
    const first = render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    fireEvent.click(await screen.findByTestId('project-graph-build'));
    first.unmount();
    getProjectGraph.mockResolvedValue({ status: status({ refresh: refreshing(t0) }) });
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    expect(await screen.findByTestId('project-graph-progress')).toHaveTextContent('indexing tiny-tip');
  });

  it('tolerates the rows crew may leave short: a timed-out row with no budget, an idle refresh with no start', async () => {
    const line = await buildWith(built({
      indexed: ['svc-a'],
      failed: [{ repoId: 'r2', label: 'tiny-tip', error: 'timed out' }],
      repos: [{ repoId: 'r2', label: 'tiny-tip', action: 'failed', error: 'timed out', timedOut: true, budget: null as never }],
    }));
    expect(line).toHaveTextContent('(1 ran past its time budget)');
    expect(screen.getByTestId('tech-details')).toHaveTextContent('tiny-tip: ran past its time budget and was stopped.');
    cleanup();
    resetProjectGraphBuilds();
    const lastFailure = { at: Date.now() - 300_000, repoId: 'r2', label: '', error: 'x', timedOut: false, budgetMs: null };
    getProjectGraph.mockReset().mockResolvedValue({ status: status({ refresh: { state: 'idle', startedAt: null as never, finishedAt: null, budgetMs: null, repoId: null, repoStartedAt: null, repoBudgetMs: null, lastFailure } }) });
    render(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    expect(await screen.findByTestId('project-graph-last-failure')).toHaveTextContent('The last refresh failed at tiny-tip (5 minutes ago).');
  });
});
