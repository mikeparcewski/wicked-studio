import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RepositoriesPanel } from '../src/components/RepositoriesPanel.js';
import * as client from '../src/api/client.js';
import type { Project, RepoEntry } from '../src/api/types.js';

/**
 * DES-FEEDBACK-001 slice B (§5.1/§5.2) — the repo register flow's project
 * binding. POST /repos has a strict schema with no projectId, so:
 *   - Unfiled (the default) registers exactly as before — register body
 *     unchanged, NO membership attach;
 *   - a selected project binds the repo at creation via
 *     POST /projects/:id/members with kind `crew.repo`.
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
  await user.type(screen.getByPlaceholderText('Repo name'), 'my-repo');
  await user.type(screen.getByPlaceholderText('Absolute path to git repo'), '/tmp/my-repo');
  await user.click(screen.getByRole('button', { name: 'Register & onboard' }));
  await waitFor(() => expect(client.api.registerRepo).toHaveBeenCalledTimes(1));
}

describe('RepositoriesPanel register flow — project binding (slice B)', () => {
  it('the project field is the first form field, Unfiled by default; register attaches nothing', async () => {
    const user = userEvent.setup();
    render(<RepositoriesPanel navigate={vi.fn()} autoShowRegister />);

    const row = screen.getByTestId('repo-project-row');
    expect(row).toBeInTheDocument();
    expect(screen.getByTestId('project-field').textContent).toContain('Unfiled');
    // Lazy: no project list fetch until the dropdown opens.
    expect(client.api.listProjects).not.toHaveBeenCalled();

    await fillAndRegister(user);
    // §5.1: unfiled = the register request is byte-identical to before, and no attach.
    expect(client.api.registerRepo).toHaveBeenCalledWith('my-repo', '/tmp/my-repo');
    expect(client.api.attachProjectMember).not.toHaveBeenCalled();
  });

  it('a selected project binds the repo at creation via crew.repo membership', async () => {
    const user = userEvent.setup();
    const navigate = vi.fn();
    render(<RepositoriesPanel navigate={navigate} autoShowRegister />);

    await user.click(screen.getByTestId('project-field'));
    expect(client.api.listProjects).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getAllByTestId('project-switcher-option').length).toBe(2));
    expect(screen.getByTestId('project-switcher-add')).toBeInTheDocument();
    await user.click(screen.getAllByTestId('project-switcher-option')[0]!);
    expect(screen.getByTestId('project-field').textContent).toContain('q3-review-deck');

    await fillAndRegister(user);
    await waitFor(() =>
      expect(client.api.attachProjectMember).toHaveBeenCalledWith('q3-review-deck', {
        kind: 'crew.repo',
        ref: 'repo-1',
        attachedBy: 'studio',
      }),
    );
    // The flow still lands on the repo detail page after the bind.
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/repo-detail/repo-1'));
  });
});

/**
 * FIX-IT-ALL L4-⑩ (F-RC1-049 / F-E2E-015): the "Capture learnings" card launch files the
 * run under the AMBIENT project when there is one — `projectId` rides the existing
 * `launchRun` wire (`LaunchRunBody.projectId`, api-types 0.38.0) — and sends NO
 * `projectId` from the flat /repos page, so an unfiled run is unfiled honestly (no
 * repo→project guess). Mutation: drop the spread in `captureLearnings` → the first case fails.
 */
describe('RepositoriesPanel capture-learnings launch — ambient project filing (L4-⑩)', () => {
  beforeEach(() => {
    vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [REPO] });
    vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-cap' });
  });

  async function clickCapture(): Promise<Record<string, unknown>> {
    const user = userEvent.setup();
    await user.click(await screen.findByTestId('repo-capture-learnings'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    return vi.mocked(client.api.launchRun).mock.calls[0]![0] as unknown as Record<string, unknown>;
  }

  it('inside a project the launch carries the ambient projectId, so the run files under /p/<proj>', async () => {
    render(<RepositoriesPanel navigate={vi.fn()} ambientProject="q3-review-deck" />);
    const body = await clickCapture();
    expect(body).toEqual({
      problem: 'Capture learnings from my-repo',
      repoRef: 'repo-1',
      workflow: 'capture-learnings',
      projectId: 'q3-review-deck',
    });
    expect(screen.getByTestId('repo-capture-learnings').getAttribute('title')).toContain('filed under the current project');
  });

  it('from the flat /repos page (no ambient project) the body carries NO projectId — Unfiled honestly, byte-identical to before', async () => {
    render(<RepositoriesPanel navigate={vi.fn()} />);
    const body = await clickCapture();
    expect(body).toEqual({ problem: 'Capture learnings from my-repo', repoRef: 'repo-1', workflow: 'capture-learnings' });
    expect(body).not.toHaveProperty('projectId');
    expect(screen.getByTestId('repo-capture-learnings').getAttribute('title')).not.toContain('filed under');
  });
});
