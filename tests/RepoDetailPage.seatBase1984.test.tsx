import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RepoEntry, SessionView } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * crew#1984: the repository page's half of a seat image save. The page shows the engine's post-write entry (crew's
 * `PUT /repos/:id/seat-base` answer), keeps the `git_url` crew adds on `GET /repos` only, and a repository re-read
 * begun before the save does not land over it. Entries are crew 0.21.0's shapes (wicked-crew v0.21.0
 * packages/crew/tests/repo-seat-base-1984.test.ts): `seat_base_image` skipped when unset, `seat_layers` rows.
 */
const listed = (base: string | null): RepoEntry => ({
  id: 'billing', name: 'billing', root_path: '/srv/billing', default_branch: 'main', registered_at: 1_700_000_000,
  git_url: 'https://github.com/acme/billing',
  seat_layers: [{ id: 'go', enabled: base === null, off_by: base === null ? null : 'repo_base' }],
  ...(base === null ? {} : { seat_base_image: base }),
} as unknown as RepoEntry);
/** The engine's own entry, as the PUT answers it: no `git_url` (crew adds that on `GET /repos` only). */
const written = (base: string): RepoEntry => {
  const e: Record<string, unknown> = { ...listed(base) };
  delete e['git_url'];
  return e as unknown as RepoEntry;
};

const running = makeView({ id: 'o-1', repo_ref: 'billing', workflow_id: 'onboarding', status: 'executing', problem: 'Onboard billing', created_at: 100 });
const done = makeView({ id: 'o-1', repo_ref: 'billing', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard billing', created_at: 100 });

const listRepos = vi.fn((): Promise<{ repos: RepoEntry[] }> => Promise.resolve({ repos: [listed(null)] }));
const setRepoSeatBase = vi.fn((...args: [string, string | null]): Promise<RepoEntry> => { void args; return Promise.resolve(written('acme/seat-base:go')); });

vi.mock('../src/api/client.js', () => ({
  api: {
    listRepos: () => listRepos(),
    listRuns: () => Promise.resolve({ runs: [] }),
    getRepoGraph: () => Promise.resolve({ graph: null }),
    getRepoGitHistory: () => Promise.resolve({ commits: [] }),
    getRepoContributors: () => Promise.resolve({ contributors: [] }),
    getGraphKindsForRepo: () => Promise.resolve({ kinds: [] }),
    listRequirements: () => Promise.reject(new Error('no requirements in this suite')),
    listProjects: () => Promise.resolve({ projects: [] }),
    listApps: () => Promise.resolve({ apps: [] }),
    setRepoSeatBase: (id: string, image: string | null) => setRepoSeatBase(id, image),
  },
  apiFetch: () => Promise.reject(new Error('not in this suite')),
}));

const { RepoDetailPage } = await import('../src/components/RepoDetailPage.js');
const { resetRepoLinks } = await import('../src/store/repoLinks.js');
const { resetRepoKnowledge } = await import('../src/store/repoKnowledge.js');

function ui(liveRuns: readonly SessionView[], at: { repoId?: string; tab?: string } = {}): React.ReactElement {
  return <RepoDetailPage repoId={at.repoId ?? 'billing'} search={`?tab=${at.tab ?? 'settings'}`} onSelectRun={() => {}} navigate={() => {}} onOpenGraph={() => {}} liveRuns={liveRuns} />;
}

beforeEach(() => {
  resetRepoLinks();
  resetRepoKnowledge();
  listRepos.mockReset();
  listRepos.mockResolvedValue({ repos: [listed(null)] });
  setRepoSeatBase.mockClear();
});
afterEach(cleanup);

const baseNow = (): string => screen.getByTestId('repo-seat-base-now').textContent ?? '';

describe('repository page: a seat image save (crew#1984)', () => {
  it('STALE READS / SHARED READS: shows the engine’s entry, keeps git_url, and an earlier re-read does not land over it', async () => {
    const { rerender } = render(ui([running]));
    await screen.findByTestId('repo-seat-image');
    expect(baseNow()).toMatch(/default/i);

    // A run finishing starts a repository re-read; it answers late, with the entry from before the save.
    let lateAnswer: (v: { repos: RepoEntry[] }) => void = () => {};
    listRepos.mockImplementationOnce(() => new Promise((r) => { lateAnswer = r; }));
    rerender(ui([done]));
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(2));

    fireEvent.change(screen.getByTestId('repo-seat-base-input'), { target: { value: 'acme/seat-base:go' } });
    fireEvent.click(screen.getByTestId('repo-seat-base-save'));
    await waitFor(() => expect(baseNow()).toBe('acme/seat-base:go'));
    expect(setRepoSeatBase).toHaveBeenCalledWith('billing', 'acme/seat-base:go');
    expect(screen.getByTestId('repo-seat-layers').textContent).toMatch(/seat base image is its toolchain/);

    lateAnswer({ repos: [listed(null)] });
    await new Promise((r) => setTimeout(r, 20));
    expect(baseNow()).toBe('acme/seat-base:go');
    // git_url is kept from the listed entry (the PUT's entry has none): the page's web link is still there.
    expect(screen.getByText('View on the web').getAttribute('href')).toBe('https://github.com/acme/billing');
  });

  it('STALE READS: an older card’s answer, landing after a newer save from the remounted tab, does not land over it', async () => {
    const answers: Array<(e: RepoEntry) => void> = [];
    setRepoSeatBase.mockImplementation(() => new Promise<RepoEntry>((r) => { answers.push(r); }));
    const { rerender } = render(ui([]));
    await screen.findByTestId('repo-seat-image');
    fireEvent.change(screen.getByTestId('repo-seat-base-input'), { target: { value: 'acme/seat-base:a' } });
    fireEvent.click(screen.getByTestId('repo-seat-base-save'));
    // Away to Overview and back: a fresh card, so a second save can start while the first is in flight.
    rerender(ui([], { tab: 'overview' }));
    rerender(ui([]));
    await screen.findByTestId('repo-seat-image');
    fireEvent.change(screen.getByTestId('repo-seat-base-input'), { target: { value: 'acme/seat-base:b' } });
    fireEvent.click(screen.getByTestId('repo-seat-base-save'));
    expect(answers).toHaveLength(2);
    answers[1]!(written('acme/seat-base:b'));
    await waitFor(() => expect(baseNow()).toBe('acme/seat-base:b'));
    answers[0]!(written('acme/seat-base:a'));
    await new Promise((r) => setTimeout(r, 20));
    expect(baseNow()).toBe('acme/seat-base:b');
  });

  it('IDENTITY REUSE: a draft typed on one repository is not shown on the next one opened', async () => {
    const shipping = { ...listed(null), id: 'shipping', name: 'shipping', root_path: '/srv/shipping' } as RepoEntry;
    listRepos.mockResolvedValue({ repos: [listed(null), shipping] });
    const { rerender } = render(ui([]));
    await screen.findByTestId('repo-seat-image');
    fireEvent.change(screen.getByTestId('repo-seat-base-input'), { target: { value: 'acme/seat-base:typed' } });
    rerender(ui([], { repoId: 'shipping' }));
    await screen.findByRole('heading', { name: 'shipping' });
    const field = (await screen.findByTestId('repo-seat-base-input')) as HTMLInputElement;
    expect(field.value).toBe('');
  });
});
