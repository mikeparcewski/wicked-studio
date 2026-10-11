import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { DEFAULT_VIEW_PREFS, useViewPrefsStore } from '../src/store/viewPrefs.js';
import { clearRetryPrefill, setRetryPrefill } from '../src/store/retryPrefill.js';
import { pickLaunchWorkflow } from './launchWorkflowPick.js';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [
      { key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true },
      { key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: false },
      { key: 'claude-judge', display_name: 'Claude Code (judge)', binary: 'claude', enabled_for_council: false },
      { key: 'wicked-estate', display_name: 'Estate', binary: '', enabled_for_council: false },
    ],
  });
  vi.spyOn(client.api, 'listRepos').mockResolvedValue({
    repos: [{ id: 'shipproof-local', name: 'shipproof-local', root_path: '/srv/proof/repo-local' } as never],
  });
  vi.spyOn(client.api, 'listWorkflows').mockResolvedValue({
    workflows: [{ id: 'feature', is_system: false, phases: [] }],
  });
  vi.spyOn(client.api, 'listProjects').mockResolvedValue({ projects: [] });
  vi.spyOn(client.api, 'getHealth').mockResolvedValue({
    status: 'ok', version: '0.7.43', ping: 'ok', capabilities: { deliverGate: true },
  });
  useComposerPrefsStore.setState({ prefs: DEFAULT_COMPOSER_PREFS, loaded: true, persist: 'unknown' });
  useViewPrefsStore.setState({ prefs: DEFAULT_VIEW_PREFS, loaded: true, persist: 'unknown' });
  localStorage.clear();
  clearRetryPrefill();
});

describe('ChatInput default-layer copy', () => {
  it('names an empty helper selection', async () => {
    localStorage.setItem('wicked_default_clis', JSON.stringify([]));
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    expect(await screen.findByText('No helpers picked')).toBeInTheDocument();
    expect(screen.queryByText(/^CLIs:/)).not.toBeInTheDocument();
  });

  it('names helpers in roster order and offers only coding helpers', async () => {
    localStorage.setItem('wicked_default_clis', JSON.stringify(['codex', 'claude']));
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    const pill = await screen.findByText('Helpers: Claude Code, Codex');
    expect(pill).not.toHaveClass('font-mono');
    await user.click(screen.getByRole('button', { name: /open launch options/i }));
    expect(screen.getByTestId('launch-seat-claude')).toBeInTheDocument();
    expect(screen.getByTestId('launch-seat-codex')).toBeInTheDocument();
    expect(screen.queryByTestId('launch-seat-claude-judge')).not.toBeInTheDocument();
    expect(screen.queryByTestId('launch-seat-wicked-estate')).not.toBeInTheDocument();
  });

  it('keeps the retry id in hover details', () => {
    setRetryPrefill({
      retryOf: 'r-original', problem: 'redo it', clis: ['claude'], workflowId: null,
      repoRef: null, entityMode: 'shared', humanConfirm: 'none', projectId: null,
    });
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    expect(screen.getByText('Retry of an earlier run')).toHaveAttribute('title', 'r-original');
    expect(screen.queryByText(/r-origin/)).not.toBeInTheDocument();
  });

  it('abbreviates the home path in the crew delivery sentence', async () => {
    vi.spyOn(client.api, 'getDeliverTarget').mockResolvedValue({
      repo: 'shipproof-local', origin: 'local', githubRepo: null,
      sentence: 'Pushes the run branch to origin (/root/x/origins/r.git) — a local path, so no pull request can be opened against it.',
    });
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await pickLaunchWorkflow(user, 'feature');
    await user.click(screen.getByRole('button', { name: /open launch options/i }));
    await user.click(screen.getByTestId('launch-repo-shipproof-local'));
    await user.click(screen.getByRole('button', { name: /open launch options/i }));
    await waitFor(() => expect(screen.getByTestId('deliver-notice')).toHaveTextContent('~/x/origins/r.git'));
    expect(screen.getByTestId('deliver-notice')).not.toHaveTextContent('/root/');
  });
});
