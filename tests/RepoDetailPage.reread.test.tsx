import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GraphKind, RepoEntry, SessionView } from '../src/api/types.js';
import { ApiError } from '../src/api/errors.js';
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

const { RepoDetailPage, graphReadError } = await import('../src/components/RepoDetailPage.js');
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

// Rule proposal:01a07c56-f241: the shared helper shows ApiError.message (translateWireError's output), never raw wire.
describe('graphReadError (studio#1161 P2)', () => {
  it('returns an ApiError’s translated message, not its raw wire', () => {
    const err = new ApiError(409, 'graph store is locked');
    expect(graphReadError(err)).toBe(err.message);
    expect(graphReadError(err)).not.toBe(err.wire);
    expect(graphReadError(err)).toMatch(/the daemon refused this/i); // translateWireError wrapper, absent from .wire
  });
  it('shows a plain Error’s own message', () => {
    expect(graphReadError(new Error('boom'))).toBe('boom');
  });
  it('falls back when there is no usable message', () => {
    expect(graphReadError(new Error(''))).toBe('Studio’s service did not answer');
    expect(graphReadError('nope')).toBe('Studio’s service did not answer');
    expect(graphReadError(null)).toBe('Studio’s service did not answer');
  });
});

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
    // Not shown: the run's own row is gone, not merely the Working-now header.
    expect(document.body.textContent).not.toContain('Onboard billing');
    // Does not count as in flight: the Working-now section (active runs) is absent and nothing reads "indexing now".
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

  // Finding 4 (rule proposal:01a07c56-f241): a failed graph re-read shows ApiError.message (translateWireError's
  // output), never the raw .wire.
  it('shows the translated ApiError message on a failed graph re-read, not the raw wire', async () => {
    const err = new ApiError(409, 'graph store is locked');
    expect(err.message).not.toBe(err.wire); // translateWireError wraps the raw sentence (src/api/errors.ts:76)
    getRepoGraph.mockResolvedValueOnce({ graph: null }).mockRejectedValue(err);

    const { rerender } = render(ui('billing', [running]));
    await screen.findByTestId('repo-overview-working');
    rerender(ui('billing', [done]));
    const banner = await screen.findByTestId('repo-graph');
    expect(banner.textContent).toContain(err.message);
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

describe('repo page re-read fixes (studio#1161 second review round)', () => {
  // P2-1: the forced knowledge read asked while the first read is pending is not dropped.
  it('re-reads the Code graph size after a pending first read settles with a stale zero', async () => {
    let settleFirst: () => void = () => {};
    getGraphKindsForRepo.mockImplementationOnce(() => new Promise((r) => { settleFirst = () => r({ kinds: [] }); }));
    const { rerender } = render(ui('billing', [running]));
    await screen.findByTestId('repo-overview-working');
    expect(getGraphKindsForRepo).toHaveBeenCalledTimes(1);

    kindsAnswer = [{ kind: 'Function', count: 77 }];
    rerender(ui('billing', [done])); // the run finishes while the first read is still pending
    settleFirst(); // the older read answers zero
    await waitFor(() => expect(codeMark()).toContain('77'));
    expect(codeMark()).toMatch(/symbols/i);
    expect(getGraphKindsForRepo).toHaveBeenCalledTimes(2);
  });

  // P2-2: retryGraph and the completion re-read share one graph sequence.
  it('an older failing completion re-read does not undo a newer successful Try again', async () => {
    let failA: () => void = () => {};
    getRepoGraph
      .mockRejectedValueOnce(new Error('first graph read boom'))
      .mockImplementationOnce(() => new Promise((_, rej) => { failA = () => rej(new Error('re-read A boom')); }))
      .mockResolvedValue({ graph: null });

    const { rerender } = render(ui('billing', [running]));
    await screen.findByTestId('repo-graph'); // the first graph read failed
    rerender(ui('billing', [done])); // re-read A starts (pending)
    await waitFor(() => expect(getRepoGraph).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTestId('repo-graph-retry')); // B succeeds
    await waitFor(() => expect(screen.queryByTestId('repo-graph')).toBeNull());

    failA(); // the older re-read fails last
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('repo-graph')).toBeNull();
    expect(document.body.textContent).not.toMatch(/couldn.t load the code map/i);
  });
});
