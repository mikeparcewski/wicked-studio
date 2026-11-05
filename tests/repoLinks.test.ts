import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The Repositories list's projects-and-trackers reads (store/repoLinks.ts): bounded, the page asking now first, a late
 * read aborted (its connection freed), and a forced read while one is in flight never lands the older answer.
 */

vi.mock('../src/api/client.js', () => ({ api: {}, apiFetch: () => Promise.reject(new Error('not in this suite')) }));

const { trackersApi } = await import('../src/api/trackers.js');
const { useRepoLinks, useRepoLinksFor, resetRepoLinks, MAX_IN_FLIGHT, READ_TIMEOUT_MS } = await import('../src/store/repoLinks.js');
const { renderHook } = await import('@testing-library/react');

const answer = (repo: string, trackers: number) => ({ target: { repo }, links: Array.from({ length: trackers }, (_, i) => ({
  id: `l${i}`, trackerId: `t${i}`, source: 'jira', sourceId: '', system: 'jira', tenant: 'acme', key: `K${i}`, label: 'x',
  target: { kind: 'repo', id: repo }, linkedAt: '2026-11-01T00:00:00Z', linkedBy: 'person', projection: 'current',
})), viaRepos: [], projects: [], agents: [] });

interface Call { repo: string; signal: AbortSignal | undefined; settle: (v: unknown) => void }
let calls: Call[] = [];

beforeEach(() => {
  resetRepoLinks();
  calls = [];
  vi.spyOn(trackersApi, 'links').mockImplementation((target, signal) => new Promise((res) => {
    calls.push({ repo: target.repo ?? '', signal, settle: res });
  }));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

const flush = async (): Promise<void> => { for (let i = 0; i < 3; i += 1) await new Promise((r) => setTimeout(r, 0)); };

describe('the repo links store', () => {
  it(`reads at most ${MAX_IN_FLIGHT} at a time, and the page asking now jumps the queue (even a repository already queued)`, async () => {
    useRepoLinks.getState().ensure(['a', 'b', 'c', 'd', 'e', 'f']);
    expect(calls.map((c) => c.repo)).toEqual(['a', 'b', 'c']);
    useRepoLinks.getState().ensure(['f']); // a repository's page opens: f was queued behind d and e
    calls[0]!.settle(answer('a', 0));
    await flush();
    expect(calls.map((c) => c.repo)).toEqual(['a', 'b', 'c', 'f']);
  });

  it('a read that never answers is aborted after the timeout, reads as failed and frees its slot', async () => {
    vi.useFakeTimers();
    useRepoLinks.getState().ensure(['a', 'b', 'c', 'd']);
    expect(calls).toHaveLength(MAX_IN_FLIGHT);
    await vi.advanceTimersByTimeAsync(READ_TIMEOUT_MS + 1);
    expect(calls.slice(0, 3).every((c) => c.signal?.aborted === true)).toBe(true);
    expect(useRepoLinks.getState().reads['a']).toEqual({ state: 'failed' });
    expect(calls.map((c) => c.repo)).toContain('d');
  });

  it('a forced read while one is in flight drops the older answer and reads again', async () => {
    useRepoLinks.getState().ensure(['a']);
    expect(calls).toHaveLength(1);
    useRepoLinks.getState().ensure(['a'], true); // a tracker was linked while the first read was out
    calls[0]!.settle(answer('a', 0)); // the older answer: before the link
    await flush();
    expect(useRepoLinks.getState().reads['a']).toEqual({ state: 'loading' });
    expect(calls).toHaveLength(2);
    calls[1]!.settle(answer('a', 1));
    await flush();
    expect(useRepoLinks.getState().reads['a']).toMatchObject({ state: 'ok', trackers: 1 });
  });

  it('a page that closes takes its still-queued reads with it (an in-flight one finishes); another page’s stay', async () => {
    const { result, unmount } = renderHook(() => useRepoLinksFor(['a', 'b', 'c', 'd', 'e'], true));
    void result;
    renderHook(() => useRepoLinksFor(['e'], true)); // another page holds e (queued behind the first page's)
    expect(calls.map((c) => c.repo)).toEqual(['a', 'b', 'c']);
    unmount();
    for (const c of calls.slice(0, 3)) c.settle(answer(c.repo, 0));
    await flush();
    expect(calls.map((c) => c.repo)).toEqual(['a', 'b', 'c', 'e']); // d was never asked: nobody holds it
    expect(useRepoLinks.getState().reads['d']).toBeUndefined();
  });

  it('a refresh never goes before a first read', async () => {
    useRepoLinks.getState().ensure(['a']);
    calls[0]!.settle(answer('a', 0));
    await flush();
    useRepoLinks.setState({ at: { a: 0 } }); // a is stale now
    useRepoLinks.getState().ensure(['x', 'y', 'z']); // fills the slots
    useRepoLinks.getState().ensure(['a', 'n']); // a page asks for a stale one and a never-read one
    calls[1]!.settle(answer('x', 0));
    await flush();
    expect(calls.map((c) => c.repo).slice(4)).toEqual(['n']);
  });
});
