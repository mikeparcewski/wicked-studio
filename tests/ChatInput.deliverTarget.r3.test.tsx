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
import type { DeliverTargetResponse } from '../src/api/types.js';
import { pickLaunchWorkflow } from './launchWorkflowPick.js';

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
  // S19b: the workflow is named in the problem box (`/` → the menu), before the options drawer.
  await pickLaunchWorkflow(user, 'feature');
  await user.click(screen.getByRole('button', { name: /open launch options/i }));
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
    expect(text).toContain('pushes its branch to the origin of shipproof-local → opens a PR there if that origin is a GitHub repository');
    expect(screen.getByTestId('deliver-notice').dataset.deliverOrigin).toBe('unknown');
    // A registered name is no proof of where a pull request would open (codex review).
    expect(text).not.toContain('opens a PR on');
  });
});

describe('a repeat lookup never shows the previous answer while a fresh read is in flight (codex review, MEDIUM)', () => {
  it('A → B (in flight) → A: while A is re-read, the notice is the condition, not A\'s old sentence', async () => {
    vi.mocked(client.api.listRepos).mockResolvedValue({
      repos: [
        { id: 'shipproof-local', name: 'shipproof-local', root_path: '/srv/proof/repo-local' } as never,
        { id: 'other', name: 'other', root_path: '/srv/proof/other' } as never,
      ],
    });
    const spy = vi
      .spyOn(client.api, 'getDeliverTarget')
      .mockResolvedValueOnce({ repo: 'shipproof-local', origin: 'local', githubRepo: null, sentence: LOCAL_SENTENCE })
      // B's read is still in flight when the operator goes back to A, and so is A's re-read.
      .mockReturnValueOnce(new Promise(() => {}))
      .mockReturnValueOnce(new Promise(() => {}));
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user);
    await waitFor(() => expect(screen.getByTestId('deliver-notice').dataset.deliverOrigin).toBe('local'));
    const toggle = async (id: string): Promise<void> => {
      await user.click(screen.getByRole('button', { name: /open launch options/i }));
      await user.click(screen.getByTestId(`launch-repo-${id}`));
      await user.click(screen.getByRole('button', { name: /open launch options/i }));
    };
    await toggle('shipproof-local');
    await toggle('other');
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    await toggle('other');
    await toggle('shipproof-local');
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    const notice = screen.getByTestId('deliver-notice');
    expect(notice.dataset.deliverOrigin).toBe('unknown');
    expect(notice.textContent).toContain('if that origin is a GitHub repository');
    expect(notice.textContent).not.toContain('no pull request can be opened');
  });
});

describe('the deliver approve toast says what the gate card says (R1/R3)', () => {
  it('leads with the card sentence when the gate carries one — no PR promised on a local origin', () => {
    const card = LOCAL_SENTENCE.replace('the run branch', 'branch wicked/r1');
    expect(deliverPreview({ branch: 'wicked/r1', repo: 'shipproof-local', card })).toBe(card);
    // No card (a def authored without one): today's reading.
    // No card (a lift retry, the palette): the PR is a condition, and the label names whose origin.
    expect(deliverPreview({ branch: 'wicked/r1', repo: 'acme/x' })).toBe(
      "Pushes branch wicked/r1 to the origin of acme/x, under the daemon's GitHub sign-in; a pull request opens only if that origin is a GitHub repository.",
    );
  });
});

// R3b (ship-prove-4): the notice was right, but the checkbox right above it still read "Open a PR
// when done" on a local origin, where no pull request can be opened. The label now reads off the
// same origin preflight as the notice: it promises a PR only on a GitHub origin.
describe('the launch deliver checkbox label reads the same origin preflight (R3b)', () => {
  const label = (): string => screen.getByTestId('deliver-toggle-row').textContent?.trim() ?? '';
  const cases: Array<[string, DeliverTargetResponse | null, string]> = [
    ['a GitHub origin', { repo: 'shipproof-local', origin: 'github', githubRepo: 'mikeparcewski/shipproof-scratch-20261001', sentence: GH_SENTENCE }, 'Open a PR when done'],
    ['a LOCAL origin', { repo: 'shipproof-local', origin: 'local', githubRepo: null, sentence: LOCAL_SENTENCE }, 'Push the branch when done'],
    ['a non-GitHub host', { repo: 'shipproof-local', origin: 'other', githubRepo: null, sentence: 'Pushes the run branch to origin (git.example.com) and opens a pull request only if gh resolves git.example.com as a GitHub host it is logged in to; otherwise no pull request is opened and the pushed branch IS the delivery. Merge stays human.' }, 'Push the branch when done'],
    ['no origin remote', { repo: 'shipproof-local', origin: 'none', githubRepo: null, sentence: 'Pushes the run branch to origin — but this repository has no `origin` remote, so the push will fail and nothing will be delivered. Add the remote first.' }, 'Deliver when done (needs an origin remote)'],
    ['an origin the daemon cannot read', null, 'Deliver when done'],
  ];
  for (const [what, view, want] of cases) {
    it(`${what}: "${want}"`, async () => {
      vi.spyOn(client.api, 'getDeliverTarget').mockResolvedValue(view);
      const user = userEvent.setup();
      render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
      await bind(user);
      await waitFor(() => expect(screen.getByTestId('deliver-notice').dataset.deliverOrigin).toBe(view?.origin ?? 'unknown'));
      expect(label()).toBe(want);
      if (want !== 'Open a PR when done') expect(label()).not.toMatch(/\bPR\b|pull request/i);
      if (view?.origin === 'none') expect(label()).not.toMatch(/^Push/);
    });
  }

  it('while the origin is still being read, the label promises no PR', async () => {
    vi.spyOn(client.api, 'getDeliverTarget').mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user);
    expect(label()).toBe('Deliver when done');
  });
});

describe('R3b — an origin crew answers as "unknown" (Copilot)', () => {
  it('reads "Deliver when done" once the unknown answer has landed', async () => {
    const spy = vi.spyOn(client.api, 'getDeliverTarget').mockResolvedValue({
      repo: 'shipproof-local', origin: 'unknown', githubRepo: null,
      sentence: 'Pushes the run branch to origin and opens a pull request; merge stays human.',
    });
    const user = userEvent.setup();
    render(<ChatInput runId={null} runStatus={null} onLaunched={vi.fn()} />);
    await bind(user);
    await waitFor(() => expect(spy).toHaveBeenCalledWith('shipproof-local'));
    // The answer has landed: the notice carries crew's sentence for it.
    await waitFor(() => expect(screen.getByTestId('deliver-notice').textContent).toContain('pushes the run branch to origin'));
    expect(screen.getByTestId('deliver-toggle-row').textContent?.trim()).toBe('Deliver when done');
  });
});
