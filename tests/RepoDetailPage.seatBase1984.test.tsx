import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { RepoEntry, SessionView } from '../src/api/types.js';
import { ApiError } from '../src/api/errors.js';
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
  // Reset, not clear: a queued once-answer must never carry into the next test.
  setRepoSeatBase.mockReset();
  setRepoSeatBase.mockImplementation(() => Promise.resolve(written('acme/seat-base:go')));
});
afterEach(cleanup);

const baseNow = (): string => screen.getByTestId('repo-seat-base-now').textContent ?? '';

describe('repository page: a seat image save (crew#1984)', () => {
  it('STALE READS / SHARED READS: shows what crew holds after the save, keeps git_url, and an earlier re-read does not land over it', async () => {
    const { rerender } = render(ui([running]));
    await screen.findByTestId('repo-seat-image');
    expect(baseNow()).toMatch(/default/i);

    // A run finishing starts a repository re-read; it answers late, with the entry from before the save.
    let lateAnswer: (v: { repos: RepoEntry[] }) => void = () => {};
    listRepos.mockImplementationOnce(() => new Promise((r) => { lateAnswer = r; }));
    rerender(ui([done]));
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(2));

    // What crew holds once the write is in: the next GET /repos answers it.
    listRepos.mockResolvedValue({ repos: [listed('acme/seat-base:go')] });
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

  // DES studio#1513 (codex-check on 1dc5d4e6, W20): a PUT's answer is not the page's to show; what crew holds is.
  it('STALE READS: a delayed save answer does not land over a newer read of the repository', async () => {
    let answerPut: (e: RepoEntry) => void = () => {};
    setRepoSeatBase.mockImplementationOnce(() => new Promise<RepoEntry>((r) => { answerPut = r; }));
    const { rerender } = render(ui([running]));
    await screen.findByTestId('repo-seat-image');
    fireEvent.change(screen.getByTestId('repo-seat-base-input'), { target: { value: 'acme/seat-base:a' } });
    fireEvent.click(screen.getByTestId('repo-seat-base-save'));
    // Crew took A, then another client set B; a run finishing re-reads the repository and sees B.
    listRepos.mockResolvedValue({ repos: [listed('acme/seat-base:b')] });
    rerender(ui([done]));
    await waitFor(() => expect(baseNow()).toBe('acme/seat-base:b'));
    // A's answer arrives last. Crew holds B.
    answerPut(written('acme/seat-base:a'));
    await new Promise((r) => setTimeout(r, 30));
    expect(baseNow()).toBe('acme/seat-base:b');
  });

  it('STALE READS / IDENTITY REUSE: a save answered while the repository is being opened again shows what crew holds', async () => {
    const shipping = { ...listed(null), id: 'shipping', name: 'shipping', root_path: '/srv/shipping' } as RepoEntry;
    listRepos.mockResolvedValue({ repos: [listed(null), shipping] });
    let answerPut: (e: RepoEntry) => void = () => {};
    setRepoSeatBase.mockImplementationOnce(() => new Promise<RepoEntry>((r) => { answerPut = r; }));
    const { rerender } = render(ui([]));
    await screen.findByTestId('repo-seat-image');
    fireEvent.change(screen.getByTestId('repo-seat-base-input'), { target: { value: 'acme/seat-base:a' } });
    fireEvent.click(screen.getByTestId('repo-seat-base-save'));
    rerender(ui([], { repoId: 'shipping' }));
    await screen.findByRole('heading', { name: 'shipping' });
    // Back to billing: its read was served before the write went in, and answers after the save does.
    let staleRead: (v: { repos: RepoEntry[] }) => void = () => {};
    listRepos.mockImplementationOnce(() => new Promise((r) => { staleRead = r; }));
    rerender(ui([]));
    await waitFor(() => expect(listRepos).toHaveBeenCalledTimes(3));
    listRepos.mockResolvedValue({ repos: [listed('acme/seat-base:a'), shipping] });
    answerPut(written('acme/seat-base:a'));
    await new Promise((r) => setTimeout(r, 30));
    staleRead({ repos: [listed(null), shipping] });
    await waitFor(() => expect(baseNow()).toBe('acme/seat-base:a'));
    await new Promise((r) => setTimeout(r, 30));
    expect(baseNow()).toBe('acme/seat-base:a');
  });

  it('PARTIAL FAILURE: a save in flight across a tab remount blocks another, then lands; a later refused save does not hide it', async () => {
    let answerA: (e: RepoEntry) => void = () => {};
    setRepoSeatBase
      .mockImplementationOnce(() => new Promise<RepoEntry>((r) => { answerA = r; }))
      .mockImplementationOnce(() => Promise.reject(new ApiError(400, 'refused by the engine', { code: 'seat_base_invalid', error: 'refused by the engine' })));
    const { rerender } = render(ui([]));
    await screen.findByTestId('repo-seat-image');
    fireEvent.change(screen.getByTestId('repo-seat-base-input'), { target: { value: 'acme/seat-base:a' } });
    fireEvent.click(screen.getByTestId('repo-seat-base-save'));
    rerender(ui([], { tab: 'overview' }));
    rerender(ui([]));
    await screen.findByTestId('repo-seat-image');
    // The page's edit survived the remount: still saving, so nothing more is sent.
    expect((screen.getByTestId('repo-seat-base-save') as HTMLButtonElement).textContent).toBe('Saving…');
    fireEvent.click(screen.getByTestId('repo-seat-base-save'));
    expect(setRepoSeatBase).toHaveBeenCalledTimes(1);
    listRepos.mockResolvedValue({ repos: [listed('acme/seat-base:a')] });
    answerA(written('acme/seat-base:a'));
    await waitFor(() => expect(baseNow()).toBe('acme/seat-base:a'));
    // Then a refused save: the engine's words, and the base crew holds is still shown.
    fireEvent.change(screen.getByTestId('repo-seat-base-input'), { target: { value: 'Bad Ref' } });
    fireEvent.click(screen.getByTestId('repo-seat-base-save'));
    expect((await screen.findByTestId('repo-seat-base-error')).textContent).toBe('refused by the engine');
    expect(baseNow()).toBe('acme/seat-base:a');
  });

  // Coord ruling on the capped check (finding A): a save that went in, read back by a request that failed, says so.
  it('PARTIAL FAILURE: a save that went in but could not be read back keeps the draft and says to reload', async () => {
    render(ui([]));
    await screen.findByTestId('repo-seat-image');
    listRepos.mockRejectedValue(new ApiError(503, 'Service Unavailable'));
    fireEvent.change(screen.getByTestId('repo-seat-base-input'), { target: { value: 'acme/seat-base:a' } });
    fireEvent.click(screen.getByTestId('repo-seat-base-save'));
    const note = await screen.findByTestId('repo-seat-base-error');
    expect(note.textContent).toBe('Saved. The page could not read it back: reload to see it.');
    expect((screen.getByTestId('repo-seat-base-input') as HTMLInputElement).value).toBe('acme/seat-base:a');
  });

  it('a draft survives leaving the Settings tab and coming back', async () => {
    const { rerender } = render(ui([]));
    await screen.findByTestId('repo-seat-image');
    fireEvent.change(screen.getByTestId('repo-seat-base-input'), { target: { value: 'acme/seat-base:draft' } });
    rerender(ui([], { tab: 'overview' }));
    rerender(ui([]));
    const field = (await screen.findByTestId('repo-seat-base-input')) as HTMLInputElement;
    expect(field.value).toBe('acme/seat-base:draft');
  });

  it('says a daemon’s own image for an agent comes first (WICKED_SEAT_IMAGE_<CLI>)', async () => {
    render(ui([]));
    const card = await screen.findByTestId('repo-seat-image');
    expect(card.textContent).toContain('unless this daemon pins its own image for that agent');
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
