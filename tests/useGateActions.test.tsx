import { renderHook, waitFor, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import { resetGateActionReadsForTest, useGateActions } from '../src/hooks/useGateActions.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useGateStore, type OpenGate } from '../src/store/gates.js';

/**
 * (studio#1170 review r2) A gate's list is read again whenever what it depends on changed since its newest read began —
 * while mounted, on a mount after a change (navigation), and when the key moved while a read was on its way — and a
 * re-pause at the same ord is read afresh. Only a daemon that serves the list is asked.
 */
const RUN = 'r-gate-actions-hook';
const LIST = [{ action: 'approve', intent: 'retry', note: 'optional' as const }];
const info = (over: Record<string, unknown> = {}) => ({ runId: RUN, ord: 4, prompt: 'p', lifecycle: 'open', receivedAt: '2026-11-17T00:00:00Z', actions: LIST, ...over });
const live = (receivedAt: number): OpenGate => ({ runId: RUN, ord: 4, prompt: 'p', lifecycle: 'open', receivedAt, gateKind: 'escalation' });
const hook = (refresh: string) => renderHook(({ r }) => useGateActions(RUN, useGateStore((s) => s.gates[RUN]), r), { initialProps: { r: refresh } });

beforeEach(() => {
  vi.restoreAllMocks();
  resetGateActionReadsForTest();
  useGateStore.setState({ gates: {}, approaching: {} });
  useCapabilities.setState({ gateActions: true });
});
afterEach(() => { cleanup(); useCapabilities.setState({ gateActions: false }); });

describe('useGateActions', () => {
  it('reads a live gate once, and its list replaces it', async () => {
    const get = vi.spyOn(client.api, 'getGate').mockResolvedValue(info() as never);
    useGateStore.getState().setGate(live(1));
    const { result } = hook('a');
    await waitFor(() => expect(result.current).toEqual(LIST));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('a mount after the key changed reads again (navigation away and back)', async () => {
    const get = vi.spyOn(client.api, 'getGate').mockResolvedValue(info() as never);
    useGateStore.getState().setGate(live(1));
    const first = hook('signed:claude');
    await waitFor(() => expect(first.result.current).toEqual(LIST));
    first.unmount();
    const again = hook('signed:claude,codex');
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    again.unmount();
    hook('signed:claude,codex');
    await new Promise((r) => setTimeout(r, 20));
    expect(get, 'same key: no third read').toHaveBeenCalledTimes(2);
  });

  it('a key that moves while the first read is on its way gets its own read', async () => {
    let release!: (v: unknown) => void;
    const get = vi.spyOn(client.api, 'getGate')
      .mockReturnValueOnce(new Promise((r) => { release = r; }) as never)
      .mockResolvedValue(info({ actions: [...LIST, { action: 'reject', intent: 'stop', note: 'none' }] }) as never);
    useGateStore.getState().setGate(live(1));
    const { result, rerender } = hook('qe:refused');
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    rerender({ r: 'qe:passed' });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    release(info());
    await waitFor(() => expect(result.current?.map((a) => a.action)).toEqual(['approve', 'reject']));
  });

  it('a re-pause at the same ord (a new live gate) is read afresh', async () => {
    const get = vi.spyOn(client.api, 'getGate').mockResolvedValue(info() as never);
    useGateStore.getState().setGate(live(1));
    const { result } = hook('k');
    await waitFor(() => expect(result.current).toEqual(LIST));
    useGateStore.getState().setGate(live(2));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('a daemon that does not serve the list is never asked', async () => {
    useCapabilities.setState({ gateActions: false });
    const get = vi.spyOn(client.api, 'getGate').mockResolvedValue(info() as never);
    useGateStore.getState().setGate(live(1));
    const { result } = hook('k');
    await new Promise((r) => setTimeout(r, 20));
    expect(get).not.toHaveBeenCalled();
    expect(result.current).toBeUndefined();
  });
});
