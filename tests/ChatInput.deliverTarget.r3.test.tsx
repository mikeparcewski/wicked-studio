// R3 (ship-prove-3) — on a LOCAL-origin repo the launch composer said "…approve it and the run
// pushes its branch → opens a PR on shipproof-local", which was false; only the deliver gate,
// later, said the truth. The launch wording now comes from the same origin preflight the gate uses
// (crew#730), served by crew's `GET /repos/:id/deliver-target`: the gate's own sentence, verbatim.
// A daemon that cannot answer (older crew, a read error) gets a CONDITIONAL sentence, never a
// promise.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatInput } from '../src/components/ChatInput.js';
import * as client from '../src/api/client.js';
import { DEFAULT_COMPOSER_PREFS, useComposerPrefsStore } from '../src/store/composerPrefs.js';
import { clearRetryPrefill } from '../src/store/retryPrefill.js';
import { deliverPreview } from '../src/board/undoQueue.js';

const LOCAL_SENTENCE =
  'Pushes the run branch to origin (/srv/proof/remote.git) — a local path, so no pull request can be opened against it: unless another remote in this checkout is a GitHub repository gh resolves, the pushed branch IS the delivery.';
const GH_SENTENCE =
  'Pushes the run branch to mikeparcewski/shipproof-scratch-20261001 on GitHub and opens a pull request there; merge stays human.';

beforeEach(() => {
  vi.restoreAllMocks();
  vi.spyOn(client.api, 'getRoster').mockResolvedValue({
    roster: [{ key: 'claude', display_name: 'claude', binary: 'claude', enabled_for_council: true }],
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
  localStorage.clear();
  clearRetryPrefill();
});

async function bind(user: ReturnType<typeof userEvent.setup>): Promise<void> {
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
  await waitFor(() => expect(screen.getByTestId('launch-workflow')).toBeInTheDocument());
  await user.selectOptions(screen.getByTestId('launch-workflow'), 'feature');
  await user.click(screen.getByTestId('launch-repo-shipproof-local'));
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
}

describe('the launch deliver notice reads the gate\'s origin preflight (R3)', () => {
  it('a LOCAL origin: says no pull request can be opened, never "opens a PR on"', async () => {
    const spy = vi.spyOn(client.api, 'getDeliverTarget').mockResolvedValue({
      repo: 'shipproof-local', origin: 'local', githubRepo: null, sentence: LOCAL_SENTENCE,
    });
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user);
    await waitFor(() =>
      expect(screen.getByTestId('deliver-notice').textContent).toContain('no pull request can be opened against it'),
    );
    const text = screen.getByTestId('deliver-notice').textContent ?? '';
    expect(spy).toHaveBeenCalledWith('shipproof-local');
    expect(text).toContain('pauses at the deliver gate');
    expect(text).toContain('/srv/proof/remote.git');
    expect(text).not.toMatch(/opens a PR/);
    expect(screen.getByTestId('deliver-notice').dataset.deliverOrigin).toBe('local');
  });

  it('a GITHUB origin: names owner/repo the pull request opens on', async () => {
    vi.spyOn(client.api, 'getDeliverTarget').mockResolvedValue({
      repo: 'shipproof-local', origin: 'github', githubRepo: 'mikeparcewski/shipproof-scratch-20261001', sentence: GH_SENTENCE,
    });
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user);
    await waitFor(() =>
      expect(screen.getByTestId('deliver-notice').textContent).toContain(
        'pushes the run branch to mikeparcewski/shipproof-scratch-20261001 on GitHub and opens a pull request there',
      ),
    );
  });

  it('an origin the daemon cannot read (older crew) is stated as a condition, not a promise', async () => {
    vi.spyOn(client.api, 'getDeliverTarget').mockResolvedValue(null);
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user);
    const text = screen.getByTestId('deliver-notice').textContent ?? '';
    expect(text).toContain('opens a PR on shipproof-local if its origin is a GitHub repository');
    expect(screen.getByTestId('deliver-notice').dataset.deliverOrigin).toBe('unknown');
  });
});

describe('the deliver approve toast says what the gate card says (R1/R3)', () => {
  it('leads with the card sentence when the gate carries one — no PR promised on a local origin', () => {
    const card = LOCAL_SENTENCE.replace('the run branch', 'branch wicked/r1');
    expect(deliverPreview({ branch: 'wicked/r1', repo: 'shipproof-local', card })).toBe(card);
    // No card (a def authored without one): today's reading.
    expect(deliverPreview({ branch: 'wicked/r1', repo: 'acme/x' })).toBe(
      "Pushes branch wicked/r1 and opens a pull request on acme/x, under the daemon's GitHub sign-in.",
    );
  });
});
