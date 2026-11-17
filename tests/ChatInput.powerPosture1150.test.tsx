import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';
import { POWER_MAY_DROP, POWER_WILL_DROP, powerNotice } from '../src/board/powerNotice.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { usePlanCatalog } from '../src/store/planCatalog.js';
import { clearRetryPrefill } from '../src/store/retryPrefill.js';
import { pickLaunchWorkflow } from './launchWorkflowPick.js';

/**
 * studio#1150: a power run never holds before its first step (crew drops its humanConfirm; it asks once, at hand-off).
 * The New job form says so in ONE read-only line, derived from the body it sends and what the daemon says; the body is
 * unchanged (the selector and switch that kept diverging from the body are studio#1179).
 */

describe('powerNotice: from the body and the daemon (crew POST /runs rules)', () => {
  const body = { repoRef: 'r', workflow: 'feature', humanConfirm: 'before:1' };
  const on = { powerMode: true, powerDefault: true, isPreset: true };
  const bools = [true, false] as const;
  it('every combination: the line appears exactly when crew may run power and drop a step gate the body asks for', () => {
    for (const powerMode of bools) for (const powerDefault of [true, false, null] as const) for (const isPreset of [true, false, null] as const)
    for (const hc of ['before:1', 'all', 'none', undefined] as const) for (const repo of bools) for (const kind of ['workflow', 'plan', 'none'] as const)
    for (const power of [true, false, undefined] as const) {
      const b = { ...(repo ? { repoRef: 'r' } : {}), ...(kind === 'workflow' ? { workflow: 'feature' } : kind === 'plan' ? { plan: {} } : {}),
        ...(hc !== undefined ? { humanConfirm: hc } : {}), ...(power !== undefined ? { power } : {}) };
      const line = powerNotice(b, { powerMode, powerDefault, isPreset });
      // crew, for every value of what the form has not read.
      const settings = powerDefault === null ? bools : [powerDefault];
      const presets = kind === 'plan' ? [true] : kind === 'none' ? [false] : isPreset === null ? bools : [isPreset];
      const drops = settings.flatMap((setting) => presets.map((preset) =>
        powerMode && repo && preset && (power ?? setting) && hc !== undefined && hc !== 'none'));
      const label = JSON.stringify({ b, powerMode, powerDefault, isPreset });
      if (drops.every((d) => !d)) expect(line, label).toBeNull();
      else if (drops.every((d) => d)) expect(line, label).toBe(POWER_WILL_DROP);
      else expect(line, label).toBe(POWER_MAY_DROP);
    }
  });
  it('a registered workflow that is not a preset runs phased: no line (codex-check 1176b)', () => {
    expect(powerNotice(body, { ...on, isPreset: false })).toBeNull();
  });
});

const REPOS = [{ id: 'wicked-studio', name: 'wicked-studio', root_path: '/tmp/studio' }];

function setup(powerModeDefault: boolean | undefined, presets: string[] = ['feature']): void {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }] });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: REPOS as never });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [{ id: 'feature', is_system: false, phases: [] }] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: powerModeDefault === undefined ? {} : { powerModeDefault } } as never);
  usePlanCatalog.setState({ presets: {} });
  vi.spyOn(teamPlanApi, 'presets').mockResolvedValue({ presets: presets.map((name) => ({ name, scope: 'global', steps: [{ catalog: 'build', id: 'build' }], created_by: 'builtin', updated_at: 1 })) } as never);
  vi.spyOn(teamPlanApi, 'previewPlan').mockRejectedValue(new client.ApiError(501, 'no preview'));
  useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown' });
  useCapabilities.setState({ loaded: true, powerMode: true });
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

describe('New job form: the line, and the body it describes is unchanged (studio#1150)', () => {
  beforeEach(() => setup(undefined));

  it('a preset launch on a daemon with power on: the line says the step gates are not kept; the body is as before', async () => {
    const user = await fill();
    expect((await screen.findByTestId('launch-power-notice')).textContent).toBe(POWER_WILL_DROP);
    await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
    await user.click(screen.getByTestId('launch-submit'));
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    const body = vi.mocked(client.api.launchRun).mock.calls[0]![0] as LaunchBodyWithDeliver & { power?: boolean };
    expect(body.power).toBeUndefined();
    expect(body.humanConfirm).toMatch(/^before:/);
  });

  it('the setting changed elsewhere: coming back to the page reads it again, in both directions (confirmation r8)', async () => {
    await fill();
    expect((await screen.findByTestId('launch-power-notice')).textContent).toBe(POWER_WILL_DROP);
    vi.mocked(client.api.getSettings).mockResolvedValue({ settings: { powerModeDefault: false } } as never);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.queryByTestId('launch-power-notice')).toBeNull());
    vi.mocked(client.api.getSettings).mockResolvedValue({ settings: { powerModeDefault: true } } as never);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.getByTestId('launch-power-notice').textContent).toBe(POWER_WILL_DROP));
  });

  it('a re-read that fails leaves the setting unknown: the line says only what may happen', async () => {
    await fill();
    await screen.findByTestId('launch-power-notice');
    vi.mocked(client.api.getSettings).mockRejectedValue(new Error('offline'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(screen.getByTestId('launch-power-notice').textContent).toBe(POWER_MAY_DROP));
  });

  it('power off in Settings: no line', async () => {
    setup(false);
    await fill();
    await waitFor(() => expect(screen.getByTestId('launch-confirm')).toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('launch-power-notice')).toBeNull();
  });

  it('a registered workflow that is not a preset: no line (it runs phased, its gates kept)', async () => {
    setup(undefined, []);
    await fill();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('launch-power-notice')).toBeNull();
  });

  it('a daemon without power mode: no line', async () => {
    setup(undefined);
    useCapabilities.setState({ powerMode: false });
    await fill();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId('launch-power-notice')).toBeNull();
  });
});
