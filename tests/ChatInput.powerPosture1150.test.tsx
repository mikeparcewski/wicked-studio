import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput, POWER_GATE_WORDS } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { clearRetryPrefill } from '../src/store/retryPrefill.js';
import { pickLaunchWorkflow } from './launchWorkflowPick.js';

/**
 * studio#1150: a power launch never holds before its first step (crew sets humanConfirm none; it asks once, at hand-off).
 * The New job form must say so — never "gate: first gate" — and its Power switch is the one way to keep a step gate.
 */

const REPOS = [{ id: 'wicked-studio', name: 'wicked-studio', root_path: '/tmp/studio' }];

function setup(powerModeDefault: boolean | undefined, powerCap = true): void {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: REPOS as never });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [{ id: 'feature', is_system: false, phases: [] }] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: powerModeDefault === undefined ? {} : { powerModeDefault } } as never);
  useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown' });
  useCapabilities.setState({ loaded: true, powerMode: powerCap });
  localStorage.clear();
  clearRetryPrefill();
}

async function fill(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
  await pickLaunchWorkflow(user, 'feature');
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  await user.click(await screen.findByTestId('launch-repo-wicked-studio'));
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  await user.type(screen.getByTestId('launch-problem'), 'add the retry card');
  return user;
}

async function send(user: ReturnType<typeof userEvent.setup>): Promise<LaunchBodyWithDeliver & { power?: boolean }> {
  await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
  await user.click(screen.getByTestId('launch-submit'));
  await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
  return vi.mocked(client.api.launchRun).mock.calls[0]![0] as LaunchBodyWithDeliver & { power?: boolean };
}

describe('New job form: the gate it promises is the gate the run keeps (studio#1150)', () => {
  beforeEach(() => setup(undefined));

  it('power on (the default): no posture select, "At hand-off (power mode)", and no power key is sent', async () => {
    const user = await fill();
    await waitFor(() => expect(screen.getByTestId('launch-confirm-gate').textContent).toBe(POWER_GATE_WORDS));
    expect(screen.queryByTestId('gate-posture')).toBeNull();
    expect(screen.getByTestId('gate-posture-power').textContent).toMatch(/At hand-off \(power mode\)/);
    expect(screen.getByTestId('launch-confirm').textContent).not.toMatch(/first gate/);
    const body = await send(user);
    expect(body.power).toBeUndefined();
    expect(body.humanConfirm, 'still sent: kept if the launch falls back to phased').toBeDefined();
  });

  it('Power mode off: the posture comes back, the summary names it, and the body says power: false', async () => {
    const user = await fill();
    await user.click(await screen.findByTestId('launch-power-toggle'));
    expect(screen.getByTestId('gate-posture')).toBeInTheDocument();
    expect(screen.getByTestId('launch-confirm-gate').textContent).toBe('first gate');
    const body = await send(user);
    expect(body.power).toBe(false);
    expect(body.humanConfirm).toMatch(/^before:/);
  });

  it('the setting off: the posture select shows, as before, and nothing is sent about power', async () => {
    setup(false);
    const user = await fill();
    await waitFor(() => expect(screen.getByTestId('launch-confirm-gate').textContent).toBe('first gate'));
    expect(screen.getByTestId('gate-posture')).toBeInTheDocument();
    expect((await send(user)).power).toBeUndefined();
  });

  it('a daemon without power mode: unchanged (no switch, the posture select)', async () => {
    setup(undefined, false);
    await fill();
    expect(screen.queryByTestId('launch-power-toggle')).toBeNull();
    expect(screen.getByTestId('gate-posture')).toBeInTheDocument();
    expect(screen.getByTestId('launch-confirm-gate').textContent).toBe('first gate');
  });
});
