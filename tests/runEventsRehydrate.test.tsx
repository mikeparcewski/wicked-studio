/**
 * studio#1009: a run's event log is read in full once per connection epoch, whatever the store holds. Live frames that
 * reached the store before any reader are only the log's tail; frames sent while the socket was down are lost, so a
 * log held from before a reconnect is read again. The merge keeps one copy of each frame.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent } from '../src/api/types.js';
import { useRunEvents, useRunEventsFor } from '../src/hooks/useRunEvents.js';
import { useConnectionStore } from '../src/store/connection.js';
import { useRunEventStore } from '../src/store/events.js';

const verdict = (run: string, seq: number, allow: boolean): CoreEvent =>
  ({ type: 'gateDecided', session: run, ord: 2, allow, seq, ts: 1_000 + seq }) as unknown as CoreEvent;
const denial = (run: string, seq: number, source: string): CoreEvent =>
  ({ type: 'gateEscalated', session: run, ord: 2, attempt: 0, condition: 'boundary_deny', denialSource: source, seq, ts: 1_000 + seq }) as unknown as CoreEvent;
/** The live copy of a recorded frame: no `ts`, no `seq`. */
const live = (e: CoreEvent): CoreEvent => {
  const rest = { ...(e as unknown as Record<string, unknown>) };
  delete rest['ts'];
  delete rest['seq'];
  return rest as unknown as CoreEvent;
};
const reconnect = (): void => {
  act(() => {
    useConnectionStore.getState().setStatus('disconnected');
    useConnectionStore.getState().setStatus('connected');
  });
};

beforeEach(() => {
  useConnectionStore.setState({ status: 'connecting', epoch: 0 });
  useRunEventStore.setState({ byRun: {} });
});
afterEach(() => { vi.restoreAllMocks(); });

describe('the connection epoch', () => {
  it('moves only when the socket comes back, not on the first connect', () => {
    const { setStatus } = useConnectionStore.getState();
    setStatus('connected');
    expect(useConnectionStore.getState().epoch).toBe(0);
    setStatus('disconnected');
    expect(useConnectionStore.getState().epoch).toBe(0);
    setStatus('connected');
    expect(useConnectionStore.getState().epoch).toBe(1);
    setStatus('connected');
    expect(useConnectionStore.getState().epoch).toBe(1);
  });
});

describe('useRunEvents reads the full log once per epoch', () => {
  it('live frames that came first do not stop the read: the recorded log is the prefix, nothing twice', async () => {
    const RUN = 'r-1009-a';
    const first = verdict(RUN, 1, false);
    const second = verdict(RUN, 2, true);
    useRunEventStore.getState().ingest(live(second));
    const read = vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [first, second] });
    const { result } = renderHook(() => useRunEvents(RUN));
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current.events!.map((e) => (e as { seq?: number }).seq)).toEqual([1, 2]);
  });

  it('a verdict that changed while the socket was down shows after it comes back', async () => {
    const RUN = 'r-1009-b';
    useConnectionStore.getState().setStatus('connected');
    const read = vi.spyOn(client.api, 'getRunEvents')
      .mockResolvedValueOnce({ events: [verdict(RUN, 1, false)] })
      .mockResolvedValueOnce({ events: [verdict(RUN, 1, false), verdict(RUN, 2, true)] });
    const { result } = renderHook(() => useRunEvents(RUN));
    await waitFor(() => expect(result.current.events).toHaveLength(1));
    // the first connect after the read is not a reconnect: no second read
    expect(read).toHaveBeenCalledTimes(1);
    reconnect();
    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(read).toHaveBeenCalledTimes(2);
    expect((result.current.events!.at(-1) as { allow?: boolean }).allow).toBe(true);
  });

  it('a held log read in this epoch is not read again', async () => {
    const RUN = 'r-1009-c';
    const read = vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [verdict(RUN, 1, false)] });
    const a = renderHook(() => useRunEvents(RUN));
    await waitFor(() => expect(a.result.current.events).toHaveLength(1));
    const b = renderHook(() => useRunEvents(RUN));
    expect(b.result.current.events).toHaveLength(1);
    await act(async () => { await Promise.resolve(); });
    expect(read).toHaveBeenCalledTimes(1);
  });
});

describe('useRunEventsFor re-reads the rows\' logs after a reconnect', () => {
  it('a denial source that changed while the socket was down shows after it comes back', async () => {
    const RUN = 'r-1009-d';
    useConnectionStore.getState().setStatus('connected');
    const read = vi.spyOn(client.api, 'getRunEvents')
      .mockResolvedValueOnce({ events: [denial(RUN, 1, 'input_governance')] })
      .mockResolvedValueOnce({ events: [denial(RUN, 1, 'input_governance'), denial(RUN, 2, 'rule')] });
    const { result } = renderHook(() => useRunEventsFor([RUN]));
    await waitFor(() => expect(result.current[RUN]).toHaveLength(1));
    reconnect();
    await waitFor(() => expect(result.current[RUN]).toHaveLength(2));
    expect(read).toHaveBeenCalledTimes(2);
    expect((result.current[RUN]!.at(-1) as { denialSource?: string }).denialSource).toBe('rule');
  });

  it('a run whose live frames came first is read in full too', async () => {
    const RUN = 'r-1009-e';
    useRunEventStore.getState().ingest(live(denial(RUN, 2, 'rule')));
    const read = vi.spyOn(client.api, 'getRunEvents').mockResolvedValue({ events: [denial(RUN, 1, 'input_governance'), denial(RUN, 2, 'rule')] });
    const { result } = renderHook(() => useRunEventsFor([RUN]));
    await waitFor(() => expect(result.current[RUN]).toHaveLength(2));
    expect(read).toHaveBeenCalledTimes(1);
  });
});
