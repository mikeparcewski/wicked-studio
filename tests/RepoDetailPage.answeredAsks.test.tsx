import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { RepoEntry, SessionView } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * studio#1371: an answered ask parks `awaiting_human` at its turn gate (crew `ask_turn: true`), so the page counted
 * every answered chat as "Working now", each titled by crew's first-clause cut of the question ("In tiny-math-t12").
 * An answered ask is an ended outcome (`outcomeOf` → 'Answered', board/deskInsights.ts:110): it is not working now on
 * Overview or Jobs, and its row carries the question's words.
 *
 * The ask run as crew serves it (wicked-crew packages/crew/src/api/routes.ts): `problem` is the operator's question
 * (:6426, crew#823), `title` is crew's short job title of it (:2429; the t12r3-j3 cert page shows "In tiny-math-t12"),
 * and `ask_path` / `ask_turn` mark an ask waiting at its turn gate (:2517-2519).
 */

const QUESTION = 'In tiny-math-t12, what does sum([1,2,3]) return with the code as it is now? Name the file and line that decide it, and say which test covers sum.';
const REPO: RepoEntry = { id: 'tiny-math-t12', name: 'tiny-math-t12', root_path: '/tmp/tiny-math-t12', default_branch: 'main', registered_at: 1_700_000_000 };
const asked = (id: string, at: number): SessionView => makeView({
  id, repo_ref: 'tiny-math-t12', status: 'awaiting_human', problem: QUESTION, created_at: at,
  ...({ title: 'In tiny-math-t12', ask_path: true, ask_turn: true } as object),
});
const working = makeView({ id: 'w-1', repo_ref: 'tiny-math-t12', workflow_id: 'bug', status: 'executing', problem: 'Fix the off-by-one in sum', created_at: 300 });

let runs: SessionView[] = [];
vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => Promise.resolve({ repos: [REPO] }),
    listRuns: () => Promise.resolve({ runs }),
    getRepoGraph: () => Promise.resolve({ graph: null }),
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

const page = (search = ''): React.ReactElement => (
  <RepoDetailPage repoId="tiny-math-t12" search={search} onSelectRun={() => {}} navigate={() => {}} onOpenGraph={() => {}} liveRuns={runs} />
);

beforeEach(() => {
  resetRepoLinks();
  resetRepoKnowledge();
  runs = [asked('a-1', 100), asked('a-2', 200), working];
});
afterEach(cleanup);

describe('answered asks are not "Working now" (studio#1371)', () => {
  it('Overview lists only the run that is working; the asks are recent jobs titled by their question', async () => {
    render(page());
    const now = await screen.findByTestId('repo-overview-working');
    expect(within(now).getAllByTestId('run-link').map((r) => r.getAttribute('data-run-id'))).toEqual(['w-1']);
    const recent = within(screen.getByTestId('repo-overview-recent')).getAllByTestId('run-link');
    const ask = recent.find((r) => r.getAttribute('data-run-id') === 'a-1')!;
    expect(ask).toHaveTextContent('In tiny-math-t12, what does sum([1,2,3]) return with the code as');
    expect(ask).toHaveTextContent('Answered');
  });

  it('the Jobs tab counts and lists only the working run under Working now', async () => {
    render(page('?tab=jobs'));
    const now = await screen.findByTestId('repo-jobs-working');
    expect(within(now).getAllByTestId('run-link').map((r) => r.getAttribute('data-run-id'))).toEqual(['w-1']);
    const stats = screen.getByTestId('repo-detail-stats');
    expect(stats).toHaveTextContent(/1\s*working now/);
    expect(stats).toHaveTextContent(/2\s*finished/);
  });

  it('a page with only answered asks shows no Working now section', async () => {
    runs = [asked('a-1', 100), asked('a-2', 200)];
    render(page());
    await screen.findByTestId('repo-overview-recent');
    expect(screen.queryByTestId('repo-overview-working')).toBeNull();
  });
});
