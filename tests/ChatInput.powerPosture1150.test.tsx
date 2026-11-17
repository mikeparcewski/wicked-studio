import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput, POWER_GATE_WORDS, POWER_NO_GATE_WORDS } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { clearRetryPrefill, setRetryPrefill } from '../src/store/retryPrefill.js';
import { POWER_NO_HANDOFF_WORDS } from '../src/components/ChatInput.js';
import { pickLaunchWorkflow } from './launchWorkflowPick.js';

/**
 * studio#1150: a power launch never holds before its first step (crew sets humanConfirm none; it asks once, at hand-off).
 * The New job form must say so — never "gate: first gate" — and its Power switch is the one way to keep a step gate.
 */

const REPOS = [{ id: 'wicked-studio', name: 'wicked-studio', root_path: '/tmp/studio' }];

function setup(powerModeDefault: boolean | undefined | 'fail', powerCap = true): void {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: REPOS as never });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [{ id: 'feature', is_system: false, phases: [] }, { id: 'onboarding', is_system: true, phases: [] }] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  // The engine keeps a deliver gate (crew ≥ 0.7.33): the body's `deliverGate: 'auto'` is the only unattended opt-out.
  vi.spyOn(client.api, 'getHealth').mockResolvedValue({ ok: true, capabilities: { deliverGate: true, revisesPr: false } } as never);
  if (powerModeDefault === 'fail') vi.spyOn(client.api, 'getSettings').mockRejectedValue(new Error('offline'));
  else vi.spyOn(client.api, 'getSettings').mockResolvedValue({ settings: powerModeDefault === undefined ? {} : { powerModeDefault } } as never);
  useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown' });
  useCapabilities.setState({ loaded: true, powerMode: powerCap });
  localStorage.clear();
  clearRetryPrefill();
}

async function fill(opts: { mode?: 'ask' | 'autonomous'; workflow?: string } = {}): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} {...(opts.mode !== undefined ? { mode: opts.mode } : {})} />);
  await pickLaunchWorkflow(user, opts.workflow ?? 'feature');
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

  it('power on (the default): the posture reads "At hand-off (power mode)" and no power key is sent', async () => {
    const user = await fill();
    await waitFor(() => expect(screen.getByTestId('launch-confirm-gate').textContent).toBe(POWER_GATE_WORDS));
    expect(screen.queryByTestId('gate-posture')).toBeNull();
    expect((screen.getByTestId('gate-posture-power') as HTMLSelectElement).selectedOptions[0]!.textContent).toBe('At hand-off (power mode)');
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

  it('off then on again follows the setting: no power key is sent', async () => {
    const user = await fill();
    await user.click(await screen.findByTestId('launch-power-toggle'));
    await user.click(screen.getByTestId('launch-power-toggle'));
    expect(screen.getByTestId('launch-confirm-gate').textContent).toBe(POWER_GATE_WORDS);
    expect((await send(user)).power).toBeUndefined();
  });

  it('power on with "Never": no gate at all is promised', async () => {
    const user = await fill();
    await user.selectOptions(await screen.findByTestId('gate-posture-power'), 'none');
    expect(screen.getByTestId('launch-confirm-gate').textContent).toBe(POWER_NO_GATE_WORDS);
    const body = await send(user);
    expect(body.power).toBeUndefined();
    expect((body as { deliverGate?: string }).deliverGate).toBe('auto');
  });

  it('Autonomous mode under power: the selector shows Never, cannot pick At hand-off, and the body delivers on its own', async () => {
    const user = await fill({ mode: 'autonomous' });
    await waitFor(() => expect(screen.getByTestId('launch-confirm-gate').textContent).toBe(POWER_NO_GATE_WORDS));
    const select = screen.getByTestId('gate-posture-power') as HTMLSelectElement;
    expect(select.value, 'what the selector shows is what is sent').toBe('none');
    expect(select).toBeDisabled();
    // codex-check: before, "At hand-off" could be picked here while the body still sent deliverGate: 'auto'.
    await user.selectOptions(select, 'before').catch(() => undefined);
    expect(select.value).toBe('none');
    expect(screen.getByTestId('launch-confirm-gate').textContent).toBe(POWER_NO_GATE_WORDS);
    const body = await send(user);
    expect(body.power).toBeUndefined();
    expect((body as { deliverGate?: string }).deliverGate, 'Never: it delivers on its own').toBe('auto');
  });

  it('Autonomous mode never offers the Power switch: a phased step gate is not something it keeps (codex-check r3)', async () => {
    await fill({ mode: 'autonomous' });
    await screen.findByTestId('gate-posture-power');
    expect(screen.queryByTestId('launch-power-toggle')).toBeNull();
    expect(screen.queryByTestId('gate-posture')).toBeNull();
  });

  it('Autonomous with the health read failed: the hand-off gate the body keeps is what it shows (codex-check r3)', async () => {
    vi.mocked(client.api.getHealth).mockRejectedValue(new Error('offline'));
    const user = await fill({ mode: 'autonomous' });
    const select = await screen.findByTestId('gate-posture-power') as HTMLSelectElement;
    await waitFor(() => expect(screen.getByTestId('launch-confirm-gate').textContent).toBe(POWER_GATE_WORDS));
    expect(select.value).toBe('before');
    expect(select.title, 'the tooltip says the gate stays, never "not even at hand-off"').toMatch(/hand-off gate stays/);
    const body = await send(user);
    expect((body as { deliverGate?: string }).deliverGate, 'no auto: the engine keeps its deliver gate').toBeUndefined();
  });

  it('delivery off: no hand-off, said the same in the selector, the summary and the body (confirmation r4)', async () => {
    const user = await fill();
    await screen.findByTestId('gate-posture-power');
    await user.click(screen.getByTestId('deliver-toggle'));
    const select = screen.getByTestId('gate-posture-power') as HTMLSelectElement;
    expect(select.value).toBe('no-handoff');
    expect(select).toBeDisabled();
    expect(screen.getByTestId('launch-confirm-gate').textContent).toBe(POWER_NO_HANDOFF_WORDS);
    expect((await send(user)).deliver).toBe('none');
  });

  it('a revision delivers onto its PR whatever the toggle says: the hand-off it keeps is what it shows (confirmation r4)', async () => {
    vi.mocked(client.api.getHealth).mockResolvedValue({ ok: true, capabilities: { deliverGate: true, revisesPr: true } } as never);
    setRetryPrefill({ retryOf: null, problem: 'Revise PR #42 (b): add the retry card', clis: ['claude'], workflowId: 'feature', repoRef: 'wicked-studio',
      entityMode: 'shared', humanConfirm: { before: 1 }, projectId: null, revisesPr: { number: 42, title: 'add the retry card', headRef: 'b' } });
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    // The pre-fill carries the workflow and the repository.
    await waitFor(() => expect(screen.getByTestId('launch-workflow-pill').dataset.workflow).toBe('feature'));
    const toggle = await screen.findByTestId('deliver-toggle') as HTMLInputElement;
    if (toggle.checked) await user.click(toggle);
    await waitFor(() => expect(screen.getByTestId('launch-confirm-gate').textContent).toBe(POWER_GATE_WORDS));
    const body = await send(user);
    expect(body.deliver).toBe('pr');
    expect((body as { revisesPr?: number }).revisesPr).toBe(42);
    expect((body as { deliverGate?: string }).deliverGate).toBeUndefined();
  });

  for (const [label, mode, pick] of [['Balanced + Never', undefined, true], ['Autonomous', 'autonomous', false]] as const) {
    it(`a revision with the toggle off, ${label}: no gate shown, and the body opts out of the deliver gate (confirmation r5)`, async () => {
      vi.mocked(client.api.getHealth).mockResolvedValue({ ok: true, capabilities: { deliverGate: true, revisesPr: true } } as never);
      setRetryPrefill({ retryOf: null, problem: 'Revise PR #42 (b): add the retry card', clis: ['claude'], workflowId: 'feature', repoRef: 'wicked-studio',
        entityMode: 'shared', humanConfirm: { before: 1 }, projectId: null, revisesPr: { number: 42, title: 'add the retry card', headRef: 'b' } });
      const user = userEvent.setup();
      render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} {...(mode !== undefined ? { mode } : {})} />);
      await waitFor(() => expect(screen.getByTestId('launch-workflow-pill').dataset.workflow).toBe('feature'));
      const toggle = await screen.findByTestId('deliver-toggle') as HTMLInputElement;
      if (toggle.checked) await user.click(toggle);
      if (pick) await user.selectOptions(await screen.findByTestId('gate-posture-power'), 'none');
      await waitFor(() => expect(screen.getByTestId('launch-confirm-gate').textContent).toBe(POWER_NO_GATE_WORDS));
      const body = await send(user);
      expect(body.deliver).toBe('pr');
      expect((body as { deliverGate?: string }).deliverGate, 'what was shown: it delivers on its own').toBe('auto');
    });
  }

  it('what the power selector shows is what the body sends (At hand-off keeps the deliver gate; Never sends deliverGate auto)', async () => {
    const user = await fill();
    const select = await screen.findByTestId('gate-posture-power') as HTMLSelectElement;
    expect(select.value).toBe('before');
    const body = await send(user);
    expect((body as { deliverGate?: string }).deliverGate).toBeUndefined();
  });

  it('Ask mode (every step) is never a power launch: its posture shows and the body says power: false', async () => {
    const user = await fill({ mode: 'ask' });
    expect(screen.queryByTestId('launch-power-toggle')).toBeNull();
    expect(screen.getByTestId('launch-confirm-gate').textContent).toBe('every unit');
    expect((await send(user)).power).toBe(false);
  });

  it('a settings read that failed asserts nothing about power: the form reads as before', async () => {
    setup('fail');
    await fill();
    expect(screen.queryByTestId('launch-power-toggle')).toBeNull();
    expect(screen.getByTestId('gate-posture')).toBeInTheDocument();
    expect(screen.getByTestId('launch-confirm-gate').textContent).toBe('first gate');
  });

  it('the setting off: the posture select shows, as before, and nothing is sent about power', async () => {
    setup(false);
    const user = await fill();
    await waitFor(() => expect(screen.getByTestId('launch-confirm-gate').textContent).toBe('first gate'));
    expect(screen.getByTestId('gate-posture')).toBeInTheDocument();
    expect(screen.queryByTestId('launch-power-toggle'), 'the setting off: no new switch').toBeNull();
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
