import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { RepoEntry, SessionView } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * studio#1161: a repository's page left open through an onboarding follows App's live run list. Its run-derived
 * states (Code graph mark, Working now, Recent jobs, the Jobs tab) track the list, and a run of THIS repository
 * going from in flight to finished reads the repository and its graph again, once. Another repository's run
 * finishing re-reads nothing.
 */

const REPO: RepoEntry = { id: 'billing', name: 'billing', root_path: '/tmp/billing', default_branch: 'main', registered_at: 1_700_000_000 };
const running = makeView({ id: 'o-1', repo_ref: 'billing', workflow_id: 'onboarding', status: 'executing', problem: 'Onboard billing', created_at: 100 });
const done = makeView({ id: 'o-1', repo_ref: 'billing', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard billing', created_at: 100 });
const otherRunning = makeView({ id: 'x-1', repo_ref: 'other', workflow_id: 'onboarding', status: 'executing', problem: 'Onboard other', created_at: 200 });
const otherDone = makeView({ id: 'x-1', repo_ref: 'other', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard other', created_at: 200 });

const listRepos = vi.fn(() => Promise.resolve({ repos: [REPO] }));
const listRuns = vi.fn((): Promise<{ runs: SessionView[] }> => Promise.resolve({ runs: [running, otherRunning] }));
const getRepoGraph = vi.fn(() => Promise.resolve({ graph: null }));

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listRuns: () => listRuns(),
    getRepoGraph: () => getRepoGraph(),
    getRepoGitHistory: () => Promise.resolve({ commits: [] }),
    getRepoContributors: () => Promise.resolve({ contributors: [] }),
    getGraphKindsForRepo: () => Promise.resolve({ kinds: [] }),
    listRequirements: () => Promise.reject(new Error('no requirements in this suite')),
    listProjects: () => Promise.resolve({ projects: [] }),
    listApps: () => Promise.resolve({ apps: [] }),
  },
  apiFetch: () => Promise.reject(new Error('not in this suite')),
}));

const { RepoDetailPage } = await import('../src/components/RepoDetailPage.js');
const { resetRepoLinks } = await import('../src/store/repoLinks.js');
const { resetRepoKnowledge } = await import('../src/store/repoKnowledge.js');

function ui(liveRuns: readonly SessionView[]): React.ReactElement {
  return <RepoDetailPage repoId="billing" onSelectRun={() => {}} navigate={() => {}} onOpenGraph={() => {}} liveRuns={liveRuns} />;
}

beforeEach(() => {
  resetRepoLinks();
  resetRepoKnowledge();
  listRepos.mockClear();
  getRepoGraph.mockClear();
});
afterEach(cleanup);

describe('RepoDetailPage follows the live run list (studio#1161)', () => {
  it('a run running at load that then completes: no indexing now / Working, and one re-read of repo and graph', async () => {
    const { rerender } = render(ui([running, otherRunning]));
    await screen.findByTestId('repo-overview-working');
    expect(document.body.textContent).toMatch(/indexing now/i);
    expect(listRepos).toHaveBeenCalledTimes(1);
    expect(getRepoGraph).toHaveBeenCalledTimes(1);

    rerender(ui([done, otherRunning]));
    await waitFor(() => expect(screen.queryByTestId('repo-overview-working')).toBeNull());
    expect(document.body.textContent).not.toMatch(/indexing now/i);
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(2));
    expect(getRepoGraph).toHaveBeenCalledTimes(2);

    // A further list that changes nothing for this repo reads nothing more.
    rerender(ui([done, otherRunning, makeView({ id: 'y', repo_ref: 'other', status: 'executing', created_at: 300 })]));
    await new Promise((r) => setTimeout(r, 20));
    expect(listRepos).toHaveBeenCalledTimes(2);
    expect(getRepoGraph).toHaveBeenCalledTimes(2);
  });

  it('a run of another repository finishing triggers no re-read', async () => {
    const { rerender } = render(ui([running, otherRunning]));
    await screen.findByTestId('repo-overview-working');
    rerender(ui([running, otherDone]));
    await new Promise((r) => setTimeout(r, 20));
    expect(listRepos).toHaveBeenCalledTimes(1);
    expect(getRepoGraph).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('repo-overview-working')).toBeTruthy();
  });

  it('a run the live list has not heard of yet stays on the page (the read is overlaid, not replaced)', async () => {
    const { rerender } = render(ui([]));
    await screen.findByTestId('repo-overview-working');
    rerender(ui([otherRunning]));
    expect(screen.getByTestId('repo-overview-working')).toBeTruthy();
  });
});
