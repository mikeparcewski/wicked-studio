import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import type { LaunchBodyWithDeliver } from '../src/api/types.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { clearRetryPrefill } from '../src/store/retryPrefill.js';
import { pickLaunchWorkflow } from './launchWorkflowPick.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({
    repos: [{ id: 'studio-api', name: 'studio-api', root_path: '/tmp/studio-api' } as never],
  });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({
    workflows: [{ id: 'feature', is_system: false, phases: [] }],
  });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  // A daemon that KEEPS the deliver gate (crew ≥ 0.7.33 on core-ts ≥ 0.7.24) — the F-E2E-030
  // cases below assume it; the capability-absent case overrides this mock.
  vi.spyOn(client.api, 'getHealth').mockResolvedValue({
    status: 'ok', version: '0.7.33', ping: 'ok', capabilities: { deliverGate: true },
  });
  // The default-ON preference, as a fresh install loads it (no stored key).
  useComposerPrefsStore.setState({
    prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown',
  });
  localStorage.clear();
  clearRetryPrefill();
});

/** Bind workflow and/or repo through the launch options drawer — the controls
 *  the operator actually uses, not a prefill shortcut. */
async function bind(
  user: ReturnType<typeof userEvent.setup>,
  opts: { workflow?: string; repo?: string },
): Promise<void> {
  // S19b: the workflow is named in the problem box (`/` → the menu), before the options drawer.
  if (opts.workflow !== undefined) await pickLaunchWorkflow(user, opts.workflow);
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  if (opts.repo !== undefined) {
    await user.click(screen.getByTestId(`launch-repo-${opts.repo}`));
  }
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
}


async function send(user: ReturnType<typeof userEvent.setup>, text: string): Promise<void> {
  await user.type(screen.getByTestId('launch-problem'), text);
  await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
  await user.click(screen.getByTestId('launch-submit'));
}

function sentBody(): LaunchBodyWithDeliver {
  return vi.mocked(client.api.launchRun).mock.calls[0]![0];
}

/**
 * studio#763: the confirm line's delivery words come from the config being sent. A pending or failed
 * health read printed "after verify" for the same `auto_deliver: false` launch that read "after you
 * approve the deliver gate" once the read answered.
 */
describe('studio#763 — one wording for one delivery config, matching the body', () => {
  it('a failed health read: the default posture says the gate, and the body sends no opt-out', async () => {
    vi.spyOn(client.api, 'getHealth').mockRejectedValue(new Error('Failed to fetch'));
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user, { workflow: 'feature', repo: 'studio-api' });
    const line = await screen.findByTestId('launch-confirm-deliver');
    expect(line.textContent).toBe('after you approve the deliver gate');
    expect(screen.getByTestId('deliver-notice').textContent).toMatch(/pauses at the deliver gate/i);
    expect(document.body.textContent).not.toMatch(/after verify/i);
    await send(user, 'ship it');
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(sentBody().deliverGate).toBeUndefined();
  });

  it('a pending health read holds a delivering launch: nothing is promised that the body could contradict (codex r1)', async () => {
    vi.spyOn(client.api, 'getHealth').mockImplementation(() => new Promise<never>(() => {}));
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user, { workflow: 'feature', repo: 'studio-api' });
    await user.type(screen.getByTestId('launch-problem'), 'ship it');
    expect(screen.getByTestId('launch-submit')).toBeDisabled();
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(client.api.launchRun).not.toHaveBeenCalled();
  });

  it('auto-deliver words appear only when the body carries the opt-out (a daemon that keeps the gate)', async () => {
    vi.spyOn(client.api, 'getHealth').mockRejectedValue(new Error('Failed to fetch'));
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user, { workflow: 'feature', repo: 'studio-api' });
    await user.selectOptions(screen.getByTestId('gate-posture'), 'none');
    // The read failed: the body cannot carry the opt-out, so a current daemon keeps its gate — said so.
    const line = await screen.findByTestId('launch-confirm-deliver');
    expect(line.dataset.deliverGate).toBe('human');
    expect(line.textContent).toBe('after you approve the deliver gate');
    expect(screen.getByTestId('deliver-notice').textContent).not.toMatch(/auto-deliver/i);
    await send(user, 'ship it');
    await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
    expect(sentBody().deliverGate).toBeUndefined();
  });
});
