import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { RepoEntry, SessionView } from '../src/api/types.js';
import { makeView } from './factories.js';
import { REPO_INTREE_NO_LIVE } from './fixtures/wave2.js';

/**
 * studio#940 item 1: Repositories left open follows App's live run list, as a repository's page does (studio#1161).
 * A run that starts or finishes shows on its row without a reload, and a listed repository's run going from in flight
 * to finished reads the repositories again, once.
 */

const repo = (id: string): RepoEntry => ({ id, name: id, root_path: `/tmp/${id}`, default_branch: 'main', registered_at: 1_700_000_000 });
const running = makeView({ id: 'o-1', repo_ref: 'billing', workflow_id: 'onboarding', status: 'executing', problem: 'Onboard billing' });
const done = makeView({ id: 'o-1', repo_ref: 'billing', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard billing' });
const otherRunning = makeView({ id: 'x-1', repo_ref: 'other', workflow_id: 'onboarding', status: 'executing', problem: 'Onboard other' });

const listRepos = vi.fn(() => Promise.resolve({ repos: [repo('billing'), repo('other')] }));
// The page's own read knows no run: everything on the rows comes from the live list.
const listRuns = vi.fn((): Promise<{ runs: SessionView[] }> => Promise.resolve({ runs: [] }));
/** A repository's code-map size read (the knowledge store's). */
const getGraphKindsForRepo = vi.fn((id: string) => { void id; return Promise.resolve({ kinds: [] }); });

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listRuns: () => listRuns(),
    listProjects: () => Promise.resolve({ projects: [] }),
    listApps: () => Promise.resolve({ apps: [] }),
    getGraphKindsForRepo: (id: string) => getGraphKindsForRepo(id),
    listRequirements: () => Promise.reject(new Error('no requirements in this suite')),
  },
}));

const { RepositoriesPanel } = await import('../src/components/RepositoriesPanel.js');
const { resetRepoKnowledge } = await import('../src/store/repoKnowledge.js');
const { useNeedsSources } = await import('../src/store/needsSources.js');

const ui = (liveRuns: readonly SessionView[]): React.ReactElement => <RepositoriesPanel navigate={() => {}} liveRuns={liveRuns} />;
const attrOf = (id: string, attr: string): string | null =>
  screen.getAllByTestId('repo-card').find((c) => c.getAttribute('data-repo-id') === id)?.getAttribute(attr) ?? null;
const stateOf = (id: string): string | null => attrOf(id, 'data-state');
const kindsReadsOf = (id: string): number => getGraphKindsForRepo.mock.calls.filter((c) => c[0] === id).length;
const deferred = <T,>(): { promise: Promise<T>; resolve: (v: T) => void } => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
};

beforeEach(() => { listRepos.mockClear(); listRuns.mockClear(); getGraphKindsForRepo.mockClear(); resetRepoKnowledge(); });
afterEach(cleanup);

describe('Repositories follows the live run list (studio#940)', () => {
  it('a run that finishes while the list is open: its row stops indexing, and the repositories are read again once', async () => {
    const { rerender } = render(ui([running, otherRunning]));
    await screen.findAllByTestId('repo-card');
    expect(stateOf('billing')).toBe('onboarding');
    expect(listRepos).toHaveBeenCalledTimes(1);

    rerender(ui([done, otherRunning]));
    await waitFor(() => expect(stateOf('billing')).toBe('ready'));
    expect(stateOf('other')).toBe('onboarding');
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(2));

    // A list that finishes nothing reads nothing more.
    rerender(ui([done, otherRunning, makeView({ id: 'y', repo_ref: 'other', status: 'executing' })]));
    await new Promise((r) => setTimeout(r, 20));
    expect(listRepos).toHaveBeenCalledTimes(2);
    expect(listRuns).toHaveBeenCalledTimes(1);
  });

  it('a run that starts while the list is open shows on its row without a reload', async () => {
    const { rerender } = render(ui([]));
    await screen.findAllByTestId('repo-card');
    expect(stateOf('billing')).toBe('never');
    rerender(ui([running]));
    await waitFor(() => expect(stateOf('billing')).toBe('onboarding'));
    expect(listRuns).toHaveBeenCalledTimes(1);
  });

  it('a run the live list dropped (archived) is not brought back by the page’s own older read', async () => {
    listRuns.mockImplementationOnce(() => Promise.resolve({ runs: [running] }));
    const { rerender } = render(ui([running]));
    await screen.findAllByTestId('repo-card');
    expect(stateOf('billing')).toBe('onboarding');
    rerender(ui([]));
    await waitFor(() => expect(stateOf('billing')).toBe('never'));
  });

  it('codex r1: the refresh lands the repository’s new findings, and re-reads its code-map size at once', async () => {
    const run = makeView({ id: 'o-s', repo_ref: 'wicked-studio', workflow_id: 'onboarding', status: 'executing', problem: 'Onboard wicked-studio' });
    const fin = makeView({ id: 'o-s', repo_ref: 'wicked-studio', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard wicked-studio' });
    listRepos
      .mockImplementationOnce(() => Promise.resolve({ repos: [{ ...REPO_INTREE_NO_LIVE, findings: [] }] }))
      .mockImplementationOnce(() => Promise.resolve({ repos: [REPO_INTREE_NO_LIVE] }));
    const { rerender } = render(ui([run]));
    await screen.findAllByTestId('repo-card');
    await waitFor(() => expect(kindsReadsOf('wicked-studio')).toBe(1));
    expect(attrOf('wicked-studio', 'data-graph')).not.toBe('missing');
    rerender(ui([fin]));
    // The finished index's findings (no live graph) are shown, not the list read at mount.
    await waitFor(() => expect(attrOf('wicked-studio', 'data-graph')).toBe('missing'));
    // Its code-map size is read again now, not at the next minute's refresh.
    await waitFor(() => expect(kindsReadsOf('wicked-studio')).toBe(2));
  });

  it('codex r2: a run that started and finished while the live list was away still reads the repositories again', async () => {
    const fin = makeView({ id: 'o-s', repo_ref: 'wicked-studio', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard wicked-studio' });
    listRepos
      .mockImplementationOnce(() => Promise.resolve({ repos: [{ ...REPO_INTREE_NO_LIVE, findings: [] }] }))
      .mockImplementationOnce(() => Promise.resolve({ repos: [REPO_INTREE_NO_LIVE] }));
    const { rerender } = render(ui([]));
    await screen.findAllByTestId('repo-card');
    await waitFor(() => expect(kindsReadsOf('wicked-studio')).toBe(1));
    // The next list already holds the run, finished: it was never seen in flight.
    rerender(ui([fin]));
    await waitFor(() => expect(attrOf('wicked-studio', 'data-graph')).toBe('missing'));
    await waitFor(() => expect(kindsReadsOf('wicked-studio')).toBe(2));
    expect(listRepos).toHaveBeenCalledTimes(2);
  });

  it('codex r2: finished runs already on the first list, or on App’s list arriving after the page’s own, read nothing more', async () => {
    listRuns.mockImplementationOnce(() => Promise.resolve({ runs: [] }));
    const { rerender } = render(<RepositoriesPanel navigate={() => {}} liveRuns={undefined} />);
    await screen.findAllByTestId('repo-card');
    rerender(ui([done, makeView({ id: 'z', repo_ref: 'other', status: 'failed' })]));
    await waitFor(() => expect(stateOf('billing')).toBe('ready'));
    await new Promise((r) => setTimeout(r, 20));
    expect(listRepos).toHaveBeenCalledTimes(1);
  });

  it('codex r2: a finish seen while the first read is still out is read once that read lands', async () => {
    const first = deferred<{ repos: RepoEntry[] }>();
    listRepos.mockImplementationOnce(() => first.promise);
    const { rerender } = render(ui([running]));
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(1));
    rerender(ui([done]));
    await new Promise((r) => setTimeout(r, 20));
    expect(listRepos).toHaveBeenCalledTimes(1);
    first.resolve({ repos: [repo('billing'), repo('other')] });
    await screen.findAllByTestId('repo-card');
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 20));
    expect(listRepos).toHaveBeenCalledTimes(2);
  });

  it('codex r1: two refreshes answered out of order: the older answer changes neither the list nor the shared one', async () => {
    const other = makeView({ id: 'x-1', repo_ref: 'other', workflow_id: 'onboarding', status: 'executing', problem: 'Onboard other' });
    const otherDone = makeView({ id: 'x-1', repo_ref: 'other', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard other' });
    const first = deferred<{ repos: RepoEntry[] }>();
    const second = deferred<{ repos: RepoEntry[] }>();
    const { rerender } = render(ui([running, other]));
    await screen.findAllByTestId('repo-card');
    listRepos.mockImplementationOnce(() => first.promise).mockImplementationOnce(() => second.promise);
    rerender(ui([done, other]));
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(2));
    rerender(ui([done, otherDone]));
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(3));
    // The newer read (asked second) answers first, with a repository added since; the older one answers last.
    second.resolve({ repos: [repo('billing'), repo('other'), repo('added')] });
    await waitFor(() => expect(attrOf('added', 'data-state')).toBe('never'));
    first.resolve({ repos: [repo('billing'), repo('other')] });
    await new Promise((r) => setTimeout(r, 20));
    expect(attrOf('added', 'data-state')).toBe('never');
    expect(useNeedsSources.getState().repos?.map((r) => r.id)).toEqual(['billing', 'other', 'added']);
  });
});
