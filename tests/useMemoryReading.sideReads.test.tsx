/**
 * The Desk's memory reading: the coverage total from GET /memory/coverage, with the memory proposals waiting and the
 * indexed repositories READ from the Home queue's store (never fetched here). Cold Home reads each queue input once
 * (needs_shell); a count shows only while the queue's last read of that wire answered; the total never waits on them
 * (studio#944); nothing rejects unobserved (CI r9b).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listRepos = vi.fn();
const memoryCoverage = vi.fn();
const listProposals = vi.fn();
vi.mock('../src/api/client.js', () => ({ api: { listRepos } }));
vi.mock('../src/api/memory.js', () => ({ memoryCoverage, isMemoryUnsupported: () => false }));
vi.mock('../src/api/proposals.js', () => ({ listProposals, proposalKind: (p: { kind?: string }) => { if (p.kind === undefined) throw new TypeError('no kind_type'); return p.kind; } }));

const { useMemoryReading } = await import('../src/hooks/useMemoryReading.js');
const { useNeedsSources } = await import('../src/store/needsSources.js');

describe('useMemoryReading', () => {
  afterEach(() => vi.clearAllMocks());

  it('reads no queue input itself: a cold Home reads /proposals and /repos once (needs_shell)', async () => {
    memoryCoverage.mockResolvedValue({ total: 4 });
    listProposals.mockResolvedValue([{ kind: 'memory' }, { kind: 'policy' }]);
    listRepos.mockResolvedValue({ repos: [{ code_graph_db: '/x/estate.db' }, { code_graph_db: '' }] });
    const { result } = renderHook(() => useMemoryReading(true));
    await act(async () => { await useNeedsSources.getState().load(); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 4, pending: 1, indexedRepos: 1 }));
    expect(listProposals).toHaveBeenCalledTimes(1);
    expect(listRepos).toHaveBeenCalledTimes(1);
  });

  it('the total never waits on the side counts (studio#944)', async () => {
    memoryCoverage.mockResolvedValue({ total: 12 });
    listProposals.mockReturnValue(new Promise(() => undefined));
    listRepos.mockReturnValue(new Promise(() => undefined));
    const { result } = renderHook(() => useMemoryReading(true));
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 12 }));
  });

  it('a malformed or failed queue read leaves its count out, though the queue keeps its last good list (codex + agy on 9d)', async () => {
    memoryCoverage.mockResolvedValue({ total: 3 });
    listProposals.mockResolvedValue([{ kind: 'memory' }]);
    listRepos.mockResolvedValue({ repos: [{ code_graph_db: '/x/estate.db' }] });
    const { result } = renderHook(() => useMemoryReading(true));
    await act(async () => { await useNeedsSources.getState().load(); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 3, pending: 1, indexedRepos: 1 }));
    // the next queue read: /repos answers without a list, /proposals fails
    listRepos.mockResolvedValue({ repos: {} });
    listProposals.mockRejectedValue(new Error('503'));
    await act(async () => { await useNeedsSources.getState().load(0); });
    expect(useNeedsSources.getState().repos).toHaveLength(1);
    expect(useNeedsSources.getState().readOk).toMatchObject({ repos: false, proposals: false });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 3 }));
  });

  it('a 404 on a queue input is an empty list for the queue, but no count here', async () => {
    const { ApiError } = await import('../src/api/errors.js');
    memoryCoverage.mockResolvedValue({ total: 2 });
    listProposals.mockRejectedValue(new ApiError(404, 'no route', {}));
    listRepos.mockResolvedValue({ repos: [] });
    const { result } = renderHook(() => useMemoryReading(true));
    await act(async () => { await useNeedsSources.getState().load(); });
    expect(useNeedsSources.getState().proposals).toEqual([]);
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 2, indexedRepos: 0 }));
  });

  it('when the coverage read fails, nothing rejects unobserved', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
      memoryCoverage.mockRejectedValue(new Error('daemon down'));
      listProposals.mockResolvedValue(null);
      listRepos.mockResolvedValue({});
      const { result } = renderHook(() => useMemoryReading(true));
      await act(async () => { await useNeedsSources.getState().load(); });
      await waitFor(() => expect(result.current).toEqual({ state: 'down', reason: 'daemon down' }));
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('a proposal entry that cannot be read leaves the count out, never throws (codex r4 on 9d)', async () => {
    memoryCoverage.mockResolvedValue({ total: 5 });
    listProposals.mockResolvedValue([{}]);
    listRepos.mockResolvedValue({ repos: [] });
    const { result } = renderHook(() => useMemoryReading(true));
    await act(async () => { await useNeedsSources.getState().load(); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 5, indexedRepos: 0 }));
  });

  it('coming back to the window refreshes the queue inputs older than its 30 s window, so the counts follow (codex + agy r4 on 9d)', async () => {
    memoryCoverage.mockResolvedValue({ total: 1 });
    listProposals.mockResolvedValue([{ kind: 'memory' }]);
    listRepos.mockResolvedValue({ repos: [] });
    const { result } = renderHook(() => useMemoryReading(true));
    await act(async () => { await useNeedsSources.getState().load(); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 1, pending: 1, indexedRepos: 0 }));
    // away for a minute: two memory proposals arrived
    useNeedsSources.setState((s) => ({ readAt: { ...s.readAt, proposals: Date.now() - 60_000, repos: Date.now() - 60_000 } }));
    listProposals.mockResolvedValue([{ kind: 'memory' }, { kind: 'memory' }]);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 1, pending: 2, indexedRepos: 0 }));
  });

  it('a repository entry that is not a repository leaves the count out, never throws (codex r5 on 9d)', async () => {
    memoryCoverage.mockResolvedValue({ total: 2 });
    listProposals.mockResolvedValue([]);
    listRepos.mockResolvedValue({ repos: [null] });
    const { result } = renderHook(() => useMemoryReading(true));
    await act(async () => { await useNeedsSources.getState().load(); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 2, pending: 0 }));
  });

  it('entering the Desk asks the queue for inputs older than 30 s; a quick return reads nothing (codex r5 on 9d)', async () => {
    memoryCoverage.mockResolvedValue({ total: 1 });
    listProposals.mockResolvedValue([{ kind: 'memory' }]);
    listRepos.mockResolvedValue({ repos: [] });
    const { result, rerender } = renderHook(({ k }) => useMemoryReading(true, k), { initialProps: { k: 'work' } });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 1, pending: 1, indexedRepos: 0 }));
    expect(listProposals).toHaveBeenCalledTimes(1);
    rerender({ k: 'jobs' });
    rerender({ k: 'work' });
    await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
    expect(listProposals).toHaveBeenCalledTimes(1);
    // away inside studio for a minute: back on the Desk, the queue's expired inputs are read again
    useNeedsSources.setState((s) => ({ readAt: { ...s.readAt, proposals: Date.now() - 60_000, repos: Date.now() - 60_000 } }));
    listProposals.mockResolvedValue([{ kind: 'memory' }, { kind: 'memory' }]);
    rerender({ k: 'jobs' });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 1, pending: 2, indexedRepos: 0 }));
  });

  it('a deposit (another surface\'s write, maybe a local patch) never marks a failed register read as answered (codex r7 on 9d)', async () => {
    memoryCoverage.mockResolvedValue({ total: 0 });
    listProposals.mockResolvedValue([]);
    listRepos.mockResolvedValue({ repos: [{ code_graph_db: '/x/estate.db' }] });
    const { result } = renderHook(() => useMemoryReading(true));
    await act(async () => { await useNeedsSources.getState().load(); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 0, pending: 0, indexedRepos: 1 }));
    listRepos.mockRejectedValue(new Error('503'));
    await act(async () => { await useNeedsSources.getState().load(0); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 0, pending: 0 }));
    // the Repositories page adds one locally to its stale list
    act(() => { useNeedsSources.getState().depositRepos([...(useNeedsSources.getState().repos ?? []), { code_graph_db: '' } as never]); });
    expect(useNeedsSources.getState().readOk.repos).toBe(false);
    expect(result.current).toEqual({ state: 'ok', total: 0, pending: 0 });
  });

  it('accepting the last proposals never pairs a fresh zero with a total read before they were saved (codex r8 on 9d)', async () => {
    memoryCoverage.mockResolvedValueOnce({ total: 0 });
    listProposals.mockResolvedValue([{ kind: 'memory' }, { kind: 'memory' }]);
    listRepos.mockResolvedValue({ repos: [] });
    const { result } = renderHook(() => useMemoryReading(true));
    await act(async () => { await useNeedsSources.getState().load(); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 0, pending: 2, indexedRepos: 0 }));
    // both accepted: the queue reads an empty list; the total is being read again
    let answer!: (v: unknown) => void;
    memoryCoverage.mockReturnValue(new Promise((r) => { answer = r; }));
    listProposals.mockResolvedValue([]);
    await act(async () => { await useNeedsSources.getState().load(0); });
    // never "empty": the pending count waits for the total read with it
    expect(result.current).toEqual({ state: 'ok', total: 0, indexedRepos: 0 });
    await act(async () => { answer({ total: 2 }); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 2, pending: 0, indexedRepos: 0 }));
  });

  it('a poller depositing the same list every few seconds neither restarts the total nor withholds the count (codex r9 on 9d)', async () => {
    memoryCoverage.mockResolvedValue({ total: 3 });
    listProposals.mockResolvedValue([{ kind: 'memory' }]);
    listRepos.mockResolvedValue({ repos: [] });
    const { result } = renderHook(() => useMemoryReading(true));
    await act(async () => { await useNeedsSources.getState().load(); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 3, pending: 1, indexedRepos: 0 }));
    const reads = memoryCoverage.mock.calls.length;
    for (let i = 0; i < 3; i++) act(() => { useNeedsSources.getState().depositProposals([{ kind: 'memory' } as never]); });
    expect(memoryCoverage.mock.calls.length).toBe(reads);
    expect(result.current).toEqual({ state: 'ok', total: 3, pending: 1, indexedRepos: 0 });
  });

  it('a failed queue read is tried again after 30 s even while another surface keeps depositing (codex r9 on 9d)', async () => {
    let now = 1_000_000;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      listProposals.mockRejectedValueOnce(new Error('503'));
      await useNeedsSources.getState().loadRepos();
      await useNeedsSources.getState().load();
      expect(useNeedsSources.getState().readOk.proposals).toBe(false);
      now += 40_000;
      useNeedsSources.getState().depositProposals([{ kind: 'memory' } as never]);
      listProposals.mockResolvedValueOnce([{ kind: 'memory' }]);
      await useNeedsSources.getState().load(30_000);
      expect(listProposals).toHaveBeenCalledTimes(2);
      expect(useNeedsSources.getState().readOk.proposals).toBe(true);
    } finally {
      clock.mockRestore();
    }
  });
});
