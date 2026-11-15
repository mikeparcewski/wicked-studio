import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { GraphKind, RepoEntry, SessionView } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * studio#1161 cross-model review (the five P2 findings): the repo page's re-read on a run finishing.
 *  1. The Code graph size (knowledge store) is re-read on the in-flight → finished transition, not left stale.
 *  2. A fetched-only run archived out of the live list is not resurrected.
 *  3. A working live list clears the page's own failed /runs read.
 *  4. One failed re-read (repo or graph) does not discard the other's success.
 *  5. Only the newest re-read of the current visit may land its answer.
 */

const REPO: RepoEntry = { id: 'billing', name: 'billing', root_path: '/tmp/billing', default_branch: 'main', registered_at: 1_700_000_000 };
const REPO_B: RepoEntry = { id: 'shipping', name: 'shipping', root_path: '/tmp/shipping', default_branch: 'main', registered_at: 1_700_000_000 };
const running = makeView({ id: 'o-1', repo_ref: 'billing', workflow_id: 'onboarding', status: 'executing', problem: 'Onboard billing', created_at: 100 });
const done = makeView({ id: 'o-1', repo_ref: 'billing', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard billing', created_at: 100 });
const onb = (id: string, status: SessionView['session']['status'], at: number): SessionView =>
  makeView({ id, repo_ref: 'billing', workflow_id: 'onboarding', status, problem: 'Onboard billing', created_at: at });

const listRepos = vi.fn(() => Promise.resolve({ repos: [REPO] }));
const listRuns = vi.fn((): Promise<{ runs: SessionView[] }> => Promise.resolve({ runs: [] }));
const getRepoGraph = vi.fn(() => Promise.resolve({ graph: null }));
let kindsAnswer: GraphKind[] = [];
const getGraphKindsForRepo = vi.fn(() => Promise.resolve({ kinds: kindsAnswer }));

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listRuns: () => listRuns(),
    getRepoGraph: () => getRepoGraph(),
    getRepoGitHistory: () => Promise.resolve({ commits: [] }),
    getRepoContributors: () => Promise.resolve({ contributors: [] }),
    getGraphKindsForRepo: () => getGraphKindsForRepo(),
    listRequirements: () => Promise.reject(new Error('no requirements in this suite')),
    listProjects: () => Promise.resolve({ projects: [] }),
    listApps: () => Promise.resolve({ apps: [] }),
  },
  apiFetch: () => Promise.reject(new Error('not in this suite')),
}));

const { RepoDetailPage } = await import('../src/components/RepoDetailPage.js');
const { resetRepoLinks } = await import('../src/store/repoLinks.js');
const { resetRepoKnowledge } = await import('../src/store/repoKnowledge.js');

function ui(repoId: string, liveRuns: readonly SessionView[]): React.ReactElement {
  return <RepoDetailPage repoId={repoId} onSelectRun={() => {}} navigate={() => {}} onOpenGraph={() => {}} liveRuns={liveRuns} />;
}

beforeEach(() => {
  resetRepoLinks();
  resetRepoKnowledge();
  kindsAnswer = [];
  listRepos.mockReset();
  listRepos.mockResolvedValue({ repos: [REPO] });
  listRuns.mockReset();
  listRuns.mockResolvedValue({ runs: [] });
  getRepoGraph.mockReset();
  getRepoGraph.mockResolvedValue({ graph: null });
  getGraphKindsForRepo.mockClear();
});
afterEach(cleanup);

const codeMark = (): string => document.querySelector('[data-mark="code"]')?.textContent ?? '';

describe('repo page re-read fixes (studio#1161 P2)', () => {
  // Finding 1: the Code graph size comes from the knowledge store, which the finished transition must re-read.
  it('refreshes the Code graph size from the knowledge store when onboarding finishes', async () => {
    const { rerender } = render(ui('billing', [running]));
    await screen.findByTestId('repo-overview-working');
    expect(codeMark()).toMatch(/indexing now/i);

    // The newly-built graph: the next read of this repository's kinds answers 42 symbols.
    kindsAnswer = [{ kind: 'Function', count: 42 }];
    rerender(ui('billing', [done]));
    await waitFor(() => expect(codeMark()).toMatch(/symbols/i));
    expect(codeMark()).toContain('42');
  });

  // Finding 2: a run the live list has heard of, then archived out of it, is not resurrected from the page's own read.
  it('does not resurrect a fetched run once the live list has shown and then dropped it', async () => {
    // The page's own /runs read captured the run while it was executing.
    listRuns.mockResolvedValue({ runs: [running] });
    const { rerender } = render(ui('billing', [done]));
    await screen.findByRole('heading', { name: 'billing' });
    expect(screen.queryByTestId('repo-overview-working')).toBeNull();

    // Archived: gone from the live list. The executing snapshot must not come back.
    rerender(ui('billing', []));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('repo-overview-working')).toBeNull();
    expect(document.body.textContent).not.toMatch(/indexing now/i);
  });

  // Finding 3: with a working live list, the page's own failed /runs read is not shown as "could not be read".
  it('a working live list clears the page’s own failed jobs read', async () => {
    listRuns.mockRejectedValue(new Error('runs read boom'));
    render(ui('billing', [running]));
    const working = await screen.findByTestId('repo-overview-working');
    expect(working.textContent).toContain('Onboard billing');
    expect(screen.queryByTestId('repo-runs-failed')).toBeNull();
    expect(document.body.textContent).not.toMatch(/could not be read/i);
  });

  // Finding 4: a failed graph re-read still shows the repository re-read's new findings, and the graph-failed state.
  it('applies the repository and graph re-reads independently', async () => {
    const withFindings = { ...REPO, findings: [{ code: 'some_finding', message: 'heads up', path: null }] };
    listRepos.mockResolvedValueOnce({ repos: [REPO] }).mockResolvedValue({ repos: [withFindings] });
    getRepoGraph.mockResolvedValueOnce({ graph: null }).mockRejectedValue(new Error('graph read boom'));

    const { rerender } = render(ui('billing', [running]));
    await screen.findByTestId('repo-overview-working');
    rerender(ui('billing', [done]));
    // The repository re-read landed (new findings) even though the graph re-read rejected (graph-failed state shows).
    await screen.findByTestId('repo-findings');
    await screen.findByTestId('repo-graph');
  });

  // Finding 5a: two transitions, the first re-read resolves last — only the newest (second) answer lands.
  it('keeps the newest re-read when an older one resolves last', async () => {
    const v1 = { ...REPO, findings: [{ code: 'a', message: 'v1', path: null }] };
    const v2 = { ...REPO, findings: [{ code: 'a', message: 'v2', path: null }, { code: 'b', message: 'v2b', path: null }] };
    let resolveA: () => void = () => {};
    let resolveB: () => void = () => {};
    listRepos
      .mockResolvedValueOnce({ repos: [REPO] })
      .mockImplementationOnce(() => new Promise((r) => { resolveA = () => r({ repos: [v1] }); }))
      .mockImplementationOnce(() => new Promise((r) => { resolveB = () => r({ repos: [v2] }); }));

    const r1e = onb('r1', 'executing', 100);
    const r2e = onb('r2', 'executing', 200);
    const r1d = onb('r1', 'completed', 100);
    const r2d = onb('r2', 'completed', 200);
    const { rerender } = render(ui('billing', [r1e, r2e]));
    await screen.findByTestId('repo-overview-working');
    rerender(ui('billing', [r1d, r2e])); // transition 1 → re-read A
    rerender(ui('billing', [r1d, r2d])); // transition 2 → re-read B

    resolveB();
    await waitFor(() => expect(screen.getByTestId('repo-findings').getAttribute('data-count')).toBe('2'));
    resolveA(); // the older re-read resolves last: it must be dropped
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByTestId('repo-findings').getAttribute('data-count')).toBe('2');
  });

  // Finding 5b: navigate A → B → A while A's re-read is in flight — the old answer is dropped.
  it('drops a re-read that belongs to a visit left behind by navigation', async () => {
    const staleA = { ...REPO, findings: [{ code: 'stale', message: 'stale', path: null }] };
    let resolveStale: () => void = () => {};
    listRepos
      .mockResolvedValueOnce({ repos: [REPO, REPO_B] })
      .mockImplementationOnce(() => new Promise((r) => { resolveStale = () => r({ repos: [staleA, REPO_B] }); }))
      .mockResolvedValue({ repos: [REPO, REPO_B] });

    const { rerender } = render(ui('billing', [running]));
    await screen.findByRole('heading', { name: 'billing' });
    rerender(ui('billing', [done])); // transition → A's re-read (listRepos pending)
    rerender(ui('shipping', []));
    await screen.findByRole('heading', { name: 'shipping' });
    rerender(ui('billing', []));
    await screen.findByRole('heading', { name: 'billing' });

    resolveStale(); // A's old-visit re-read resolves now
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('repo-findings')).toBeNull();
  });
});
