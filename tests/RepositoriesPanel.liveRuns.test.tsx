import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import type { RepoEntry, SessionView } from '../src/api/types.js';
import { makeView } from './factories.js';

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

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listRuns: () => listRuns(),
    listProjects: () => Promise.resolve({ projects: [] }),
    listApps: () => Promise.resolve({ apps: [] }),
  },
}));

const { RepositoriesPanel } = await import('../src/components/RepositoriesPanel.js');

const ui = (liveRuns: readonly SessionView[]): React.ReactElement => <RepositoriesPanel navigate={() => {}} liveRuns={liveRuns} />;
const stateOf = (id: string): string | null =>
  screen.getAllByTestId('repo-card').find((c) => c.getAttribute('data-repo-id') === id)?.getAttribute('data-state') ?? null;

beforeEach(() => { listRepos.mockClear(); listRuns.mockClear(); });
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
});
