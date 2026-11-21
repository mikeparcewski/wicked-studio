import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import { api } from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { clearRetryPrefill } from '../src/store/retryPrefill.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { pickLaunchWorkflow } from './launchWorkflowPick.js';

beforeEach(() => {
  vi.restoreAllMocks();
  resetPlanCatalog();
  localStorage.clear();
  clearRetryPrefill();
  useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown' });
  vi.spyOn(api, 'getRoster').mockResolvedValue({ roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }] });
  vi.spyOn(api, 'listRepos').mockResolvedValue({ repos: [{ id: 'svc', name: 'svc', root_path: '/tmp/svc' } as never] });
  vi.spyOn(api, 'listWorkflows').mockResolvedValue({ workflows: [{ id: 'feature', is_system: false, phases: [] }] });
  vi.spyOn(api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(api, 'getHealth').mockResolvedValue({ status: 'ok', version: 'test', ping: 'ok', capabilities: { deliverGate: true, powerMode: false } });
});

async function repoBuild(): Promise<void> {
  const user = userEvent.setup();
  render(<ChatInput onLaunched={() => {}} />);
  await pickLaunchWorkflow(user, 'feature');
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  await user.click(screen.getByTestId('launch-repo-svc'));
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
}

describe('delivery follows crew on every daemon (#1190)', () => {
  it('a daemon without power mode is asked once for the repo build and crew can decline delivery', async () => {
    const preview = vi.spyOn(api, 'previewLaunchPosture').mockResolvedValue({ posture: { power: false, deliver: 'none', autoDeliver: false } });
    await repoBuild();
    await waitFor(() => expect(screen.getByTestId('deliver-notice')).toHaveAttribute('data-deliver-state', 'not-delivered'));
    expect(screen.getByTestId('deliver-toggle')).toBeChecked();
    expect(screen.getByTestId('deliver-notice')).toHaveTextContent('No PR when this finishes: this job does not deliver a change.');
    expect(screen.getByTestId('deliver-notice')).not.toHaveTextContent(/deliver gate/i);
    const repoCalls = preview.mock.calls.filter(([body]) => body.repoRef === 'svc');
    expect(repoCalls).toHaveLength(1);
    expect(repoCalls[0]![0]).not.toHaveProperty('power');
  });

  it('toggle off and crew answers none keeps the off state and worktree wording', async () => {
    const preview = vi.spyOn(api, 'previewLaunchPosture').mockImplementation(async (body) => ({
      posture: { power: false, deliver: body.deliver ?? 'none', autoDeliver: false },
    }));
    await repoBuild();
    await userEvent.click(screen.getByTestId('deliver-toggle'));
    await waitFor(() => expect(preview.mock.calls.some(([body]) => body.repoRef === 'svc' && body.deliver === 'none')).toBe(true));
    await waitFor(() => expect(screen.getByTestId('deliver-notice')).toHaveAttribute('data-deliver-state', 'off'));
    expect(screen.getByTestId('deliver-toggle')).not.toBeChecked();
    expect(screen.getByTestId('deliver-notice')).toHaveTextContent('worktree');
  });

  it('crew auto-delivers even when the form defaults to a human gate', async () => {
    vi.spyOn(api, 'previewLaunchPosture').mockResolvedValue({ posture: { power: false, deliver: 'pr', autoDeliver: true } });
    await repoBuild();
    await waitFor(() => expect(screen.getByTestId('deliver-notice')).toHaveAttribute('data-deliver-gate', 'auto'));
    expect(screen.getByTestId('deliver-notice')).toHaveTextContent('with NO deliver gate: this posture is auto-deliver.');
    expect(screen.getByTestId('deliver-notice')).not.toHaveTextContent('pauses at the deliver gate');
  });

  it('a preview 404 on a daemon without power mode keeps today’s gated delivery wording', async () => {
    const preview = vi.spyOn(api, 'previewLaunchPosture').mockRejectedValue(new ApiError(404, 'Not found'));
    await repoBuild();
    await waitFor(() => expect(preview.mock.calls.some(([body]) => body.repoRef === 'svc')).toBe(true));
    expect(screen.getByTestId('deliver-notice')).toHaveAttribute('data-deliver-state', 'on');
    expect(screen.getByTestId('deliver-notice')).toHaveTextContent('pauses at the deliver gate; approve it and the run');
  });
});
