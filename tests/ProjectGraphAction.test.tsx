import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../src/api/errors.js';
import type { ProjectGraphRefreshResult, ProjectGraphStatus } from '../src/api/types.js';

/**
 * F-2R2-008 (studio half) — "Build project graph": the one control that calls crew's
 * existing `POST /projects/:id/graph/refresh`, with honest pending / ready / failed state,
 * and the customer copy for the daemon's graph reason (no raw POST, "repo-less" only when
 * the scope names no repository).
 */

const getProjectGraph = vi.fn();
const refreshProjectGraph = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    getProjectGraph: (...a: unknown[]) => getProjectGraph(...a),
    refreshProjectGraph: (...a: unknown[]) => refreshProjectGraph(...a),
  },
}));

const { ProjectGraphAction, describeGraphStatus, humanizeGraphReason, reasonWantsProjectGraph } =
  await import('../src/components/ProjectGraphAction.js');

const PID = 'proj_178902523421000000';
const RAW_REASON =
  `Project ${PID} has 9 repo member(s) but no code graph yet. Build it with POST /api/v1/projects/${PID}/graph/refresh. This repo-less run gets no code graph.`;

function status(state: ProjectGraphStatus['state'], indexed = 0): ProjectGraphStatus {
  return {
    projectId: PID, state, detail: state === 'not-indexed' ? RAW_REASON : 'ok', dbPath: null,
    repos: Array.from({ length: 9 }, (_, i) => ({ repoId: `r${i}`, label: `repo-${i}`, rootPath: `/w5/repos/r${i}`, indexed: i < indexed })),
    missingRepos: [], staleRepos: [], linkage: 'none' as never, note: '', updatedAt: state === 'ready' ? 1_757_300_000_000 : null,
  };
}

function result(indexed: string[], failed: ProjectGraphRefreshResult['failed'] = []): ProjectGraphRefreshResult {
  return { status: status('ready', 9), indexed, skipped: [], failed };
}

beforeEach(() => {
  getProjectGraph.mockReset();
  refreshProjectGraph.mockReset();
});
afterEach(cleanup);

describe('the customer copy (humanizeGraphReason)', () => {
  it('drops the raw POST sentence, says "repo-less" only over an empty scope, keeps the daemon\'s words', () => {
    expect(humanizeGraphReason(RAW_REASON, 9)).toBe(`Project ${PID} has 9 repo member(s) but no code graph yet.`);
    expect(humanizeGraphReason(RAW_REASON, 9)).not.toMatch(/POST|repo-less/);
    expect(humanizeGraphReason('the project graph has never been built. POST /api/v1/projects/auth-refactor/graph/refresh fixes it.', 1))
      .toBe('the project graph has never been built.');
    expect(humanizeGraphReason("'billing' has no resolvable code graph (not indexed yet — onboard the repo); this chat gets none.", 1))
      .toBe("'billing' has no resolvable code graph (not indexed yet — onboard the repo); this chat gets none.");
    // A genuinely repo-less scope keeps the sentence; an empty remainder still says something true.
    expect(humanizeGraphReason('This repo-less run gets no code graph.', 0)).toBe('This repo-less run gets no code graph.');
    expect(humanizeGraphReason('Build it with POST /api/v1/projects/x/graph/refresh.', 3)).toBe('the project graph has not been built yet');
    expect(reasonWantsProjectGraph(RAW_REASON)).toBe(true);
    expect(reasonWantsProjectGraph("'billing' has no resolvable code graph (not indexed yet — onboard the repo)")).toBe(false);
  });

  it('describes the graph\'s standing in words', () => {
    expect(describeGraphStatus(status('not-indexed'))).toBe('not built — the seats read files, not a code graph');
    expect(describeGraphStatus(status('ready', 9), 1_757_300_000_000 + 7_200_000)).toContain('ready · 9 repositories indexed · refreshed');
    expect(describeGraphStatus({ ...status('no-repo-members'), repos: [] })).toBe('no repositories attached — nothing to index');
  });
});

describe('the control (row variant, with the standing read)', () => {
  it('reads GET /projects/:id/graph on mount, offers Build, shows the synchronous wait, then the daemon\'s result', async () => {
    getProjectGraph.mockResolvedValue({ status: status('not-indexed') });
    let release: (v: ProjectGraphRefreshResult) => void = () => {};
    refreshProjectGraph.mockImplementation(() => new Promise<ProjectGraphRefreshResult>((res) => { release = res; }));
    render(<ProjectGraphAction projectId={PID} variant="row" repoCount={9} fetchStatus />);
    await waitFor(() => expect(getProjectGraph).toHaveBeenCalledWith(PID));
    const root = await screen.findByTestId('project-graph');
    await waitFor(() => expect(root).toHaveAttribute('data-state', 'not-indexed'));
    expect(screen.getByTestId('project-graph-state').textContent).toContain('not built');
    const build = screen.getByTestId('project-graph-build');
    expect(build.textContent).toBe('Build project graph');

    fireEvent.click(build);
    expect(refreshProjectGraph).toHaveBeenCalledWith(PID);
    expect(screen.getByTestId('project-graph-build')).toBeDisabled();
    expect(screen.getByTestId('project-graph-build').textContent).toContain('indexing 9 repositories');
    expect(root).toHaveAttribute('data-build', 'building');

    await act(async () => { release(result(['repo-0', 'repo-1'])); });
    await waitFor(() => expect(root).toHaveAttribute('data-build', 'built'));
    expect(screen.getByTestId('project-graph-result').textContent).toContain('project graph ready — 2 indexed');
    expect(screen.getByTestId('project-graph-state').textContent).toContain('ready · 9 repositories indexed');
    expect(screen.getByTestId('project-graph-build').textContent).toBe('Refresh project graph');
  });

  it('a build with failures says so, per repo; a refused build renders the daemon\'s sentence', async () => {
    getProjectGraph.mockResolvedValue({ status: status('not-indexed') });
    refreshProjectGraph.mockResolvedValueOnce(result(['repo-0'], [{ repoId: 'r1', label: 'repo-1', error: 'index timed out' }]));
    render(<ProjectGraphAction projectId={PID} variant="row" fetchStatus />);
    fireEvent.click(await screen.findByTestId('project-graph-build'));
    const res = await screen.findByTestId('project-graph-result');
    expect(res.textContent).toContain('built with failures — 1 indexed, 1 failed: repo-1 (index timed out)');

    refreshProjectGraph.mockRejectedValueOnce(new ApiError(501, 'the installed engine predates project graphs'));
    fireEvent.click(screen.getByTestId('project-graph-build'));
    const err = await screen.findByTestId('project-graph-error');
    expect(err.textContent).toContain('not built — the daemon refused this — the installed engine predates project graphs');
  });

  it('renders nothing on a daemon without the route, and nothing — with NO read — for the Unfiled project', async () => {
    getProjectGraph.mockRejectedValue(new ApiError(404, 'Not Found'));
    render(<ProjectGraphAction projectId={PID} variant="row" fetchStatus />);
    await waitFor(() => expect(getProjectGraph).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByTestId('project-graph')).toBeNull());
    cleanup();
    getProjectGraph.mockClear();
    render(<ProjectGraphAction projectId="default" variant="row" fetchStatus />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('project-graph')).toBeNull();
    expect(getProjectGraph).not.toHaveBeenCalled(); // the synthesized project pays no request it would ignore
  });

  it('a per-repo index error is one line on the result (first line, capped) with the whole text on hover', async () => {
    getProjectGraph.mockResolvedValue({ status: status('not-indexed') });
    const long = `estate index failed: ${'x'.repeat(200)}\nsecond line with /w5/state/paths`;
    refreshProjectGraph.mockResolvedValueOnce(result(['repo-0'], [{ repoId: 'r1', label: 'repo-1', error: long }]));
    render(<ProjectGraphAction projectId={PID} variant="row" fetchStatus />);
    fireEvent.click(await screen.findByTestId('project-graph-build'));
    const res = await screen.findByTestId('project-graph-result');
    expect(res.textContent).not.toContain('second line');
    expect(res.textContent!.length).toBeLessThan(long.length);
    expect(res.textContent).toMatch(/…\)/);
    expect(res.getAttribute('title')).toContain('second line with /w5/state/paths');
  });
});

describe('the inline variant (the chat scope card)', () => {
  it('reads nothing on mount, builds on click, and says what the build grounds', async () => {
    refreshProjectGraph.mockResolvedValue(result(['repo-0']));
    render(<ProjectGraphAction projectId={PID} variant="inline" repoCount={9} builtNote="new chats in this project ground on it" />);
    expect(getProjectGraph).not.toHaveBeenCalled();
    expect(screen.queryByTestId('project-graph-state')).toBeNull();
    fireEvent.click(screen.getByTestId('project-graph-build'));
    const res = await screen.findByTestId('project-graph-result');
    expect(res.textContent).toContain('new chats in this project ground on it');
  });
});
