import { describe, it, expect, beforeEach } from 'vitest';
import { useGateStore } from '../src/store/gates.js';
import type { CoreEvent } from '../src/api/types.js';

const reset = (): void => useGateStore.setState({ gates: {} });

describe('gate cache (§3.3 — event-sourced, self-healing, keyed by run id)', () => {
  beforeEach(reset);

  it('opens a gate from an awaitingHuman frame', () => {
    useGateStore.getState().ingest({
      type: 'awaitingHuman',
      session: 'run-1',
      ord: 2,
      prompt: 'Proceed?',
    } as CoreEvent);
    const gate = useGateStore.getState().gates['run-1'];
    expect(gate).toMatchObject({ runId: 'run-1', ord: 2, prompt: 'Proceed?', lifecycle: 'open' });
  });

  it('ignores an awaitingHuman frame missing the prompt or ord', () => {
    useGateStore.getState().ingest({ type: 'awaitingHuman', session: 'run-1' } as CoreEvent);
    expect(useGateStore.getState().gates['run-1']).toBeUndefined();
  });

  it.each(['resumed', 'sessionCompleted', 'runCancelled', 'sessionFailed'])(
    'prunes the gate on a %s frame',
    (type) => {
      useGateStore.setState({
        gates: { 'run-1': { runId: 'run-1', ord: 1, prompt: 'x', lifecycle: 'open', receivedAt: 0 } },
      });
      useGateStore.getState().ingest({ type, session: 'run-1' } as CoreEvent);
      expect(useGateStore.getState().gates['run-1']).toBeUndefined();
    },
  );

  it('ignores frames with no run scope (e.g. heartbeat)', () => {
    useGateStore.getState().ingest({ type: 'heartbeat' } as CoreEvent);
    expect(Object.keys(useGateStore.getState().gates)).toHaveLength(0);
  });

  it('reconcile keeps only still-awaiting runs (self-healing)', () => {
    useGateStore.setState({
      gates: {
        'run-1': { runId: 'run-1', ord: 1, prompt: 'a', lifecycle: 'open', receivedAt: 0 },
        'run-2': { runId: 'run-2', ord: 1, prompt: 'b', lifecycle: 'open', receivedAt: 0 },
      },
    });
    useGateStore.getState().reconcile(['run-1']); // run-2 no longer awaiting
    expect(useGateStore.getState().gates['run-1']).toBeDefined();
    expect(useGateStore.getState().gates['run-2']).toBeUndefined();
  });
});
