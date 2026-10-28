// (J4 0.16.6) The run page said "Working" through a 25-30 min silent worker turn while Nerve said stalled.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { CoreEvent } from '../src/api/types.js';
import { lastActivityAt, silentStep, silentWords, SILENT_AFTER_MS } from '../src/board/silentStep.js';
import { SilentStepCard } from '../src/components/session/SilentStepCard.js';
import { api } from '../src/api/client.js';
import { makeUnit, makeView } from './factories.js';

const T0 = 1_793_000_000_000;
const MIN = 60_000;
const view = (status = 'executing') => makeView({ id: 'r1', status: status as never, unit_ix: 1 } as never, [
  makeUnit({ id: 'r1:triage', session_id: 'r1', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: 'r1:reproduce', session_id: 'r1', ord: 2, stage: 'design' as never, status: 'distributed', assigned_cli: 'codex' }),
]);
const ev = (type: string, ts: number): CoreEvent => ({ type, session: 'r1', ord: 2, ts }) as unknown as CoreEvent;

describe('a running step silent past crew\'s quiet mark', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('says "No output for N min" from 5 min on, and the daemon\'s stall frames never reset the clock', () => {
    const events = [ev('unitDispatched', T0), ev('workerStalled', T0 + 15 * MIN)];
    expect(lastActivityAt(events)).toBe(T0);
    expect(silentStep(view(), events, T0 + SILENT_AFTER_MS - 1)).toBeNull();
    const s = silentStep(view(), events, T0 + 21 * MIN)!;
    expect(s).toEqual({ minutes: 21, ord: 2, cli: 'codex' });
    expect(silentWords(s)).toBe('No output for 21 min');
    // A live frame that arrived later is activity; a gate, or a run not executing, is not silence.
    expect(silentStep(view(), events, T0 + 21 * MIN, { liveAt: T0 + 20 * MIN })).toBeNull();
    expect(silentStep(view(), events, T0 + 21 * MIN, { gateOpen: true })).toBeNull();
    expect(silentStep(view('awaiting_human'), events, T0 + 21 * MIN)).toBeNull();
  });

  it('the card names the helper and the step, and offers the executing run\'s levers', async () => {
    const reassign = vi.spyOn(api, 'reassignRun').mockResolvedValue({ status: 'ok', ord: 2, cli: 'pi' });
    const inject = vi.spyOn(api, 'injectMessage').mockResolvedValue({} as never);
    render(<SilentStepCard view={view()} silent={{ minutes: 21, ord: 2, cli: 'codex' }} name={(c) => (c === 'codex' ? 'Codex' : 'Pi CLI')} />);
    expect(screen.getByTestId('silent-step-headline').textContent).toBe('No output for 21 min from Codex on Reproduce');
    fireEvent.click(screen.getByTestId('silent-step-nudge'));
    await waitFor(() => expect(inject).toHaveBeenCalledWith('r1', expect.stringContaining('silent'), 'all'));
    fireEvent.click(screen.getByTestId('silent-step-move'));
    await waitFor(() => expect(screen.getByTestId('silent-step-note').textContent).toBe('Reproduce is running again on Pi CLI.'));
    expect(reassign).toHaveBeenCalledWith('r1');
  });
});

describe('pr-xreview on #924: a helper streaming output is not silent', () => {
  it('a live output delta (never logged) resets the clock the run page reads', async () => {
    const { renderHook } = await import('@testing-library/react');
    const { useSilentStep } = await import('../src/hooks/useSilentStep.js');
    const { useRuntimeStore } = await import('../src/store/runtime.js');
    const { useRunEventStore } = await import('../src/store/events.js');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(T0 + 6 * MIN);
      const v = view();
      useRunEventStore.setState({ byRun: { r1: [ev('unitDispatched', T0)] } });
      useRuntimeStore.getState().clear('r1');
      expect(renderHook(() => useSilentStep(v)).result.current?.minutes).toBe(6);
      // The helper streams a line now: no structured frame, only the delta.
      useRuntimeStore.getState().ingest({ type: 'unitOutputDelta', session: 'r1', ord: 2, text: 'still working…' } as unknown as CoreEvent);
      expect(useRuntimeStore.getState().deltaAt['r1']).toBe(T0 + 6 * MIN);
      expect(renderHook(() => useSilentStep(v)).result.current).toBeNull();
      // A reload replays the trail: the replayed delta's own time counts too.
      useRuntimeStore.getState().clear('r1');
      useRuntimeStore.getState().hydrateOutputs('r1', [{ type: 'unitOutputDelta', session: 'r1', ord: 2, text: 'x', ts: T0 + 5 * MIN } as unknown as CoreEvent]);
      expect(renderHook(() => useSilentStep(v)).result.current).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
