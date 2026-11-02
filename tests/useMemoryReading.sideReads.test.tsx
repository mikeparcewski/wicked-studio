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
vi.mock('../src/api/proposals.js', () => ({ listProposals, proposalKind: (p: { kind?: string }) => p.kind ?? 'memory' }));

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
    const { result } = renderHook(() => useMemoryReading(true));
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 12 }));
    expect(listProposals).not.toHaveBeenCalled();
    expect(listRepos).not.toHaveBeenCalled();
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
});
