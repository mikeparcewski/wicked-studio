// DES-frontdoor P: "Quality checks passed" — failed reads are said, never counted as "none recorded".
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const getRunAcceptance = vi.fn();
vi.mock('../src/api/client.js', () => ({ api: { getRunAcceptance: (id: string) => getRunAcceptance(id) } }));
const { useQualityChecks } = await import('../src/hooks/useQualityChecks.js');

describe('useQualityChecks', () => {
  it('tallies recorded verdicts and counts failed reads apart', async () => {
    getRunAcceptance.mockImplementation((id: string) => (id === 'bad'
      ? Promise.reject(new Error('503'))
      : Promise.resolve({ runId: id, gate: { required: true, satisfied: id === 'ok', verdict: id === 'none' ? null : id === 'ok' ? 'PASS' : 'FAIL', runStatus: null, reason: '' } })));
    const { result } = renderHook(() => useQualityChecks(['ok', 'fail', 'none', 'bad']));
    await waitFor(() => expect(result.current.tally).not.toBeNull());
    expect(result.current.tally).toEqual({ read: 3, recorded: 2, passed: 1 });
    expect(result.current.failed).toBe(1);
  });

  it('a read with no gate counts as read, with nothing recorded', async () => {
    getRunAcceptance.mockResolvedValue({ runId: 'x' });
    const { result } = renderHook(() => useQualityChecks(['x', 'y']));
    await waitFor(() => expect(result.current.tally).not.toBeNull());
    expect(result.current.tally).toEqual({ read: 2, recorded: 0, passed: 0 });
    expect(result.current.failed).toBe(0);
  });

  it('reads again when the work moves for the same jobs', async () => {
    getRunAcceptance.mockResolvedValue({ runId: 'a', gate: { required: true, satisfied: false, verdict: null, runStatus: null, reason: '' } });
    const { result, rerender } = renderHook(({ w }) => useQualityChecks(['a'], w), { initialProps: { w: '1' } });
    await waitFor(() => expect(result.current.tally?.recorded).toBe(0));
    getRunAcceptance.mockResolvedValue({ runId: 'a', gate: { required: true, satisfied: true, verdict: 'PASS', runStatus: null, reason: '' } });
    rerender({ w: '2' });
    await waitFor(() => expect(result.current.tally?.passed).toBe(1));
  });
});
