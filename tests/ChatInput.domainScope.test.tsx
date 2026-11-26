/**
 * J6 S1 (codex S1 r1, class 7): the composer's own launch of a domain model run sends the words typed as its scope
 * (crew refuses a domain-extraction launch without one), and another workflow's launch carries none. This drives the
 * real composer send, not the helper alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({ repos: [{ id: 'payroll', name: 'payroll', root_path: '/srv/payroll' } as never] });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({
    workflows: [{ id: 'domain-extraction', is_system: false, phases: [{ id: 'domain-run' }] }, { id: 'feature', is_system: false, phases: [] }] as never,
  });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'launchRun').mockResolvedValue({ runId: 'r-new' });
  vi.spyOn(client.api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.7.33', ping: 'ok', capabilities: { deliverGate: true } });
  useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown' });
  localStorage.clear();
  clearRetryPrefill();
});

async function launch(workflow: string, words: string): Promise<Record<string, unknown>> {
  const user = userEvent.setup();
  render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
  await pickLaunchWorkflow(user, workflow);
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  await user.click(screen.getByTestId('launch-repo-payroll'));
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  await user.type(screen.getByTestId('launch-problem'), words);
  await waitFor(() => expect(screen.getByTestId('launch-submit')).toBeEnabled());
  await user.click(screen.getByTestId('launch-submit'));
  await waitFor(() => expect(client.api.launchRun).toHaveBeenCalledTimes(1));
  return vi.mocked(client.api.launchRun).mock.calls[0]![0] as unknown as Record<string, unknown>;
}

describe('the composer launch of a domain model (J6 S1)', () => {
  it('sends the words as the scope', async () => {
    const sent = await launch('domain-extraction', 'How PAYCALC1 computes pay');
    expect(sent['workflow']).toBe('domain-extraction');
    expect(sent['repoRef']).toBe('payroll');
    expect(sent['domainScope']).toEqual({ intent: 'How PAYCALC1 computes pay' });
  });

  it('sends no scope for another workflow', async () => {
    const sent = await launch('feature', 'fix the 500');
    expect(sent['workflow']).toBe('feature');
    expect(sent).not.toHaveProperty('domainScope');
  });
});
