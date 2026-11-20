/**
 * studio#1203: a brief 503 (crew's gate_actions_unavailable) on the in-place skip-QE read hid the offer until the card
 * remounted. The read now retries with the main gate read's backoff until it lands.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import { GATE_READS_IN_FLIGHT, GATE_RETRY_BASE_MS, resetGateSlotsForTest } from '../src/board/gateActions.js';
import { useGateSkipQe } from '../src/hooks/useGateSkipQe.js';

const OFFER = { action: 'skip_qe', reasonRequired: true };
const info = { runId: 'r', ord: 2, prompt: 'p', lifecycle: 'open', receivedAt: '', skipQe: OFFER };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { resetGateSlotsForTest(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useGateSkipQe retries a failed read (studio#1203)', () => {
  it('shows the offer once a read after a 503 lands', async () => {
    const get = vi.spyOn(client.api, 'getGate')
      .mockRejectedValueOnce(new ApiError(503, 'gate_actions_unavailable'))
      .mockResolvedValue(info as never);
    const { result } = renderHook(() => useGateSkipQe('r', 'i', 2, true));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.current).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(GATE_RETRY_BASE_MS + 1); });
    expect(get).toHaveBeenCalledTimes(2);
    expect(result.current).toEqual(OFFER);
  });

  it('treats a 404 as an answer and stops', async () => {
    const get = vi.spyOn(client.api, 'getGate').mockRejectedValue(new ApiError(404, 'No open gate'));
    renderHook(() => useGateSkipQe('r', 'i', 2, true));
    await vi.advanceTimersByTimeAsync(GATE_RETRY_BASE_MS * 10);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('stops retrying when the card goes', async () => {
    const get = vi.spyOn(client.api, 'getGate').mockRejectedValue(new ApiError(503, 'x'));
    const { unmount } = renderHook(() => useGateSkipQe('r', 'i', 2, true));
    await vi.advanceTimersByTimeAsync(0);
    unmount();
    await vi.advanceTimersByTimeAsync(GATE_RETRY_BASE_MS * 10);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('never has more than the shared slots in flight when many cards retry (the read slots)', async () => {
    let inFlight = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    let calls = 0;
    vi.spyOn(client.api, 'getGate').mockImplementation(() => {
      if (calls++ < 12) return Promise.reject(new ApiError(503, 'x'));
      inFlight += 1; peak = Math.max(peak, inFlight);
      return new Promise((_r, rej) => { release.push(() => { inFlight -= 1; rej(new ApiError(503, 'x')); }); });
    });
    for (let i = 0; i < 12; i++) renderHook(() => useGateSkipQe(`r${i}`, 'i', 2, true));
    await vi.advanceTimersByTimeAsync(GATE_RETRY_BASE_MS + 1);
    expect(inFlight).toBe(GATE_READS_IN_FLIGHT);
    expect(peak).toBe(GATE_READS_IN_FLIGHT);
    expect(release).toHaveLength(GATE_READS_IN_FLIGHT);
  });
});
