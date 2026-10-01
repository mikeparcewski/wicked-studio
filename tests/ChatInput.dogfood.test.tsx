// Dogfood 2026-09-27, the launch screen:
//  D2  the repo picker sits beside Project on the composer row (not only in the options popover),
//      and the no-PR notice shows only for a build launch with no repo;
//  D3  launch options read the roster's `auth`: `not_required` is never "sign in needed";
//  D4  the phase picker does not offer `deliver` when the launch delivers;
//  D15 no file-attach control: a launch cannot carry files to its run, so none is offered.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { resetPlanCatalog } from '../src/store/planCatalog.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { clearRetryPrefill } from '../src/store/retryPrefill.js';

const CATALOG = ['understand', 'build', 'review', 'deliver'].map((id) => ({
  id, kind: 'build', role: id === 'build' ? 'creator' : 'neutral', gate: 'auto', gate_type: null,
  executes_code: id === 'build', executor: id === 'deliver' ? 'tool' : 'agent', validator_pin: null,
  pinned: false, evidence_floor: false, skill_ref: null, description: null,
}));

beforeEach(() => {
  vi.restoreAllMocks();
  resetPlanCatalog();
  clearRetryPrefill();
  localStorage.clear();
  useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown' });
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [
      { key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true, signed_in: true },
      // opencode on its provider free tier: the file/env heuristic says signed out, the roster's
      // `auth` says no sign-in is needed.
      { key: 'opencode', display_name: 'opencode', binary: 'opencode', enabled_for_council: true,
        signed_in: false, auth: 'not_required', free_tier: 'opencode zen' } as never,
      { key: 'codex', display_name: 'codex', binary: 'codex', enabled_for_council: true,
        signed_in: false, auth: 'signed_out' } as never,
    ],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({
    repos: [{ id: 'studio-api', name: 'studio-api', root_path: '/r/studio-api', default_branch: 'main', registered_at: 1 }],
  });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({ workflows: [{ id: 'feature', is_system: false, phases: [] }] });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'getHealth').mockResolvedValue({ status: 'ok', version: '0.7.40', ping: 'ok', capabilities: { deliverGate: true } });
  vi.spyOn(teamPlanApi, 'catalog').mockResolvedValue({ entries: CATALOG as never });
  vi.spyOn(teamPlanApi, 'presets').mockResolvedValue({ presets: [] });
  vi.spyOn(teamPlanApi, 'previewPlan').mockRejectedValue(new Error('no preview in this test'));
});

async function openOptions(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  return screen.getByRole('dialog', { name: 'Launch options' });
}

describe('D2 — the repo picker beside Project, and the no-PR notice only when it applies', () => {
  it('nothing chosen: no no-PR notice', async () => {
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(client.api.listRepos).toHaveBeenCalled());
    expect(screen.queryByTestId('deliver-notice')).toBeNull();
  });

  it('the composer row carries a repo picker; picking a repo attaches it and names the PR target', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const row = screen.getByTestId('launch-project-row');
    const picker = within(row).getByTestId('launch-repo-picker') as HTMLSelectElement;
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'studio-api' })).toBeInTheDocument());
    expect(picker.value).toBe('');

    // A build launch with no repo: the notice says there is no PR, and why.
    const options = await openOptions(user);
    await user.selectOptions(within(options).getByTestId('launch-workflow'), 'feature');
    await user.click(screen.getByRole('button', { name: /open launch options/i }));
    expect(screen.getByTestId('deliver-notice').dataset.deliverState).toBe('no-repo');

    await user.selectOptions(picker, 'studio-api');
    expect(picker.value).toBe('studio-api');
    expect(screen.getByTestId('deliver-notice').dataset.deliverState).toBe('on');
    expect(screen.getByTestId('deliver-notice').textContent).toMatch(/the origin of studio-api → opens a PR there/);

    // The launch options' tick list is kept, and agrees.
    const again = await openOptions(user);
    expect(within(again).getByTestId('launch-repo-studio-api')).toBeChecked();
  });
});

describe('D3 — launch options read the roster auth', () => {
  it('auth not_required is not "sign in needed"; auth signed_out still is', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await waitFor(() => expect(client.api.getRoster).toHaveBeenCalled());
    const options = await openOptions(user);
    await waitFor(() => expect(within(options).getByTestId('launch-seat-opencode')).toBeInTheDocument());
    expect(within(options).queryByTestId('seat-signin-opencode')).toBeNull();
    expect(within(options).getByTestId('seat-signin-codex')).toHaveTextContent('sign in needed');
  });
});

describe('D4 — the picker does not offer deliver when the launch delivers', () => {
  async function offered(): Promise<string[]> {
    await waitFor(() => expect(screen.getByTestId('phase-picker').dataset.catalogState).toBe('ready'));
    return screen.getAllByTestId('phase-option').map((b) => b.dataset.catalog ?? '');
  }

  it('no repo: deliver is offered; a repo with "Open a PR" on: it is not', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await user.click(screen.getByTestId('phase-picker-toggle'));
    expect(await offered()).toContain('deliver');

    const picker = screen.getByTestId('launch-repo-picker') as HTMLSelectElement;
    await waitFor(() => expect(within(picker).getByRole('option', { name: 'studio-api' })).toBeInTheDocument());
    await user.selectOptions(picker, 'studio-api');
    expect(await offered()).toEqual(['understand', 'build', 'review']);
  });
});

describe('D15 — no attach control that drops its files', () => {
  it('the launch options offer no file upload', async () => {
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const options = await openOptions(user);
    expect(within(options).queryByText(/choose file/i)).toBeNull();
    expect(within(options).queryByText(/upload files/i)).toBeNull();
    expect(options.querySelector('input[type="file"]')).toBeNull();
  });
});
