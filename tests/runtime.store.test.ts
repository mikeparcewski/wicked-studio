import { describe, it, expect, beforeEach } from 'vitest';
import { useRuntimeStore, outputKey } from '../src/store/runtime.js';
import type { CoreEvent } from '../src/api/types.js';

const reset = (): void => useRuntimeStore.setState({ outputs: {}, logs: {}, executorTypes: {}, seq: 0 });
const delta = (session: string, ord: number, chunk: string): CoreEvent =>
  ({ type: 'cliOutputDelta', session, ord, chunk } as CoreEvent);

describe('runtime store (§11.4 — live output + per-run event log)', () => {
  beforeEach(reset);

  it('accumulates cliOutputDelta per (run, unit), keyed <run>:u<ord>', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest(delta('run-1', 0, 'hello '));
    ingest(delta('run-1', 0, 'world'));
    expect(useRuntimeStore.getState().outputs[outputKey('run-1', 0)]).toBe('hello world');
  });

  it('keeps output for different units separate', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest(delta('run-1', 0, 'A'));
    ingest(delta('run-1', 1, 'B'));
    expect(useRuntimeStore.getState().outputs[outputKey('run-1', 0)]).toBe('A');
    expect(useRuntimeStore.getState().outputs[outputKey('run-1', 1)]).toBe('B');
  });

  it('logs lifecycle frames to the per-run log but NOT output deltas', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'unitDistributed', session: 'run-1', ord: 0, cli: 'claude' } as CoreEvent);
    ingest(delta('run-1', 0, 'noise'));
    const log = useRuntimeStore.getState().logs['run-1'] ?? [];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ type: 'unitDistributed', ord: 0 });
    expect(log[0]?.detail).toContain('claude');
  });

  it('ignores heartbeats and run-less frames', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'heartbeat' } as CoreEvent);
    ingest({ type: 'repoRegistered', repoRef: 'r1' } as CoreEvent);
    expect(Object.keys(useRuntimeStore.getState().logs)).toHaveLength(0);
    expect(Object.keys(useRuntimeStore.getState().outputs)).toHaveLength(0);
  });

  it('clear() drops a run\'s output and log', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest(delta('run-1', 0, 'x'));
    ingest({ type: 'unitDone', session: 'run-1', ord: 0 } as CoreEvent);
    useRuntimeStore.getState().clear('run-1');
    expect(useRuntimeStore.getState().outputs[outputKey('run-1', 0)]).toBeUndefined();
    expect(useRuntimeStore.getState().logs['run-1']).toBeUndefined();
  });

  it('records executor_type from unitPlanned events', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'unitPlanned', session: 'run-1', ord: 0, description: 'task', executor_type: 'agent' } as CoreEvent);
    ingest({ type: 'unitPlanned', session: 'run-1', ord: 1, description: 'cmd', executor_type: 'tool' } as CoreEvent);
    const { executorTypes } = useRuntimeStore.getState();
    expect(executorTypes['run-1:0']).toBe('agent');
    expect(executorTypes['run-1:1']).toBe('tool');
  });

  it('clear() drops executorTypes for the run', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'unitPlanned', session: 'run-1', ord: 0, description: 'task', executor_type: 'agent' } as CoreEvent);
    useRuntimeStore.getState().clear('run-1');
    expect(useRuntimeStore.getState().executorTypes['run-1:0']).toBeUndefined();
  });
});
