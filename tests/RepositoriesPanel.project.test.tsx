import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepositoriesPanel } from '../src/components/RepositoriesPanel.js';
import { RepoDetailPage } from '../src/components/RepoDetailPage.js';
import { AddRepoToProject } from '../src/components/AddRepoToProject.js';
import * as client from '../src/api/client.js';
import type { Project, RepoEntry } from '../src/api/types.js';

/**
 * DES-FEEDBACK-001 slice B (§5.1/§5.2), crew-0182 — the repo register flow's project binding: a chosen project rides
 * `POST /repos {projectId}` (crew 0.18.2 attaches it); an older crew's answer has no `projectAttached`, and studio then
 * attaches it itself (POST /projects/:id/members, `crew.repo`). Unfiled sends no projectId and attaches nothing.
 */

function proj(id: string, updated = 1): Project {
  return {
    id, name: id, description: null, status: 'active',
    scope: `project:${id}`, created_at: 1, updated_at: updated,
  };
}

const REPO: RepoEntry = {
  id: 'repo-1', name: 'my-repo', root_path: '/tmp/my-repo',
  default_branch: 'main', registered_at: 1_700_000_000,
} as unknown as RepoEntry;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listRuns').mockResolvedValue({ runs: [] });
  // getRepoGraph is no longer mocked: the Tracked card's per-repo graph
  // fan-out on mount retired with slice P (DES-FEEDBACK-003 §4.4).
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({
    projects: [proj('q3-review-deck', 9), proj('api-migration', 5), proj('default', 99)],
  });
  vi.spyOn(client.api, 'registerRepo').mockResolvedValue({ repo: REPO, onboardRunId: 'r-onboard' });
  vi.spyOn(client.api, 'attachProjectMember').mockResolvedValue({
    member: {
      id: 'm1', project_id: 'q3-review-deck', member_kind: 'crew.repo', member_ref: 'repo-1',
      meta: null, attached_at: 1, attached_by: 'studio',
    },
  });
});

async function fillAndRegister(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.type(screen.getByTestId('repo-name'), 'my-repo');
  await user.type(screen.getByTestId('repo-path'), '/tmp/my-repo');
  await user.click(screen.getByRole('button', { name: 'Register and onboard' }));
  await waitFor(() => expect(client.api.registerRepo).toHaveBeenCalledTimes(1));
}

describe('RepositoriesPanel register flow — project binding (slice B; crew-0182)', () => {
  it('the project field is the first form field, a real choice listed when the form opens, No project by default', async () => {
    const user = userEvent.setup();
    render(<RepositoriesPanel navigate={vi.fn()} autoShowRegister />);

    expect(screen.getByTestId('repo-project-row')).toBeInTheDocument();
    const select = screen.getByTestId('repo-project-select') as HTMLSelectElement;
    expect(select.value).toBe('');
    // crew-0182: listed at once (the operator never saw the old chip as a choice), Unfiled spelled out, + New project.
    await waitFor(() => expect([...select.options].map((o) => o.textContent)).toEqual(['No project (Unfiled)', 'q3-review-deck', 'api-migration', '+ New project…']));
    expect(client.api.listProjects).toHaveBeenCalledTimes(1);

    await fillAndRegister(user);
    // Unfiled: no projectId, and nothing attached.
    expect(client.api.registerRepo).toHaveBeenCalledWith('my-repo', '/tmp/my-repo', undefined);
    expect(client.api.attachProjectMember).not.toHaveBeenCalled();
  });

  it('a chosen project rides POST /repos; crew attached it, so studio attaches nothing more', async () => {
    vi.mocked(client.api.registerRepo).mockResolvedValue({ repo: REPO, onboardRunId: 'r-onboard', projectAttached: true });
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<RepositoriesPanel navigate={navigate} autoShowRegister />);
    const select = screen.getByTestId('repo-project-select');
    await waitFor(() => expect((select as HTMLSelectElement).options.length).toBe(4));
    await user.selectOptions(select, 'q3-review-deck');
    await fillAndRegister(user);
    expect(client.api.registerRepo).toHaveBeenCalledWith('my-repo', '/tmp/my-repo', 'q3-review-deck');
    expect(client.api.attachProjectMember).not.toHaveBeenCalled();
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/repo-detail/repo-1'));
  });

  it('an older crew (no projectAttached): studio attaches the repo itself via crew.repo membership', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<RepositoriesPanel navigate={navigate} autoShowRegister />);
    const select = screen.getByTestId('repo-project-select');
    await waitFor(() => expect((select as HTMLSelectElement).options.length).toBe(4));
    await user.selectOptions(select, 'q3-review-deck');
    await fillAndRegister(user);
    await waitFor(() =>
      expect(client.api.attachProjectMember).toHaveBeenCalledWith('q3-review-deck', { kind: 'crew.repo', ref: 'repo-1', attachedBy: 'studio' }),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/repo-detail/repo-1'));
  });

  it('crew registered it but could not add it to the project (and studio could not either): the repository page says so', async () => {
    vi.mocked(client.api.registerRepo).mockResolvedValue({ repo: REPO, onboardRunId: 'r-onboard', projectAttachError: 'project q3-review-deck is archived' });
    vi.mocked(client.api.attachProjectMember).mockRejectedValue(new Error('project q3-review-deck is archived'));
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<RepositoriesPanel navigate={navigate} autoShowRegister />);
    const select = screen.getByTestId('repo-project-select');
    await waitFor(() => expect((select as HTMLSelectElement).options.length).toBe(4));
    await user.selectOptions(select, 'q3-review-deck');
    await fillAndRegister(user);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/repo-detail/repo-1', {
      state: { projectAttachError: 'Registered, but not added to q3-review-deck: project q3-review-deck is archived', projectAttachFor: 'q3-review-deck', projectAttachRepo: true },
    }));
    expect(client.api.attachProjectMember).toHaveBeenCalledTimes(1);
  });

  it('an older crew\'s projectAttachError (its run filing only): studio still attaches the repo and says only the run is unfiled', async () => {
    vi.mocked(client.api.registerRepo).mockResolvedValue({ repo: REPO, onboardRunId: 'r-onboard', projectAttachError: 'filing failed' });
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<RepositoriesPanel navigate={navigate} autoShowRegister />);
    const select = screen.getByTestId('repo-project-select');
    await waitFor(() => expect((select as HTMLSelectElement).options.length).toBe(4));
    await user.selectOptions(select, 'q3-review-deck');
    await fillAndRegister(user);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/repo-detail/repo-1', {
      state: { projectAttachError: 'Added to q3-review-deck, but its onboarding run is not filed there: filing failed', projectAttachFor: 'q3-review-deck', projectAttachRepo: false },
    }));
    expect(client.api.attachProjectMember).toHaveBeenCalledWith('q3-review-deck', { kind: 'crew.repo', ref: 'repo-1', attachedBy: 'studio' });
  });
});

describe('RepositoriesPanel register flow — the project list (crew-0182 review r2)', () => {
  it('a failed list says so beside the field, and Retry reads it again', async () => {
    vi.mocked(client.api.listProjects).mockRejectedValueOnce(new Error('offline'));
    const user = userEvent.setup();
    render(<RepositoriesPanel navigate={vi.fn()} autoShowRegister />);
    await user.click(await screen.findByTestId('repo-project-retry'));
    await waitFor(() => expect((screen.getByTestId('repo-project-select') as HTMLSelectElement).options.length).toBe(4));
    expect(screen.queryByTestId('repo-project-failed')).toBeNull();
  });
});

describe('RepositoriesPanel register flow — an attached repo whose run filing failed (crew-0182 review)', () => {
  it('says it was added, and that only its onboarding run is not filed', async () => {
    vi.mocked(client.api.registerRepo).mockResolvedValue({ repo: REPO, onboardRunId: 'r-onboard', projectAttached: true, projectAttachError: 'project busy' });
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<RepositoriesPanel navigate={navigate} autoShowRegister />);
    const select = screen.getByTestId('repo-project-select');
    expect(screen.getByTestId('repo-project-hint')).toHaveTextContent('registered in no project');
    await waitFor(() => expect((select as HTMLSelectElement).options.length).toBe(4));
    await user.selectOptions(select, 'q3-review-deck');
    expect(screen.getByTestId('repo-project-hint')).toHaveTextContent('joins this project');
    await fillAndRegister(user);
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/repo-detail/repo-1', {
      state: { projectAttachError: 'Added to q3-review-deck, but its onboarding run is not filed there: project busy', projectAttachFor: 'q3-review-deck', projectAttachRepo: false },
    }));
  });
});

/** crew-0182: a registered repository joins a project from its own page (the member path the project page uses). */
describe('Repository page — Add to a project', () => {

  it('offers the projects it is not in and attaches the pick with crew.repo', async () => {
    const onAdded = vi.fn();
    render(<AddRepoToProject repoId="repo-1" repoName="my-repo" inProjects={['q3-review-deck']} onAdded={onAdded} />);
    const select = await screen.findByTestId('repo-add-to-project-select');
    expect([...(select as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['Add to a project…', 'api-migration']);
    const user = userEvent.setup();
    await user.selectOptions(select, 'api-migration');
    await user.click(screen.getByTestId('repo-add-to-project-confirm'));
    await waitFor(() => expect(client.api.attachProjectMember).toHaveBeenCalledWith('api-migration', { kind: 'crew.repo', ref: 'repo-1', attachedBy: 'studio' }));
    expect(await screen.findByTestId('repo-add-to-project-done')).toHaveTextContent('Added to api-migration.');
    expect(onAdded).toHaveBeenCalledWith({ id: 'api-migration', name: 'api-migration' });
  });

  it('a failed project list says so with a Retry that reads it again, and focus lands on the list it brings back', async () => {
    vi.mocked(client.api.listProjects).mockRejectedValueOnce(new Error('offline'));
    render(<AddRepoToProject repoId="repo-1" repoName="my-repo" inProjects={null} onAdded={vi.fn()} />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('repo-add-to-project-retry'));
    const select = await screen.findByTestId('repo-add-to-project-select');
    await waitFor(() => expect(document.activeElement).toBe(select));
  });

  it('a browser that moves focus off the disabled controls while the add is in flight still gets focus back (review r3)', async () => {
    let finish!: () => void;
    vi.mocked(client.api.attachProjectMember).mockImplementationOnce(() => new Promise((r) => { finish = () => r({ member: {} } as never); }));
    const { rerender } = render(<AddRepoToProject repoId="repo-1" repoName="my-repo" inProjects={['q3-review-deck']} onAdded={vi.fn()} />);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByTestId('repo-add-to-project-select'), 'api-migration');
    await user.click(screen.getByTestId('repo-add-to-project-confirm'));
    (document.activeElement as HTMLElement).blur(); // the focus fix-up a real browser applies to a disabled control
    finish();
    await screen.findByTestId('repo-add-to-project-done');
    rerender(<AddRepoToProject repoId="repo-1" repoName="my-repo" inProjects={['q3-review-deck', 'api-migration']} onAdded={vi.fn()} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('repo-add-to-project-done')));
  });

  it('a person who moved on while the add was in flight keeps their focus', async () => {
    let finish!: () => void;
    vi.mocked(client.api.attachProjectMember).mockImplementationOnce(() => new Promise((r) => { finish = () => r({ member: {} } as never); }));
    render(<><input data-testid="elsewhere" /><AddRepoToProject repoId="repo-1" repoName="my-repo" inProjects={['q3-review-deck']} onAdded={vi.fn()} /></>);
    const user = userEvent.setup();
    await user.selectOptions(await screen.findByTestId('repo-add-to-project-select'), 'api-migration');
    await user.click(screen.getByTestId('repo-add-to-project-confirm'));
    screen.getByTestId('elsewhere').focus();
    finish();
    await screen.findByTestId('repo-add-to-project-done');
    expect(document.activeElement).toBe(screen.getByTestId('elsewhere'));
  });

  it('adding the last project left keeps keyboard focus on what was said', async () => {
    const { rerender } = render(<AddRepoToProject repoId="repo-1" repoName="my-repo" inProjects={['q3-review-deck']} onAdded={vi.fn()} />);
    const select = await screen.findByTestId('repo-add-to-project-select');
    const user = userEvent.setup();
    await user.selectOptions(select, 'api-migration');
    await user.click(screen.getByTestId('repo-add-to-project-confirm'));
    rerender(<AddRepoToProject repoId="repo-1" repoName="my-repo" inProjects={['q3-review-deck', 'api-migration']} onAdded={vi.fn()} />);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('repo-add-to-project-done')));
  });

  it('a refused attach says why', async () => {
    vi.mocked(client.api.attachProjectMember).mockRejectedValue(new Error('only a person attaches a repo to a project'));
    render(<AddRepoToProject repoId="repo-1" repoName="my-repo" inProjects={null} onAdded={vi.fn()} />);
    const select = await screen.findByTestId('repo-add-to-project-select');
    const user = userEvent.setup();
    await user.selectOptions(select, 'q3-review-deck');
    await user.click(screen.getByTestId('repo-add-to-project-confirm'));
    expect(await screen.findByTestId('repo-add-to-project-error')).toHaveTextContent('Could not add it: only a person attaches a repo to a project');
  });
});

/**
 * FIX-IT-ALL L4-⑩ (F-RC1-049 / F-E2E-015): "Capture learnings" files the run under the AMBIENT project when there is
 * one — `projectId` rides the existing `launchRun` wire (`LaunchRunBody.projectId`, api-types 0.38.0) — and sends NO
 * `projectId` otherwise, so an unfiled run is unfiled honestly (no repo→project guess). The verb lives on the
 * repository's page (Settings) since the 2026-11-05 redesign: a row opened from a project's Repositories tab carries
 * the project to the page as `?project=`. Mutation: drop the spread in `launchCaptureLearnings` → the first case fails.
 */
describe('Capture learnings — ambient project filing (L4-⑩)', () => {
  beforeEach(() => {
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [REPO] });
    vi.spyOn(client.api, 'getRepoGraph').mockResolvedValue({ graph: null });
    vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-cap' });
  });

  async function clickCapture(): Promise<Record<string, unknown>> {
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('repo-capture-learnings'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    return vi.mocked(client.api.launchRun).mock.calls[0]![0] as unknown as Record<string, unknown>;
  }

  it('a row on a project’s Repositories tab opens the page with the project carried', async () => {
    const navigate = vi.fn();
    render(<RepositoriesPanel navigate={navigate} ambientProject="q3-review-deck" />);
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('repo-row'));
    expect(navigate).toHaveBeenCalledWith('/repo-detail/repo-1?project=q3-review-deck');
  });

  it('opened from a project, the launch carries that projectId, so the run files under /p/<proj>', async () => {
    render(<RepoDetailPage repoId="repo-1" onSelectRun={vi.fn()} navigate={vi.fn()} onOpenGraph={vi.fn()} search="?tab=settings&project=q3-review-deck" />);
    const body = await clickCapture();
    expect(body).toEqual({
      problem: 'Capture learnings from my-repo',
      repoRef: 'repo-1',
      workflow: 'capture-learnings',
      projectId: 'q3-review-deck',
    });
    expect(screen.getByTestId('repo-capture-learnings').getAttribute('title')).toContain('filed under this project');
  });

  it('opened from the flat /repos page (no project), the body carries NO projectId — Unfiled honestly', async () => {
    render(<RepoDetailPage repoId="repo-1" onSelectRun={vi.fn()} navigate={vi.fn()} onOpenGraph={vi.fn()} search="?tab=settings" />);
    const body = await clickCapture();
    expect(body).toEqual({ problem: 'Capture learnings from my-repo', repoRef: 'repo-1', workflow: 'capture-learnings' });
    expect(body).not.toHaveProperty('projectId');
    expect(screen.getByTestId('repo-capture-learnings').getAttribute('title')).not.toContain('filed under');
  });
});
