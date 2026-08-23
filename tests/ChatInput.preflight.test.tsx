import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import { COMPOSER_DEFAULT_GATE_POSTURE } from '../src/components/composerDefaults.js';
import * as client from '../src/api/client.js';
import type { LaunchRunBody } from '../src/api/types.js';

/**
 * DES-UX-001 §7.8 (slice AC, EC43) — composer preflight intelligence:
 *   - a code-shaped intent with no repo attached warn-and-blocks: ZERO
 *     POST /runs until override;
 *   - a bound project's crew.repo member auto-attaches as a removable chip
 *     (`data-auto-attached="true"`);
 *   - the gate control sits at top level and its shipped default is NOT
 *     "none" — it is COMPOSER_DEFAULT_GATE_POSTURE (§13's one-line veto point).
 */

const MEMBER = {
  id: 'api-migration:crew.repo:studio-api', project_id: 'api-migration',
  member_kind: 'crew.repo', member_ref: 'studio-api', meta: null,
  attached_at: 1, attached_by: 'studio',
};

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({
    repos: [{ id: 'studio-api', name: 'studio-api', root_path: '/tmp/studio-api' } as never],
  });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'listProjectMembers').mockResolvedValue({ members: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  localStorage.clear();
});

async function typeAndSend(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.type(screen.getByTestId('launch-problem'), text);
  await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
  await user.click(screen.getByTestId('launch-submit'));
}

describe('ChatInput preflight (§7.8, EC43)', () => {
  it('blocks a repo-less code intent — zero POST /runs — and the override launches', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await typeAndSend(user, 'fix the login bug');

    // Warn-and-block: the block renders and NO launch fired.
    expect(screen.getByTestId('preflight-block')).toBeInTheDocument();
    expect(client.api.launchRun).not.toHaveBeenCalled();

    await user.click(screen.getByTestId('preflight-override'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('preflight-block')).toBeNull();
  });

  it('a non-code intent launches without preflight', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await typeAndSend(user, 'summarize the release notes');
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId('preflight-block')).toBeNull();
  });

  it("auto-attaches the bound project's crew.repo as a removable chip, and the launch carries it", async () => {
    vi.mocked(client.api.listProjectMembers).mockResolvedValue({ members: [MEMBER as never] });
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} lockedProjectId="api-migration" />);

    const chip = await screen.findByTestId('repo-chip');
    expect(chip.dataset.autoAttached).toBe('true');
    expect(chip.textContent).toContain('studio-api');

    // The attached repo satisfies preflight: the code intent launches directly.
    await typeAndSend(user, 'fix the login bug');
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body: LaunchRunBody = vi.mocked(client.api.launchRun).mock.calls[0]![0];
    expect(body.repoRef).toBe('studio-api');
  });

  it('removing the auto chip is the operator speaking — auto never re-attaches', async () => {
    vi.mocked(client.api.listProjectMembers).mockResolvedValue({ members: [MEMBER as never] });
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} lockedProjectId="api-migration" />);
    await screen.findByTestId('repo-chip');

    await user.click(screen.getByLabelText(/Clear Repo: studio-api/));
    expect(screen.queryByTestId('repo-chip')).toBeNull();
    // §7.8: with the chip removed, the code intent hits the block again.
    await typeAndSend(user, 'fix the login bug');
    expect(screen.getByTestId('preflight-block')).toBeInTheDocument();
    expect(client.api.launchRun).not.toHaveBeenCalled();
  });
});

describe('ChatInput gate posture (§7.8 + §13)', () => {
  it('the top-level control ships a non-"none" default and the launch body carries it', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);

    const posture = screen.getByTestId('gate-posture');
    expect((posture as HTMLSelectElement).value).toBe(COMPOSER_DEFAULT_GATE_POSTURE.mode);
    expect((posture as HTMLSelectElement).value).not.toBe('none');

    await typeAndSend(user, 'summarize the release notes');
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body: LaunchRunBody = vi.mocked(client.api.launchRun).mock.calls[0]![0];
    expect(body.humanConfirm).toBe(`before:${COMPOSER_DEFAULT_GATE_POSTURE.beforeOrd}`);
  });

  it('the §13 veto point is the one named constant', () => {
    // A veto is a one-line revert of this object — pin its shape so the revert
    // stays one line.
    expect(COMPOSER_DEFAULT_GATE_POSTURE).toEqual({ mode: 'before', beforeOrd: 1 });
  });

  it('switching the top-level control to "none" restores the old wire shape', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.selectOptions(screen.getByTestId('gate-posture'), 'none');
    await typeAndSend(user, 'summarize the release notes');
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body: LaunchRunBody = vi.mocked(client.api.launchRun).mock.calls[0]![0];
    expect('humanConfirm' in body).toBe(false);
  });
});
