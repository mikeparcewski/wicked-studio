import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { Proposal } from '../src/api/proposals.js';
import type { SessionView } from '../src/api/types.js';

/**
 * useCapture (behaviour 8): the drop posts to crew's capture route, and the pending queue it
 * re-reads is DEPOSITED into the needs-you sources, so the rows land in Home's existing proposal
 * triage. There is no second review: nothing here approves or rejects.
 */

const { wire } = vi.hoisted(() => ({
  wire: {
    postCapture: vi.fn(async () => ({ runId: 'r-cap' })),
    listProposals: vi.fn(async (): Promise<Proposal[]> => []),
    approveProposal: vi.fn(),
    rejectProposal: vi.fn(),
  },
}));
vi.mock('../src/api/capture.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/capture.js')>()),
  postCapture: wire.postCapture,
}));
vi.mock('../src/api/proposals.js', async (orig) => ({
  ...(await orig<typeof import('../src/api/proposals.js')>()),
  listProposals: wire.listProposals,
  approveProposal: wire.approveProposal,
  rejectProposal: wire.rejectProposal,
}));

const { useCapture } = await import('../src/hooks/useCapture.js');
const { useCaptureStore } = await import('../src/store/capture.js');
const { useNeedsSources } = await import('../src/store/needsSources.js');

const filed = (id: string, runId = 'r-cap'): Proposal => ({
  id, kind_type: 'memory', payload: { content: id, tier: 'semantic', capture: 'decision' },
  facets: { project: 'p1' }, provenance: { run_id: runId }, state: 'pending', created_at: 1,
});
const run = (status: string): SessionView => ({ session: { id: 'r-cap', status } } as unknown as SessionView);

beforeEach(() => {
  vi.clearAllMocks();
  useCaptureStore.getState().clear();
});
afterEach(() => useCaptureStore.getState().clear());

describe('useCapture (behaviour 8)', () => {
  it('an empty drop sends nothing and says so', async () => {
    const { result } = renderHook(() => useCapture([], 10));
    let ok = true;
    await act(async () => { ok = await result.current.send('p1', 'P One', '   ', []); });
    expect(ok).toBe(false);
    expect(wire.postCapture).not.toHaveBeenCalled();
    expect(result.current.error).toBe('Add notes or a file to capture.');
  });

  it('sends the notes, then deposits the run\'s rows into the needs-you queue', async () => {
    wire.listProposals.mockResolvedValue([filed('a'), filed('b'), filed('x', 'r-other')]);
    const { result, rerender } = renderHook(({ runs }) => useCapture(runs, 10), { initialProps: { runs: [run('executing')] } });
    await act(async () => { await result.current.send('p1', 'P One', 'we chose presigned URLs', []); });
    expect(wire.postCapture).toHaveBeenCalledWith('p1', { notes: 'we chose presigned URLs' });
    expect(result.current.last).toMatchObject({ runId: 'r-cap', projectId: 'p1', projectName: 'P One' });
    await waitFor(() => expect(useNeedsSources.getState().proposals?.map((p) => p.id)).toEqual(['a', 'b', 'x']));
    await waitFor(() => expect(result.current.filed).toEqual({ seen: 2, waiting: 2, memoryOnly: 2, changesEnforcement: 0 }));
    expect(result.current.done).toBe(false);
    // The run ends: polling stops after one last read.
    rerender({ runs: [run('completed')] });
    await waitFor(() => expect(result.current.done).toBe(true));
    const reads = wire.listProposals.mock.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(wire.listProposals.mock.calls.length).toBeLessThanOrEqual(reads + 1);
    // Nothing is decided here: the triage owns accept / reject.
    expect(wire.approveProposal).not.toHaveBeenCalled();
    expect(wire.rejectProposal).not.toHaveBeenCalled();
  });

  it('a refused capture is said and starts nothing', async () => {
    wire.postCapture.mockRejectedValueOnce(new Error('a capture needs notes or at least one file'));
    const { result } = renderHook(() => useCapture([], 10));
    await act(async () => { await result.current.send('p1', 'P One', 'x', []); });
    expect(result.current.error).toBe('a capture needs notes or at least one file');
    expect(result.current.last).toBeNull();
  });
});
