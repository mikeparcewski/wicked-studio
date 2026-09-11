import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Project, ProjectMember } from '../src/api/types.js';

/**
 * F-2R2-008 on the project page: a project with repository members shows its graph's
 * standing (`GET /projects/:id/graph`) and the Build control; a project without members
 * reads nothing and shows nothing; a daemon without the route shows nothing loud.
 */

const listProjectMembers = vi.fn();
const getProjectGraph = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => Promise.resolve({ projects: [] }),
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
    confirmGate: () => Promise.resolve({}),
    listRepos: () => Promise.resolve({ repos: [] }),
    getProjectGraph: (...a: unknown[]) => getProjectGraph(...a),
    refreshProjectGraph: () => Promise.reject(new Error('not in this suite')),
  },
}));

vi.mock('../src/api/interactive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/interactive.js')>()),
  listDocs: () => Promise.resolve([]),
}));

const { ProjectDashboard } = await import('../src/components/ProjectDashboard.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');

const NOW = 1_757_300_000_000;
const PROJECT: Project = {
  id: 'proj-1', name: 'The proj-1 project', description: null, status: 'active',
  scope: 'project:proj-1', created_at: NOW - 1000, updated_at: NOW - 1000,
};

function member(ref: string): ProjectMember {
  return {
    id: `proj-1:crew.repo:${ref}`, project_id: 'proj-1', member_kind: 'crew.repo',
    member_ref: ref, meta: null, attached_at: NOW - 2000, attached_by: 'studio',
  };
}

beforeEach(() => {
  clearRepoCache();
  listProjectMembers.mockReset();
  getProjectGraph.mockReset();
  useProjectsStore.setState({ projects: [PROJECT], loading: false, error: null });
});
afterEach(cleanup);

describe('the project page\'s graph standing (F-2R2-008)', () => {
  it('with repo members: reads the standing once and offers Build project graph when it is not built', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('wicked-studio'), member('wicked-core')] });
    getProjectGraph.mockResolvedValue({
      status: {
        projectId: 'proj-1', state: 'not-indexed',
        detail: 'Project proj-1 has 2 repo member(s) but no code graph yet. Build it with POST /api/v1/projects/proj-1/graph/refresh.',
        dbPath: null, repos: [], missingRepos: ['wicked-studio', 'wicked-core'], staleRepos: [], linkage: 'none', note: '', updatedAt: null,
      },
    });
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);
    await waitFor(() => expect(getProjectGraph).toHaveBeenCalledWith('proj-1'));
    const graph = await screen.findByTestId('project-graph');
    await waitFor(() => expect(graph).toHaveAttribute('data-state', 'not-indexed'));
    expect(screen.getByTestId('project-graph-state').textContent).toContain('not built');
    expect(screen.getByTestId('project-graph-state').textContent).not.toContain('POST');
    expect(screen.getByTestId('project-graph-build').textContent).toBe('Build project graph');
    expect(getProjectGraph).toHaveBeenCalledTimes(1);
  });

  it('without repo members: no read, no control', async () => {
    listProjectMembers.mockResolvedValue({ members: [] });
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);
    await waitFor(() => expect(listProjectMembers).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 10));
    expect(getProjectGraph).not.toHaveBeenCalled();
    expect(screen.queryByTestId('project-graph')).toBeNull();
  });
});
