import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RepoEntry, SessionView } from '../src/api/types.js';
import { makeView } from './factories.js';

/**
 * wicked-core#1043 on the repo page: Settings shows the Seat toolchain card from the row `GET /repos` serves, and a
 * switch replaces the page's row with crew's answer (`PUT /repos/:id/seat-layers` answers the row as `GET /repos`
 * shows it). Rows in core's shape (core src/repo.rs:82-108, src/seat_layers.rs:382-408).
 *
 * Round 1 (codex): the PUT sends the whole off list, so the list it is built from must be crew's latest. A reply
 * that never arrives, a save still in flight when Settings is left and opened again, and a re-read begun before the
 * save landed must not leave the page building the next list from an old row.
 */

const IDS = ['node', 'python'];
function row(off: string[], id = 'shop'): RepoEntry {
  const sorted = [...new Set(off)].sort();
  return {
    id, name: id, root_path: `/srv/${id}`, default_branch: 'main', registered_at: 1_764_000_000, findings: [],
    seat_layers: IDS.map((l) => ({ id: l, enabled: !sorted.includes(l), off_by: sorted.includes(l) ? 'repo' : null })),
    ...(sorted.length > 0 ? { seat_layers_off: sorted } : {}),
  } as unknown as RepoEntry;
}

/** Crew's state, which the PUT changes and the GET reads. */
let crew: RepoEntry[] = [];
const listRepos = vi.fn(async () => ({ repos: crew }));
const setRepoSeatLayers = vi.fn(async (id: string, off: string[]) => {
  const r = row(off, id);
  crew = crew.map((c) => (c.id === id ? r : c));
  return r;
});

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
    setRepoSeatLayers: (id: string, off: string[]) => setRepoSeatLayers(id, off),
  },
  apiFetch: () => Promise.reject(new Error('not in this suite')),
}));

const { RepoDetailPage } = await import('../src/components/RepoDetailPage.js');
const { resetSeatLayerSaves } = await import('../src/store/seatLayerSaves.js');

beforeEach(() => {
  crew = [row([]), row([], 'other')];
  listRepos.mockClear();
  setRepoSeatLayers.mockClear();
});
afterEach(() => { cleanup(); resetSeatLayerSaves(); });

function ui(search = '?tab=settings', liveRuns?: readonly SessionView[], repoId = 'shop'): React.ReactElement {
  return <RepoDetailPage repoId={repoId} onSelectRun={() => {}} navigate={() => {}} onOpenGraph={() => {}} search={search} {...(liveRuns !== undefined ? { liveRuns } : {})} />;
}
const sw = (label: string): HTMLElement => within(screen.getByTestId('repo-seat-layers')).getByRole('switch', { name: label });
function deferred<T>(): { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void } {
  let resolve: (v: T) => void = () => {};
  let reject: (e: unknown) => void = () => {};
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

describe('the repo page\'s Seat toolchain card (core#1043)', () => {
  it('Settings shows the layers, and a switch shows crew\'s answer', async () => {
    render(ui());
    await screen.findByTestId('repo-seat-layers');
    expect(sw('Node.js')).toHaveAttribute('aria-checked', 'true');
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(setRepoSeatLayers).toHaveBeenCalledWith('shop', ['node']);
    expect(sw('Node.js')).toHaveAttribute('aria-checked', 'false');
  });

  it('other tabs do not show it', async () => {
    render(ui('?tab=jobs'));
    await screen.findByRole('heading', { name: 'shop' });
    expect(screen.queryByTestId('repo-seat-layers')).toBeNull();
  });
});

describe('the next list is built from crew\'s latest row (core#1043, round 1)', () => {
  it('a reply that never arrives: the page reads crew again, and the next switch keeps the change that landed', async () => {
    render(ui());
    await screen.findByTestId('repo-seat-layers');
    // Crew writes ['node'], and the reply is lost on the way back.
    setRepoSeatLayers.mockImplementationOnce(async (id, off) => {
      crew = crew.map((c) => (c.id === id ? row(off, id) : c));
      throw new TypeError('Failed to fetch');
    });
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(within(screen.getByTestId('repo-seat-layers')).getByRole('alert')).toHaveTextContent('Couldn’t confirm that change');
    await waitFor(() => expect(sw('Node.js')).toHaveAttribute('aria-checked', 'false'));
    await act(async () => { fireEvent.click(sw('Python')); });
    expect(setRepoSeatLayers).toHaveBeenLastCalledWith('shop', ['node', 'python']);
  });

  it('a lost reply and a failed read after it: the next switch still keeps the change that landed (delta)', async () => {
    render(ui());
    await screen.findByTestId('repo-seat-layers');
    setRepoSeatLayers.mockImplementationOnce(async (id, off) => {
      crew = crew.map((c) => (c.id === id ? row(off, id) : c));
      // The read after the lost reply fails too.
      listRepos.mockImplementationOnce(async () => { throw new TypeError('Failed to fetch'); });
      throw new TypeError('Failed to fetch');
    });
    await act(async () => { fireEvent.click(sw('Node.js')); });
    await waitFor(() => expect(sw('Python')).not.toBeDisabled());
    await act(async () => { fireEvent.click(sw('Python')); });
    expect(setRepoSeatLayers).toHaveBeenLastCalledWith('shop', ['node', 'python']);
  });

  it('back on the repository before crew wrote the change: the next switch keeps it once it lands (delta)', async () => {
    const reply = deferred<RepoEntry>();
    setRepoSeatLayers.mockImplementationOnce(() => reply.promise);
    const { rerender } = render(ui());
    await screen.findByTestId('repo-seat-layers');
    await act(async () => { fireEvent.click(sw('Node.js')); });
    rerender(ui('?tab=settings', undefined, 'other'));
    await screen.findByRole('heading', { name: 'other' });
    rerender(ui());
    await screen.findByTestId('repo-seat-layers');
    // This visit read crew before the write: Node.js still shows on. Then crew writes and answers the earlier visit.
    crew = crew.map((c) => (c.id === 'shop' ? row(['node']) : c));
    await act(async () => { reply.resolve(row(['node'])); });
    await waitFor(() => expect(sw('Python')).not.toBeDisabled());
    await act(async () => { fireEvent.click(sw('Python')); });
    expect(setRepoSeatLayers).toHaveBeenLastCalledWith('shop', ['node', 'python']);
  });

  it('a save still in flight when Settings is left and opened again: the switches wait for it', async () => {
    const reply = deferred<RepoEntry>();
    setRepoSeatLayers.mockImplementationOnce(() => reply.promise);
    const { rerender } = render(ui());
    await screen.findByTestId('repo-seat-layers');
    await act(async () => { fireEvent.click(sw('Node.js')); });
    rerender(ui('?tab=jobs'));
    rerender(ui('?tab=settings'));
    await screen.findByTestId('repo-seat-layers');
    expect(sw('Python')).toBeDisabled();
    await act(async () => { fireEvent.click(sw('Python')); });
    expect(setRepoSeatLayers).toHaveBeenCalledTimes(1);
    crew = crew.map((c) => (c.id === 'shop' ? row(['node']) : c));
    await act(async () => { reply.resolve(row(['node'])); });
    await waitFor(() => expect(sw('Python')).not.toBeDisabled());
    expect(sw('Node.js')).toHaveAttribute('aria-checked', 'false');
    await act(async () => { fireEvent.click(sw('Python')); });
    expect(setRepoSeatLayers).toHaveBeenLastCalledWith('shop', ['node', 'python']);
  });

  it('a re-read begun before the save landed does not bring the old row back', async () => {
    const running = makeView({ id: 'o-1', repo_ref: 'shop', workflow_id: 'onboarding', status: 'executing', problem: 'Onboard shop', created_at: 100 });
    const done = makeView({ id: 'o-1', repo_ref: 'shop', workflow_id: 'onboarding', status: 'completed', problem: 'Onboard shop', created_at: 100 });
    const { rerender } = render(ui('?tab=settings', [running]));
    await screen.findByTestId('repo-seat-layers');
    // A run finishes: the page re-reads the repository, and that read holds the row from before the save.
    const stale = deferred<{ repos: RepoEntry[] }>();
    listRepos.mockImplementationOnce(() => stale.promise);
    rerender(ui('?tab=settings', [done]));
    await act(async () => { fireEvent.click(sw('Node.js')); });
    expect(sw('Node.js')).toHaveAttribute('aria-checked', 'false');
    await act(async () => { stale.resolve({ repos: [row([]), row([], 'other')] }); });
    expect(sw('Node.js')).toHaveAttribute('aria-checked', 'false');
  });

  it('a change of unknown outcome from an earlier visit reads nothing for it (delta 2)', async () => {
    const reply = deferred<RepoEntry>();
    setRepoSeatLayers.mockImplementationOnce(() => reply.promise);
    const { rerender } = render(ui());
    await screen.findByTestId('repo-seat-layers');
    await act(async () => { fireEvent.click(sw('Node.js')); });
    rerender(ui('?tab=settings', undefined, 'other'));
    await screen.findByRole('heading', { name: 'other' });
    const before = listRepos.mock.calls.length;
    await act(async () => { reply.reject(new TypeError('Failed to fetch')); });
    expect(listRepos.mock.calls.length).toBe(before);
  });

  it('a reply for an earlier visit to this repository does not land on a later one', async () => {
    const reply = deferred<RepoEntry>();
    setRepoSeatLayers.mockImplementationOnce(() => reply.promise);
    const { rerender } = render(ui());
    await screen.findByTestId('repo-seat-layers');
    await act(async () => { fireEvent.click(sw('Node.js')); });
    rerender(ui('?tab=settings', undefined, 'other'));
    await screen.findByRole('heading', { name: 'other' });
    // Back to shop: this visit reads crew afresh, after another change turned Python off there.
    crew = crew.map((c) => (c.id === 'shop' ? row(['python']) : c));
    rerender(ui());
    await screen.findByRole('heading', { name: 'shop' });
    await waitFor(() => expect(sw('Python')).toHaveAttribute('aria-checked', 'false'));
    await act(async () => { reply.resolve(row(['node'])); });
    expect(sw('Python')).toHaveAttribute('aria-checked', 'false');
  });
});
