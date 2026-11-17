import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';
import type { LaunchPreviewBody, LaunchPreviewPosture } from '../src/board/launchPosture.js';
import { powerGateWords } from '../src/board/launchPosture.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { clearRetryPrefill } from '../src/store/retryPrefill.js';
import { pickLaunchWorkflow } from './launchWorkflowPick.js';

/**
 * studio#1150, SAYS == DOES: the New job form shows the gates crew says this body keeps
 * (`POST /runs/preview`) and sends `power` exactly as crew answered for that body. With no answer
 * it claims nothing about power and sends `power: false`, so the step-gate select is what is kept.
 */

let answer: (body: LaunchPreviewBody) => Promise<{ posture?: LaunchPreviewPosture }>;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({
    repos: [{ id: 'studio-api', name: 'studio-api', root_path: '/tmp/studio-api' } as never],
  });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({
    workflows: [{ id: 'feature', is_system: false, phases: [] }, { id: 'bug', is_system: false, phases: [] }],
  });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  vi.spyOn(client.api, 'getHealth').mockResolvedValue({
    status: 'ok', version: '0.18.17', ping: 'ok', capabilities: { deliverGate: true, powerMode: true },
  });
  vi.spyOn(client.api, 'previewLaunchPosture').mockImplementation((b) => answer(b));
  useCapabilities.setState({ powerMode: true });
  useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown' });
  localStorage.clear();
  clearRetryPrefill();
});

/** crew's rule for the test daemon: a repo-scoped `feature` runs power unless the body says `power: false`. */
function crewSays(over: Partial<LaunchPreviewPosture> = {}) {
  return (b: LaunchPreviewBody) => Promise.resolve({
    posture: {
      power: b.power !== false && b.repoRef !== undefined && b.workflow === 'feature',
      ...(b.power === false || b.repoRef === undefined ? (b.humanConfirm !== undefined ? { humanConfirm: b.humanConfirm } : {}) : { humanConfirm: 'none' }),
      deliver: b.deliver ?? 'none',
      autoDeliver: b.deliverGate === 'auto',
      ...over,
    },
  });
}

async function bindFeatureOnRepo(user: ReturnType<typeof userEvent.setup>, workflow = 'feature'): Promise<void> {
  await pickLaunchWorkflow(user, workflow);
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  await user.click(screen.getByTestId('launch-repo-studio-api'));
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
}

async function send(user: ReturnType<typeof userEvent.setup>): Promise<LaunchBodyWithDeliver> {
  await user.type(screen.getByTestId('launch-problem'), 'make it so');
  await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
  await user.click(screen.getByTestId('launch-submit'));
  await waitFor(() => expect(client.api.launchRun).toHaveBeenCalled());
  return vi.mocked(client.api.launchRun).mock.calls[0]![0];
}

describe('New job form: the gates shown are crew\'s answer for the body sent (studio#1150)', () => {
  it('power: the select gives way to the hand-off words, the Ready line says the same, and power: true is sent', async () => {
    answer = crewSays();
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindFeatureOnRepo(user);
    await waitFor(() => expect(screen.getByTestId('gate-posture-power')).toBeInTheDocument());
    const words = powerGateWords({ power: true, deliver: 'pr', autoDeliver: false });
    expect(screen.getByTestId('gate-posture-power')).toHaveTextContent(words);
    expect(screen.queryByTestId('gate-posture')).toBeNull();
    expect(screen.getByTestId('launch-confirm-gate')).toHaveTextContent(words);
    expect(screen.getByTestId('launch-confirm-gate')).not.toHaveTextContent(/first gate/);
    const body = await send(user);
    expect(body.power).toBe(true);
    expect(body.deliver).toBe('pr');
  });

  it('Power mode off: the select and its gate come back, crew is asked with power: false, and power: false is sent', async () => {
    answer = crewSays();
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindFeatureOnRepo(user);
    await waitFor(() => expect(screen.getByTestId('gate-posture-power-switch')).toBeInTheDocument());
    await user.click(screen.getByTestId('gate-posture-power-switch'));
    await waitFor(() => expect(screen.getByTestId('gate-posture')).toBeInTheDocument());
    // Crew is asked about the body with power off (debounced), and answers phased.
    await waitFor(() => expect(vi.mocked(client.api.previewLaunchPosture).mock.calls.some(([b]) => b.power === false)).toBe(true));
    expect(screen.getByTestId('launch-confirm-gate')).toHaveTextContent('first gate');
    const body = await send(user);
    expect(body.power).toBe(false);
    expect(body.humanConfirm).toMatch(/^before:/);
  });

  it('a phased answer (not a preset): today\'s select and words, power: false sent', async () => {
    answer = crewSays({ power: false });
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindFeatureOnRepo(user);
    await waitFor(() => expect(client.api.previewLaunchPosture).toHaveBeenCalled());
    expect(screen.getByTestId('gate-posture')).toBeInTheDocument();
    expect(screen.queryByTestId('gate-posture-power')).toBeNull();
    expect(screen.getByTestId('launch-confirm-gate')).toHaveTextContent('first gate');
    expect((await send(user)).power).toBe(false);
  });

  it('a failed preview (or an older daemon\'s 404) claims nothing about power and sends power: false', async () => {
    answer = () => Promise.reject(new Error('404'));
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindFeatureOnRepo(user);
    await waitFor(() => expect(client.api.previewLaunchPosture).toHaveBeenCalled());
    expect(screen.queryByTestId('gate-posture-power')).toBeNull();
    expect(screen.getByTestId('launch-confirm-gate')).toHaveTextContent('first gate');
    expect((await send(user)).power).toBe(false);
  });

  it('an answer still pending at Send: power: false, the step gate shown is kept', async () => {
    answer = () => new Promise(() => {});
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindFeatureOnRepo(user);
    expect(screen.queryByTestId('gate-posture-power')).toBeNull();
    expect((await send(user)).power).toBe(false);
  });

  it('an answer for another body is never shown or sent: changing the workflow drops the power words', async () => {
    answer = crewSays();
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindFeatureOnRepo(user);
    await waitFor(() => expect(screen.getByTestId('gate-posture-power')).toBeInTheDocument());
    // Crew answers `bug` slowly: until it does, nothing about power is claimed for it.
    answer = () => new Promise(() => {});
    await pickLaunchWorkflow(user, 'bug');
    await waitFor(() => expect(screen.queryByTestId('gate-posture-power')).toBeNull());
    expect((await send(user)).power).toBe(false);
  });

  it('a daemon without power mode is never asked and the body carries no power key', async () => {
    useCapabilities.setState({ powerMode: false });
    answer = crewSays();
    const user = userEvent.setup();
    render(<ChatInput onLaunched={() => {}} />);
    await bindFeatureOnRepo(user);
    const body = await send(user);
    expect(client.api.previewLaunchPosture).not.toHaveBeenCalled();
    expect(body).not.toHaveProperty('power');
  });
});
