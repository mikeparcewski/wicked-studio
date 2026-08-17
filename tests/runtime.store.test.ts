import { describe, it, expect, beforeEach } from 'vitest';
import { useRuntimeStore, outputKey } from '../src/store/runtime.js';
import type { CoreEvent } from '../src/api/types.js';

const reset = (): void =>
  useRuntimeStore.setState({ outputs: {}, logs: {}, executorTypes: {}, terminalIds: {}, councilStatus: {}, seq: 0 });
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

  // The delta-relay spelling of the live-output frame (unitOutputDelta) folds into the SAME
  // per-(run, unit) buffer as cliOutputDelta — one buffer, whichever frame the daemon emits.
  it('accumulates unitOutputDelta into the same buffer as cliOutputDelta', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'unitOutputDelta', session: 'run-1', ord: 0, text: 'hello ' } as CoreEvent);
    ingest({ type: 'unitOutputDelta', session: 'run-1', ord: 0, text: 'relay' } as CoreEvent);
    expect(useRuntimeStore.getState().outputs[outputKey('run-1', 0)]).toBe('hello relay');
    // Interleaved spellings still append in arrival order.
    ingest(delta('run-1', 0, '!'));
    expect(useRuntimeStore.getState().outputs[outputKey('run-1', 0)]).toBe('hello relay!');
  });

  it('does not log unitOutputDelta frames (high-volume, stream-only)', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'unitOutputDelta', session: 'run-1', ord: 0, text: 'noise' } as CoreEvent);
    expect(useRuntimeStore.getState().logs['run-1']).toBeUndefined();
  });

  it('ignores a unitOutputDelta with no ord or no chunk', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'unitOutputDelta', session: 'run-1', text: 'x' } as CoreEvent);
    ingest({ type: 'unitOutputDelta', session: 'run-1', ord: 0 } as CoreEvent);
    expect(Object.keys(useRuntimeStore.getState().outputs)).toHaveLength(0);
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

  it('summarizes stepFailed using the event detail field', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'stepFailed', session: 'run-1', ord: 0, attempt: 2, detail: 'timeout', failureKind: 'timeout' } as CoreEvent);
    const log = useRuntimeStore.getState().logs['run-1'] ?? [];
    expect(log[0]).toMatchObject({ type: 'stepFailed', detail: 'timeout', attempt: 2 });
  });

  it('summarizes crashRecoveryRedrive with attempt number', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'crashRecoveryRedrive', session: 'run-1', ord: 0, attempt: 3 } as CoreEvent);
    const log = useRuntimeStore.getState().logs['run-1'] ?? [];
    expect(log[0]).toMatchObject({ type: 'crashRecoveryRedrive', detail: 'attempt 3', attempt: 3 });
  });

  // hydrateOutputs: the late-join replay for `outputs`. /ws has no replay, so a page opened
  // after a unit started never saw the already-streamed text (the run-thread render gap) —
  // the persisted trail (GET /runs/:id/events) backfills it, per-key guarded against
  // double-counting frames the live socket already appended.
  describe('hydrateOutputs (persisted-trail backfill)', () => {
    const relay = (session: string, ord: number, text: string): CoreEvent =>
      ({ type: 'unitOutputDelta', session, ord, attempt: 0, text } as CoreEvent);

    it('folds persisted deltas (both spellings) into the per-(run, unit) buffers', () => {
      useRuntimeStore.getState().hydrateOutputs('run-1', [
        relay('run-1', 1, 'hello '),
        { type: 'unitDone', session: 'run-1', ord: 1 } as CoreEvent,
        relay('run-1', 2, 'world'),
        delta('run-1', 2, '!'),
      ]);
      expect(useRuntimeStore.getState().outputs[outputKey('run-1', 1)]).toBe('hello ');
      expect(useRuntimeStore.getState().outputs[outputKey('run-1', 2)]).toBe('world!');
    });

    it('never touches a buffer a live frame already started (no double-count, live wins)', () => {
      useRuntimeStore.getState().ingest(relay('run-1', 2, 'live text'));
      useRuntimeStore.getState().hydrateOutputs('run-1', [
        relay('run-1', 1, 'replayed u1'),
        relay('run-1', 2, 'replayed u2'), // same delta the socket already delivered
      ]);
      const { outputs } = useRuntimeStore.getState();
      expect(outputs[outputKey('run-1', 2)]).toBe('live text');
      expect(outputs[outputKey('run-1', 1)]).toBe('replayed u1');
    });

    it('ignores other runs\' frames and non-delta frames', () => {
      useRuntimeStore.getState().hydrateOutputs('run-1', [
        relay('run-2', 1, 'someone else'),
        { type: 'unitExecuting', session: 'run-1', ord: 1 } as CoreEvent,
        relay('run-1', 1, 'mine'),
      ]);
      const { outputs } = useRuntimeStore.getState();
      expect(outputs[outputKey('run-1', 1)]).toBe('mine');
      expect(outputs[outputKey('run-2', 1)]).toBeUndefined();
    });

    it('caps a replayed buffer at the same limit as the live path', () => {
      useRuntimeStore.getState().hydrateOutputs('run-1', [
        relay('run-1', 1, 'HEAD-' + 'x'.repeat(250_000) + '-TAIL'),
      ]);
      const buf = useRuntimeStore.getState().outputs[outputKey('run-1', 1)] ?? '';
      expect(buf).toHaveLength(200_000);
      expect(buf.endsWith('-TAIL')).toBe(true);
      expect(buf).not.toContain('HEAD-');
    });
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

  it('records terminalId from workerSessionStarted events keyed <run>:<cliKey>', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'workerSessionStarted', session: 'run-1', cliKey: 'claude', terminalId: 'tid-abc' } as CoreEvent);
    ingest({ type: 'workerSessionStarted', session: 'run-1', cliKey: 'codex', terminalId: 'tid-xyz' } as CoreEvent);
    const { terminalIds } = useRuntimeStore.getState();
    expect(terminalIds['run-1:claude']).toBe('tid-abc');
    expect(terminalIds['run-1:codex']).toBe('tid-xyz');
  });

  it('ignores workerSessionStarted without required fields', () => {
    const ingest = useRuntimeStore.getState().ingest;
    // missing terminalId
    ingest({ type: 'workerSessionStarted', session: 'run-1', cliKey: 'claude' } as CoreEvent);
    // missing cliKey
    ingest({ type: 'workerSessionStarted', session: 'run-1', terminalId: 'tid-abc' } as CoreEvent);
    expect(Object.keys(useRuntimeStore.getState().terminalIds)).toHaveLength(0);
  });

  it('clear() drops terminalIds for the run, preserving other runs', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'workerSessionStarted', session: 'run-1', cliKey: 'claude', terminalId: 'tid-1' } as CoreEvent);
    ingest({ type: 'workerSessionStarted', session: 'run-2', cliKey: 'claude', terminalId: 'tid-2' } as CoreEvent);
    useRuntimeStore.getState().clear('run-1');
    const { terminalIds } = useRuntimeStore.getState();
    expect(terminalIds['run-1:claude']).toBeUndefined();
    expect(terminalIds['run-2:claude']).toBe('tid-2');
  });
  // A seat that is polled and does not vote used to be invisible: the council simply reported a
  // smaller vote count, or degraded with one unusable sentence. These pin the frame that names it.
  const seatFailed = (session: string, ord: number, cli: string, extra: Record<string, unknown> = {}): CoreEvent =>
    ({ type: 'councilSeatFailed', session, ord, round: 1, cli, kind: 'spawn_failed', detail: 'No such file or directory', ...extra } as CoreEvent);

  it('accumulates councilSeatFailed onto the unit council status', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'councilConvened', session: 'run-1', ord: 0, clis: ['claude', 'codex', 'pi'] } as CoreEvent);
    ingest(seatFailed('run-1', 0, 'codex'));
    ingest(seatFailed('run-1', 0, 'pi', { kind: 'non_zero_exit', exitCode: 1, stderr: 'unknown flag --print' }));
    const status = useRuntimeStore.getState().councilStatus['run-1:0'];
    expect(status?.failedSeats).toHaveLength(2);
    expect(status?.failedSeats?.[0]).toMatchObject({ cli: 'codex', kind: 'spawn_failed' });
    // stderr is preferred over detail: it is what the seat itself said.
    expect(status?.failedSeats?.[1]).toMatchObject({ cli: 'pi', kind: 'non_zero_exit', exitCode: 1, why: 'unknown flag --print' });
    // The convened roster is not lost when a seat fails.
    expect(status?.clis).toEqual(['claude', 'codex', 'pi']);
  });

  it('keeps failed seats when the council later votes', () => {
    // The regression that matters: seats fail BEFORE the vote, and councilVoted replaces the
    // status object. Dropping them there would erase the quorum context at exactly the moment
    // the agreement percentage needs qualifying.
    const ingest = useRuntimeStore.getState().ingest;
    ingest({ type: 'councilConvened', session: 'run-1', ord: 0, clis: ['claude', 'codex'] } as CoreEvent);
    ingest(seatFailed('run-1', 0, 'codex'));
    ingest({ type: 'councilVoted', session: 'run-1', ord: 0, agreementPct: 100, votes: 1 } as CoreEvent);
    const status = useRuntimeStore.getState().councilStatus['run-1:0'];
    expect(status?.state).toBe('voted');
    expect(status?.agreementPct).toBe(100);
    expect(status?.failedSeats).toHaveLength(1);
    expect(status?.failedSeats?.[0]?.cli).toBe('codex');
  });

  it('records a seat failure that arrives before any convened frame', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest(seatFailed('run-1', 2, 'claude'));
    const status = useRuntimeStore.getState().councilStatus['run-1:2'];
    expect(status?.state).toBe('convened');
    expect(status?.failedSeats).toHaveLength(1);
  });

  it('logs councilSeatFailed with the seat, the branch and the reason on one line', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest(seatFailed('run-1', 0, 'codex', { kind: 'non_zero_exit', exitCode: 2, stderr: 'boom\nsecond line' }));
    const log = useRuntimeStore.getState().logs['run-1'] ?? [];
    expect(log).toHaveLength(1);
    const detail = log[0]?.detail ?? '';
    expect(detail).toContain('codex');
    expect(detail).toContain('non_zero_exit');
    expect(detail).toContain('exit 2');
    expect(detail).toContain('boom');
    // Multi-line stderr must not break the one-line log.
    expect(detail).not.toContain('second line');
    expect(detail.split('\n')).toHaveLength(1);
  });

  it('strips carriage returns from a Windows seat so the log stays one clean line', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest(seatFailed('run-1', 0, 'codex', { kind: 'non_zero_exit', stderr: 'boom\r\nsecond line' }));
    const detail = useRuntimeStore.getState().logs['run-1']?.[0]?.detail ?? '';
    // Splitting on '\n' alone would leave the '\r' behind and render it as a stray glyph.
    expect(detail).not.toContain('\r');
    expect(detail).toContain('boom');
    expect(detail).not.toContain('second line');
    // The reason kept on the frame is normalized too — the tooltip reads it directly.
    const seat = useRuntimeStore.getState().councilStatus['run-1:0']?.failedSeats?.[0];
    expect(seat?.why).toBe('boom\nsecond line');
  });

  it('marks a truncated reason so a cut-off message does not read as a complete one', () => {
    const ingest = useRuntimeStore.getState().ingest;
    ingest(seatFailed('run-1', 0, 'codex', { kind: 'non_zero_exit', stderr: 'x'.repeat(400) }));
    const detail = useRuntimeStore.getState().logs['run-1']?.[0]?.detail ?? '';
    expect(detail).toContain('…');
    expect(detail).toContain('x'.repeat(159));
    expect(detail).not.toContain('x'.repeat(161));
  });
});
