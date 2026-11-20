/**
 * studio#1203: a brief 503 (crew's gate_actions_unavailable) on the in-place skip-QE read hid the offer until the card
 * remounted. The read now retries with the main gate read's backoff until it lands.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { ApiError } from '../src/api/errors.js';
import { GATE_RETRY_BASE_MS } from '../src/board/gateActions.js';
import { useGateSkipQe } from '../src/hooks/useGateSkipQe.js';

const OFFER = { action: 'skip_qe', reasonRequired: true };
const info = { runId: 'r', ord: 2, prompt: 'p', lifecycle: 'open', receivedAt: '', skipQe: OFFER };

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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
});
