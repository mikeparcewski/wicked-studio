import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
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


/**
 * studio#763: the confirm line's delivery words come from the config being sent. A pending or failed
 * health read printed "after verify" for the same `auto_deliver: false` launch that read "after you
 * approve the deliver gate" once the read answered.
 */
describe('studio#763 — one wording for one delivery config', () => {
  for (const [name, health] of [
    ['the health read has not answered yet', () => new Promise<never>(() => {})],
    ['the health read failed', () => Promise.reject(new Error('Failed to fetch'))],
  ] as const) {
    it(`says "after you approve the deliver gate" while ${name}`, async () => {
      vi.spyOn(client.api, 'getHealth').mockImplementation(health as never);
      const user = userEvent.setup();
      render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
      await bind(user, { workflow: 'feature', repo: 'studio-api' });
      const line = screen.getByTestId('launch-confirm-deliver');
      expect(line.textContent).toBe('after you approve the deliver gate');
      expect(line.dataset.deliverGate).toBe('human');
      expect(screen.getByTestId('deliver-notice').textContent).toMatch(/pauses at the deliver gate/i);
      expect(document.body.textContent).not.toMatch(/after verify/i);
    });
  }
});
