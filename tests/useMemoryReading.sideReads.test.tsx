/**
 * The Desk's memory reading: its side reads (pending memory proposals, indexed repositories) settle to a count or
 * nothing, whatever they answer (CI r9b: `listRepos` answering without `repos` threw inside its success callback,
 * past its own rejection handler, and left unhandled rejections that failed the run).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const listRepos = vi.fn();
const memoryCoverage = vi.fn();
const listProposals = vi.fn();
vi.mock('../src/api/client.js', () => ({ api: { listRepos } }));
vi.mock('../src/api/memory.js', () => ({ memoryCoverage, isMemoryUnsupported: () => false }));
vi.mock('../src/api/proposals.js', () => ({ listProposals, proposalKind: () => 'memory' }));

const { useMemoryReading } = await import('../src/hooks/useMemoryReading.js');

describe('useMemoryReading side reads', () => {
  afterEach(() => vi.clearAllMocks());

  it('a repositories answer without `repos` leaves the count out; the reading still lands', async () => {
    memoryCoverage.mockResolvedValue({ total: 12 });
    listProposals.mockResolvedValue([{}, {}]);
    listRepos.mockResolvedValue({});
    const { result } = renderHook(() => useMemoryReading(true));
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 12, pending: 2 }));
  });

  it('a proposals answer that is not a list leaves its count out', async () => {
    memoryCoverage.mockResolvedValue({ total: 3 });
    listProposals.mockResolvedValue({ proposals: [] });
    listRepos.mockResolvedValue({ repos: [{ code_graph_db: '/x/estate.db' }, { code_graph_db: '' }] });
    const { result } = renderHook(() => useMemoryReading(true));
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 3, indexedRepos: 1 }));
  });

  it('when the coverage read fails, an odd side answer rejects nothing unobserved', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown): void => { unhandled.push(e); };
    process.on('unhandledRejection', onUnhandled);
    try {
      memoryCoverage.mockRejectedValue(new Error('daemon down'));
      listProposals.mockResolvedValue(null);
      listRepos.mockResolvedValue({});
      const { result } = renderHook(() => useMemoryReading(true));
      await waitFor(() => expect(result.current).toEqual({ state: 'down', reason: 'daemon down' }));
      await new Promise((r) => setTimeout(r, 20));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('reads /proposals and /repos once with Home\u2019s queue, not again on its own (needs_shell)', async () => {
    const { useNeedsSources } = await import('../src/store/needsSources.js');
    memoryCoverage.mockResolvedValue({ total: 4 });
    listProposals.mockResolvedValue([{}]);
    listRepos.mockResolvedValue({ repos: [{ code_graph_db: '/x/estate.db' }] });
    const home = useNeedsSources.getState().load();
    const { result } = renderHook(() => useMemoryReading(true));
    await home;
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 4, pending: 1, indexedRepos: 1 }));
    expect(listProposals).toHaveBeenCalledTimes(1);
    expect(listRepos).toHaveBeenCalledTimes(1);
  });

  it('a read that FAILED is left out, though the queue keeps a value: a 404, or a later failure after an answer (codex + agy on 9d)', async () => {
    const { ApiError } = await import('../src/api/errors.js');
    memoryCoverage.mockResolvedValue({ total: 2 });
    listProposals.mockRejectedValue(new ApiError(404, 'no route', {}));
    listRepos.mockResolvedValue({ repos: [] });
    const { result, unmount } = renderHook(() => useMemoryReading(true));
    // the queue reads the 404 as an empty list; the memory reading does not count it as "none"
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 2, indexedRepos: 0 }));
    unmount();
  });

  it('coming back to the window reads the side inputs again, whatever their age; a failed re-read is left out (codex + agy on 9d)', async () => {
    memoryCoverage.mockResolvedValue({ total: 2 });
    listProposals.mockResolvedValue([]);
    listRepos.mockResolvedValue({ repos: [] });
    const { result } = renderHook(() => useMemoryReading(true));
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 2, pending: 0, indexedRepos: 0 }));
    expect(listProposals).toHaveBeenCalledTimes(1);
    // the daemon filed a memory proposal meanwhile; the operator comes back within 30 s
    listProposals.mockResolvedValue([{}]);
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 2, pending: 1, indexedRepos: 0 }));
    expect(listProposals).toHaveBeenCalledTimes(2);
    // and a re-read that fails is left out, not the old count
    listProposals.mockRejectedValue(new Error('503'));
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(result.current).toEqual({ state: 'ok', total: 2, indexedRepos: 0 }));
  });
});
