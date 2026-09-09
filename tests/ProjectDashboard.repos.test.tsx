import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Project, ProjectMember, RepoEntry } from '../src/api/types.js';

/**
 * studio#207 on the LIVE project surface: `/projects/:id` redirects onto `/p/:id`
 * (useLegacyRedirect §1.5), so the dashboard is where an operator actually lands
 * after creating a project. The Repositories section mounts here too, and it
 * shares the dashboard's one membership read: an attach from the section shows
 * up in the header's bound-repo chips without a second fetch.
 */

const listProjectMembers = vi.fn();
const listRepos = vi.fn();
const attachProjectMember = vi.fn();
const detachProjectMember = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    listProjects: () => Promise.resolve({ projects: [] }),
    listProjectMembers: (...a: unknown[]) => listProjectMembers(...a),
    confirmGate: () => Promise.resolve({}),
    listRepos: (...a: unknown[]) => listRepos(...a),
    attachProjectMember: (...a: unknown[]) => attachProjectMember(...a),
    detachProjectMember: (...a: unknown[]) => detachProjectMember(...a),
  },
}));

vi.mock('../src/api/interactive.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api/interactive.js')>()),
  listDocs: () => Promise.resolve([]),
}));

const { ProjectDashboard } = await import('../src/components/ProjectDashboard.js');
const { useProjectsStore } = await import('../src/store/projects.js');
const { useGateStore } = await import('../src/store/gates.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');

const NOW = 1_757_300_000_000;

const PROJECT: Project = {
  id: 'proj-1', name: 'The proj-1 project', description: null, status: 'active',
  scope: 'project:proj-1', created_at: NOW - 1000, updated_at: NOW - 1000,
};

function member(ref: string, kind = 'crew.repo'): ProjectMember {
  return {
    id: `proj-1:${kind}:${ref}`, project_id: 'proj-1', member_kind: kind,
    member_ref: ref, meta: null, attached_at: NOW - 2000, attached_by: 'studio',
  };
}

function repo(id: string): RepoEntry {
  return { id, name: id, root_path: `/repos/${id}`, default_branch: 'main', registered_at: 1 };
}

beforeEach(() => {
  clearRepoCache();
  for (const m of [listProjectMembers, listRepos, attachProjectMember, detachProjectMember]) m.mockReset();
  listProjectMembers.mockResolvedValue({ members: [] });
  listRepos.mockResolvedValue({ repos: [repo('studio-api'), repo('studio-web')] });
  useGateStore.setState({ gates: {} });
  useProjectsStore.setState({ projects: [PROJECT], loading: false, error: null });
});
afterEach(cleanup);

describe('ProjectDashboard — Repositories section (studio#207)', () => {
  it('mounts the section from the dashboard\'s one membership read; attaching lights the header chip too', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('r-1', 'crew.run')] });
    attachProjectMember.mockResolvedValue({ member: member('studio-api') });
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);

    const section = await screen.findByTestId('project-repos');
    await waitFor(() => expect(listProjectMembers).toHaveBeenCalledTimes(1));
    expect(section).toHaveAttribute('data-count', '0');
    expect(screen.queryByTestId('dashboard-repos')).toBeNull(); // the empty-state budget

    fireEvent.focus(within(section).getByTestId('project-repo-search'));
    const options = await within(section).findAllByTestId('project-repo-option');
    expect(options.map((o) => o.getAttribute('data-repo'))).toEqual(['studio-api', 'studio-web']);
    fireEvent.click(options[0]!);

    await waitFor(() => expect(attachProjectMember).toHaveBeenCalledWith('proj-1', {
      kind: 'crew.repo', ref: 'studio-api', attachedBy: 'studio',
    }));
    // One state, two renderings: the row AND the header chip, with no second membership read.
    await waitFor(() => expect(within(section).getByTestId('project-repo-row')).toHaveAttribute('data-repo', 'studio-api'));
    expect(screen.getByTestId('dashboard-repo')).toHaveAttribute('data-repo-ref', 'studio-api');
    expect(screen.getByTestId('dashboard-repo')).toHaveTextContent('studio-api'); // resolved via the warmed cache
    expect(listProjectMembers).toHaveBeenCalledTimes(1);
  });

  it('detaching from the section retires the header chip as well', async () => {
    listProjectMembers.mockResolvedValue({ members: [member('studio-api')] });
    detachProjectMember.mockResolvedValue({ ok: true });
    render(<ProjectDashboard projectId="proj-1" runs={[]} navigate={() => {}} />);

    const section = await screen.findByTestId('project-repos');
    await waitFor(() => expect(within(section).getByTestId('project-repo-row')).toBeInTheDocument());
    expect(screen.getByTestId('dashboard-repos')).toBeInTheDocument();

    fireEvent.click(within(section).getByTestId('project-repo-detach'));
    fireEvent.click(within(section).getByTestId('project-repo-detach-confirm'));
    await waitFor(() => expect(detachProjectMember).toHaveBeenCalledWith('proj-1', 'proj-1:crew.repo:studio-api'));
    await waitFor(() => expect(within(section).queryByTestId('project-repo-row')).toBeNull());
    expect(screen.queryByTestId('dashboard-repos')).toBeNull();
  });

  it('is omitted on the synthesized default project', async () => {
    useProjectsStore.setState({ projects: [{ ...PROJECT, id: 'default', name: 'Unfiled' }], loading: false, error: null });
    render(<ProjectDashboard projectId="default" runs={[]} navigate={() => {}} />);
    await waitFor(() => expect(listProjectMembers).toHaveBeenCalledWith('default'));
    expect(screen.getByTestId('project-dashboard')).toBeInTheDocument();
    expect(screen.queryByTestId('project-repos')).toBeNull();
  });
});
