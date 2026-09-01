import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import type { LaunchBodyWithDeliver, Project } from '../src/api/types.js';

/**
 * DES-FEEDBACK-001 slice B (§5.1/§5.2/§4.3) — the Build launch form's project
 * binding:
 *   - default is Unfiled: the launch POST body carries NO `projectId` key at
 *     all (the backend default, byte-identical to the pre-slice request);
 *   - selecting a project in the switcher puts `projectId` on the body;
 *   - `lockedProjectId` (entered via /p/:projectId/build/new) pre-fills the
 *     field with the project, marks it data-locked, refuses to open, and
 *     forces `projectId` onto every launch;
 *   - the project list is fetched lazily on the dropdown's first open (or on
 *     mount when locked, to resolve the name) — never on an unbound mount.
 */

function proj(id: string, name: string, updated = 1): Project {
  return {
    id, name, description: null, status: 'active',
    scope: `project:${id}`, created_at: 1, updated_at: updated,
  };
}

const PROJECTS = [
  proj('api-migration', 'api-migration', 5),
  proj('q3-review-deck', 'q3-review-deck', 9),
  proj('default', 'Unfiled', 99),
];

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: PROJECTS });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  localStorage.clear();
});

async function typeAndLaunch(user: ReturnType<typeof userEvent.setup>): Promise<LaunchBodyWithDeliver> {
  await user.type(screen.getByTestId('launch-problem'), 'build the thing');
  // The Send button enables once the roster load has landed a selected CLI.
  await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
  await user.click(screen.getByTestId('launch-submit'));
  await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
  return vi.mocked(client.api.launchRun).mock.calls[0]![0];
}

describe('ChatInput launch form — project binding (slice B)', () => {
  it('defaults to Unfiled and launches WITHOUT a projectId key', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);

    const field = screen.getByTestId('project-field');
    expect(field.textContent).toContain('Unfiled');
    expect(field.dataset.locked).toBe('false');
    // §5.1: the unbound form fetches no project list on mount.
    expect(client.api.listProjects).not.toHaveBeenCalled();

    const body = await typeAndLaunch(user);
    expect('projectId' in body, 'Unfiled = no projectId key at all').toBe(false);
  });

  it('lazy-loads projects on open, and a selected project rides the POST body', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);

    await user.click(screen.getByTestId('project-field'));
    expect(client.api.listProjects).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getAllByTestId('project-switcher-option').length).toBe(2));
    // Recency order (updated_at desc), and the synthesized default never lists.
    const rows = screen.getAllByTestId('project-switcher-option');
    expect(rows.map((r) => r.dataset.projectId)).toEqual(['q3-review-deck', 'api-migration']);
    // §5.2: the "+ New project" hand-off is in the dropdown.
    expect(screen.getByTestId('project-switcher-add')).toBeInTheDocument();

    await user.click(rows[0]!);
    expect(screen.getByTestId('project-field').textContent).toContain('q3-review-deck');

    const body = await typeAndLaunch(user);
    expect(body.projectId).toBe('q3-review-deck');
  });

  it('locked pre-bind (§4.3): shows the project name, data-locked, refuses to open, launches bound', async () => {
    const user = userEvent.setup();
    render(
      <ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} lockedProjectId="q3-review-deck" />,
    );

    const field = screen.getByTestId('project-field');
    expect(field.dataset.locked).toBe('true');
    // The name resolves from the mount fetch the LOCK (and only the lock) triggers.
    await waitFor(() => expect(client.api.listProjects).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(field.textContent).toContain('q3-review-deck'));

    await user.click(field);
    expect(screen.queryByTestId('project-switcher-list'), 'locked field must not open').toBeNull();

    const body = await typeAndLaunch(user);
    expect(body.projectId).toBe('q3-review-deck');
  });
});
