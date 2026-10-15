import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectGraphRefreshResult, ProjectGraphStatus } from '../src/api/types.js';

/**
 * studio#802 — crew's chat scope says "build it from the project page" (`graph.action:
 * 'projects.graph.refresh'`), and nothing in studio called `POST /projects/:id/graph/refresh`.
 * The project's Repositories section now carries the control.
 */

const getProjectGraph = vi.fn();
const refreshProjectGraph = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    getProjectGraph: (...a: unknown[]) => getProjectGraph(...a),
    refreshProjectGraph: (...a: unknown[]) => refreshProjectGraph(...a),
  },
}));

const { ProjectCodeGraph, resetProjectGraphBuilds } = await import('../src/components/ProjectCodeGraph.js');

function status(over: Partial<ProjectGraphStatus>): ProjectGraphStatus {
  return {
    projectId: 'proj-1', state: 'not-indexed', detail: 'This project’s code graph has not been built yet.',
    dbPath: null, repos: [], missingRepos: [], staleRepos: [],
    linkage: {} as ProjectGraphStatus['linkage'], note: '', updatedAt: null,
    ...over,
  };
}

beforeEach(() => {
  resetProjectGraphBuilds();
  getProjectGraph.mockReset();
  refreshProjectGraph.mockReset();
});
afterEach(cleanup);

describe('ProjectCodeGraph (studio#802)', () => {
  it('a project whose graph is not built offers Build code graph; building posts the refresh and shows the built status', async () => {
    getProjectGraph.mockResolvedValue({ status: status({ action: 'projects.graph.refresh' }) });
    let finish: (r: ProjectGraphRefreshResult) => void = () => undefined;
    refreshProjectGraph.mockImplementation(() => new Promise<ProjectGraphRefreshResult>((done) => { finish = done; }));
    render(<ProjectCodeGraph projectId="proj-1" repoCount={1} />);
    const button = await screen.findByTestId('project-graph-build');
    expect(button).toHaveTextContent('Build code graph');
    expect(screen.getByTestId('project-graph-detail')).toHaveTextContent('has not been built yet');
    fireEvent.click(button);
    await waitFor(() => expect(refreshProjectGraph).toHaveBeenCalledWith('proj-1'));
    expect(screen.getByTestId('project-graph-build')).toBeDisabled();
    expect(screen.getByTestId('project-graph-build')).toHaveTextContent('Building the code graph…');
    expect(screen.getByTestId('project-graph-live')).toHaveAttribute('role', 'status');
    expect(screen.getByTestId('project-graph-live')).toHaveTextContent('Building the code graph.');
    finish({ status: status({ state: 'ready-single-repo', detail: 'Built from 1 repository.' }), indexed: ['tiny-tip'], skipped: [], failed: [] });
    await waitFor(() => expect(screen.getByTestId('project-graph')).toHaveAttribute('data-state', 'ready-single-repo'));
    expect(screen.getByTestId('project-graph-detail')).toHaveTextContent('Built from 1 repository.');
    expect(screen.getByTestId('project-graph-result')).toHaveTextContent('1 indexed');
    expect(screen.getByTestId('project-graph-build')).toHaveTextContent('Refresh code graph');
  });

  it('a failed repository is named, and a refused build says so', async () => {
    getProjectGraph.mockResolvedValue({ status: status({ action: 'projects.graph.refresh' }) });
    refreshProjectGraph.mockResolvedValueOnce({ status: status({ action: 'projects.graph.refresh' }), indexed: [], skipped: [], failed: [{ repoId: 'r1', label: 'tiny-tip', error: 'estate exited 2' }] });
    render(<ProjectCodeGraph projectId="proj-1" repoCount={1} />);
    fireEvent.click(await screen.findByTestId('project-graph-build'));
    expect(await screen.findByTestId('project-graph-result')).toHaveAttribute('data-failed', '1');
    refreshProjectGraph.mockRejectedValueOnce(new Error('501 engine too old'));
    fireEvent.click(screen.getByTestId('project-graph-build'));
    expect(await screen.findByTestId('project-graph-build-error')).toHaveTextContent('couldn’t be built');
  });

  it('no button when crew names no action for an unbuilt graph', async () => {
    getProjectGraph.mockResolvedValue({ status: status({ state: 'no-repo-members', detail: 'Attach a repository first.' }) });
    render(<ProjectCodeGraph projectId="proj-1" repoCount={1} />);
    expect(await screen.findByTestId('project-graph-detail')).toHaveTextContent('Attach a repository first.');
    expect(screen.queryByTestId('project-graph-build')).toBeNull();
  });

  it('re-reads the standing when the repository count changes', async () => {
    getProjectGraph.mockResolvedValue({ status: status({ action: 'projects.graph.refresh' }) });
    const { rerender } = render(<ProjectCodeGraph projectId="proj-1" repoCount={1} />);
    await screen.findByTestId('project-graph-build');
    rerender(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    await waitFor(() => expect(getProjectGraph).toHaveBeenCalledTimes(2));
  });

  it('a status read that started before the build answered never overwrites it (codex r1)', async () => {
    getProjectGraph.mockResolvedValueOnce({ status: status({ action: 'projects.graph.refresh' }) });
    let lateRead: (v: { status: ProjectGraphStatus }) => void = () => undefined;
    let finish: (r: ProjectGraphRefreshResult) => void = () => undefined;
    refreshProjectGraph.mockImplementation(() => new Promise<ProjectGraphRefreshResult>((done) => { finish = done; }));
    const { rerender } = render(<ProjectCodeGraph projectId="proj-1" repoCount={1} />);
    fireEvent.click(await screen.findByTestId('project-graph-build'));
    getProjectGraph.mockImplementationOnce(() => new Promise((done) => { lateRead = done; }));
    rerender(<ProjectCodeGraph projectId="proj-1" repoCount={2} />);
    await waitFor(() => expect(getProjectGraph).toHaveBeenCalledTimes(2));
    finish({ status: status({ state: 'ready-single-repo', detail: 'Built.' }), indexed: ['tiny-tip'], skipped: [], failed: [] });
    await waitFor(() => expect(screen.getByTestId('project-graph')).toHaveAttribute('data-state', 'ready-single-repo'));
    lateRead({ status: status({ action: 'projects.graph.refresh', detail: 'stale: not built' }) });
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('project-graph')).toHaveAttribute('data-state', 'ready-single-repo');
    expect(screen.getByTestId('project-graph-detail')).toHaveTextContent('Built.');
  });

  it('leaving and coming back re-attaches to the build still running; no second build starts (codex r1)', async () => {
    getProjectGraph.mockResolvedValue({ status: status({ action: 'projects.graph.refresh' }) });
    let finish: (r: ProjectGraphRefreshResult) => void = () => undefined;
    refreshProjectGraph.mockImplementation(() => new Promise<ProjectGraphRefreshResult>((done) => { finish = done; }));
    const first = render(<ProjectCodeGraph projectId="proj-1" repoCount={1} />);
    fireEvent.click(await screen.findByTestId('project-graph-build'));
    first.unmount();
    render(<ProjectCodeGraph projectId="proj-1" repoCount={1} />);
    const again = await screen.findByTestId('project-graph-build');
    expect(again).toBeDisabled();
    fireEvent.click(again);
    expect(refreshProjectGraph).toHaveBeenCalledTimes(1);
    finish({ status: status({ state: 'ready-single-repo', detail: 'Built.' }), indexed: ['tiny-tip'], skipped: [], failed: [] });
    expect(await screen.findByTestId('project-graph-result')).toHaveTextContent('1 indexed');
  });

  it('a failed status read can be retried', async () => {
    getProjectGraph.mockRejectedValueOnce(new Error('503 daemon busy'));
    getProjectGraph.mockResolvedValueOnce({ status: status({ action: 'projects.graph.refresh' }) });
    render(<ProjectCodeGraph projectId="proj-1" repoCount={1} />);
    expect(await screen.findByTestId('project-graph-read-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('project-graph-read-retry'));
    expect(await screen.findByTestId('project-graph-build')).toHaveTextContent('Build code graph');
  });
});
