import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/** The rail's Health dot re-reads on window focus and socket reconnect (codex review r1), never stuck on its mount read. */
const getHealth = vi.fn<() => Promise<{ status: string }>>();
vi.mock('../src/api/client.js', () => ({
  api: {
    getHealth: () => getHealth(),
    getRoster: () => Promise.resolve({ roster: [] }),
  },
}));
const getDiagnostics = vi.fn(() => Promise.resolve({}));
vi.mock('../src/api/diagnostics.js', () => ({ getDiagnostics: () => getDiagnostics(), isDiagnosticsUnsupported: (e: unknown) => (e as { status?: number }).status === 404 }));

import { HEALTH_RECHECKED, useRailHealthDot } from '../src/hooks/useRailHealthDot.js';
import { useConnectionStore } from '../src/store/connection.js';

afterEach(() => { getHealth.mockReset(); getHealth.mockResolvedValue({ status: 'ok' }); });

describe('useRailHealthDot', () => {
  it('a failed mount read turns healthy again after the window regains focus', async () => {
    useConnectionStore.setState({ status: 'connected' } as never);
    getHealth.mockResolvedValue({ status: 'ok' });
    getHealth.mockRejectedValueOnce(new Error('down'));
    const { result } = renderHook(() => useRailHealthDot());
    await waitFor(() => expect(result.current.heartState).toBe('degraded'));
    getHealth.mockResolvedValue({ status: 'ok' });
    act(() => { window.dispatchEvent(new Event('focus')); });
    await waitFor(() => expect(result.current.heartState).toBe('healthy'));
  });

  it('re-reads when the socket reconnects', async () => {
    useConnectionStore.setState({ status: 'connected' } as never);
    getHealth.mockResolvedValue({ status: 'ok' });
    renderHook(() => useRailHealthDot());
    await waitFor(() => expect(getHealth).toHaveBeenCalled());
    const before = getHealth.mock.calls.length;
    act(() => { useConnectionStore.setState({ status: 'disconnected' } as never); });
    act(() => { useConnectionStore.setState({ status: 'connected' } as never); });
    await waitFor(() => expect(getHealth.mock.calls.length).toBeGreaterThan(before));
  });

  it('re-reads when /health rechecks, and an unsupported /diagnostics leaves an otherwise healthy dot healthy', async () => {
    useConnectionStore.setState({ status: 'connected' } as never);
    getHealth.mockResolvedValue({ status: 'ok' });
    getDiagnostics.mockImplementation(() => Promise.reject(Object.assign(new Error('nf'), { status: 404 })));
    const { result } = renderHook(() => useRailHealthDot());
    await waitFor(() => expect(getHealth).toHaveBeenCalled());
    await waitFor(() => expect(result.current.heartState).toBe('healthy'));
    const before = getHealth.mock.calls.length;
    act(() => { window.dispatchEvent(new Event(HEALTH_RECHECKED)); });
    await waitFor(() => expect(getHealth.mock.calls.length).toBeGreaterThan(before));
  });
});
