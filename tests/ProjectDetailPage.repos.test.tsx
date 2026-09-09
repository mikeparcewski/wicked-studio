import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Project, ProjectDetail, ProjectMember, RepoEntry } from '../src/api/types.js';

/**
 * studio#207 — the Repositories section: the one UI path that attaches a `crew.repo`
 * member to a project. Mounted on the legacy `/projects/:id` page (this suite) and on
 * the live `/p/:id` dashboard (ProjectDashboard.repos.test.tsx). Lists the project's
 * repo members, offers the registered-repo picker minus what is already attached,
 * attaches with the pinned `AttachMemberBody` wire, detaches behind an inline
 * confirm, and is omitted for the synthesized `default` project (which rejects
 * attach on the wire).
 */

const getProject = vi.fn();
const getProjectActivity = vi.fn();
const listRepos = vi.fn();
const attachProjectMember = vi.fn();
const detachProjectMember = vi.fn();

vi.mock('../src/api/client.js', () => ({
  api: {
    getProject: (...a: unknown[]) => getProject(...a),
    getProjectActivity: (...a: unknown[]) => getProjectActivity(...a),
    listRepos: (...a: unknown[]) => listRepos(...a),
    attachProjectMember: (...a: unknown[]) => attachProjectMember(...a),
    detachProjectMember: (...a: unknown[]) => detachProjectMember(...a),
  },
}));

const { ProjectDetailPage } = await import('../src/components/ProjectDetailPage.js');
const { clearRepoCache } = await import('../src/store/repoCache.js');

const NOW = 1_757_300_000_000;

function project(id: string): Project {
  return {
    id, name: `The ${id} project`, description: null, status: 'active',
    scope: `project:${id}`, created_at: NOW - 1000, updated_at: NOW - 1000,
  };
}

function member(projectId: string, ref: string, kind = 'crew.repo'): ProjectMember {
  return {
    id: `${projectId}:${kind}:${ref}`, project_id: projectId, member_kind: kind,
    member_ref: ref, meta: null, attached_at: NOW - 2000, attached_by: 'studio',
  };
}

function repo(id: string): RepoEntry {
  return { id, name: id, root_path: `/repos/${id}`, default_branch: 'main', registered_at: 1 };
}

function detail(projectId: string, members: ProjectMember[]): ProjectDetail {
  return { project: project(projectId), members } as ProjectDetail;
}

beforeEach(() => {
  clearRepoCache();
  for (const m of [getProject, getProjectActivity, listRepos, attachProjectMember, detachProjectMember]) m.mockReset();
  getProjectActivity.mockResolvedValue({ entries: [], nextCursor: null, projectId: 'proj-1' });
  listRepos.mockResolvedValue({ repos: [repo('studio-api'), repo('studio-web'), repo('crew')] });
});
afterEach(cleanup);

async function renderPage(projectId = 'proj-1'): Promise<HTMLElement> {
  render(<ProjectDetailPage projectId={projectId} navigate={() => {}} />);
  await waitFor(() => expect(getProject).toHaveBeenCalledWith(projectId));
  return await screen.findByTestId('project-repos');
}

describe('ProjectDetailPage — Repositories section (studio#207)', () => {
  it('lists the crew.repo members as rows keyed by ref; other member kinds stay out of the section', async () => {
    getProject.mockResolvedValue(detail('proj-1', [
      member('proj-1', 'studio-api'),
      member('proj-1', 'r-1', 'crew.run'),
      member('proj-1', 'studio-web'),
    ]));
    const section = await renderPage();

    expect(section).toHaveAttribute('data-count', '2');
    const rows = within(section).getAllByTestId('project-repo-row');
    expect(rows.map((r) => r.getAttribute('data-repo'))).toEqual(['studio-api', 'studio-web']);
    // The run member is a Member, not a repository — and the generic list no longer double-lists repos.
    expect(within(section).queryByText('r-1')).toBeNull();
    expect(screen.getByText('Members (1)')).toBeInTheDocument();
    // Nothing fetched the registry on mount — the picker warms the cache on its first gesture.
    expect(listRepos).not.toHaveBeenCalled();
  });

  it('the empty state names the consequence (a project-scoped test cannot launch)', async () => {
    getProject.mockResolvedValue(detail('proj-1', []));
    const section = await renderPage();
    expect(within(section).getByTestId('project-repos-empty')).toHaveTextContent('project-scoped test cannot launch');
    expect(within(section).queryByTestId('project-repo-row')).toBeNull();
  });

  it('the picker fetches the registry on focus, excludes already-attached repos, and Attach sends the pinned AttachMemberBody', async () => {
    getProject.mockResolvedValue(detail('proj-1', [member('proj-1', 'studio-api')]));
    attachProjectMember.mockResolvedValue({ member: member('proj-1', 'crew') });
    const section = await renderPage();

    fireEvent.focus(within(section).getByTestId('project-repo-search'));
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(1));
    const options = await within(section).findAllByTestId('project-repo-option');
    // studio-api is attached → not offered; the two unattached repos are.
    expect(options.map((o) => o.getAttribute('data-repo'))).toEqual(['studio-web', 'crew']);

    fireEvent.click(options[1]!);
    await waitFor(() => expect(attachProjectMember).toHaveBeenCalledTimes(1));
    // The wire is crew's AttachMemberBody — `{kind, ref, attachedBy}`, the same body the
    // register flow sends — NOT the ProjectMember read shape.
    expect(attachProjectMember).toHaveBeenCalledWith('proj-1', {
      kind: 'crew.repo',
      ref: 'crew',
      attachedBy: 'studio',
    });

    // The returned member joins the list; the picker drops it from the offer.
    await waitFor(() => expect(within(section).getAllByTestId('project-repo-row')).toHaveLength(2));
    expect(within(section).getAllByTestId('project-repo-row').map((r) => r.getAttribute('data-repo')))
      .toEqual(['studio-api', 'crew']);
    expect(within(section).getAllByTestId('project-repo-option').map((o) => o.getAttribute('data-repo')))
      .toEqual(['studio-web']);
    expect(listRepos).toHaveBeenCalledTimes(1); // still the one cached registry read
  });

  it('typing narrows the picker by name; a miss says so instead of offering nothing silently', async () => {
    getProject.mockResolvedValue(detail('proj-1', []));
    const section = await renderPage();

    const search = within(section).getByTestId('project-repo-search');
    fireEvent.change(search, { target: { value: 'web' } });
    await waitFor(() => expect(within(section).getAllByTestId('project-repo-option')).toHaveLength(1));
    expect(within(section).getByTestId('project-repo-option')).toHaveAttribute('data-repo', 'studio-web');

    fireEvent.change(search, { target: { value: 'nope' } });
    expect(within(section).getByTestId('project-repo-options-empty')).toHaveTextContent('no registered repo matches');
  });

  it('a failed attach surfaces the error and adds no row', async () => {
    getProject.mockResolvedValue(detail('proj-1', []));
    attachProjectMember.mockRejectedValue(new Error('repo ref not in the registry'));
    const section = await renderPage();

    fireEvent.focus(within(section).getByTestId('project-repo-search'));
    fireEvent.click((await within(section).findAllByTestId('project-repo-option'))[0]!);

    await waitFor(() => expect(within(section).getByTestId('project-repo-error')).toHaveTextContent('repo ref not in the registry'));
    expect(within(section).queryByTestId('project-repo-row')).toBeNull();
  });

  it('Detach asks first: Cancel leaves the member, Confirm DELETEs the member by id and drops the row', async () => {
    getProject.mockResolvedValue(detail('proj-1', [member('proj-1', 'studio-api'), member('proj-1', 'studio-web')]));
    detachProjectMember.mockResolvedValue({ ok: true });
    const section = await renderPage();

    const row = within(section).getAllByTestId('project-repo-row')[0]!;
    fireEvent.click(within(row).getByTestId('project-repo-detach'));
    expect(detachProjectMember).not.toHaveBeenCalled();
    fireEvent.click(within(row).getByTestId('project-repo-detach-cancel'));
    expect(within(row).queryByTestId('project-repo-detach-confirm')).toBeNull();
    expect(within(section).getAllByTestId('project-repo-row')).toHaveLength(2);

    fireEvent.click(within(row).getByTestId('project-repo-detach'));
    fireEvent.click(within(row).getByTestId('project-repo-detach-confirm'));
    await waitFor(() => expect(detachProjectMember).toHaveBeenCalledWith('proj-1', 'proj-1:crew.repo:studio-api'));
    await waitFor(() => expect(within(section).getAllByTestId('project-repo-row')).toHaveLength(1));
    expect(within(section).getByTestId('project-repo-row')).toHaveAttribute('data-repo', 'studio-web');
  });

  it('is omitted for the synthesized default project (the wire rejects attach there)', async () => {
    getProject.mockResolvedValue(detail('default', [member('default', 'r-1', 'crew.run')]));
    getProjectActivity.mockResolvedValue({ entries: [], nextCursor: null, projectId: 'default' });
    render(<ProjectDetailPage projectId="default" navigate={() => {}} />);
    await waitFor(() => expect(getProject).toHaveBeenCalledWith('default'));
    await screen.findByText('Members (1)');

    expect(screen.queryByTestId('project-repos')).toBeNull();
    expect(screen.queryByTestId('project-repo-search')).toBeNull();
  });
});
