// studio#1368: a stalled run read "Working" on the run header, the Desk and a project's In progress rows and the Jobs
// list, because a quiet seat's 15 s `toolActivity` `working` frame (core#1207) reset every studio stall clock. Crew keeps
// that frame off its own clock (crew#1501); every studio clock does now, and the list rows say crew's liveness.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { CoreEvent, SessionView } from '../src/api/types.js';
import { normalizeSnapshot, type SystemRun } from '../src/api/system.js';
import { isHeartbeatFrame } from '../src/board/heartbeatFrame.js';
import { lastActivityAt, silentStep } from '../src/board/silentStep.js';
import { activityEvidence, stalledRuns } from '../src/board/stalls.js';
import { progressRows } from '../src/board/deskHome.js';
import { homeProgress } from '../src/board/projectHome.js';
import { runsView } from '../src/board/deskRuns.js';
import { DEFAULT_REFINE } from '../src/board/deskInsights.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import { useRunEventStore } from '../src/store/events.js';
import { useSystemStore, resetSystemStore } from '../src/store/systemSnapshot.js';
import { useSilentStep } from '../src/hooks/useSilentStep.js';
import { makeUnit, makeView } from './factories.js';

const T0 = 1_793_000_000_000;
const MIN = 60_000;
const BEAT = 15_000;

/** A quiet seat's "still working" frame exactly as core writes it (wicked-core src/tool_activity.rs:450-463,
 *  `Heartbeat::tick_at`), with the `ts` crew stamps on the persisted copy. */
const working = (at: number, lastOutput: number, withTs: boolean): CoreEvent => ({
  type: 'toolActivity', session: 'r1', ord: 2, attempt: 0, cli: 'codex', at, id: 'working-0', state: 'working', kind: 'working',
  tool: 'codex', target: `last output ${Math.round((at - lastOutput) / 1000)} s ago`, durationMs: at - lastOutput,
  ...(withTs ? { ts: at } : {}),
}) as unknown as CoreEvent;
const real = (type: string, ts: number): CoreEvent => ({ type, session: 'r1', ord: 2, ts }) as unknown as CoreEvent;
/** The beats of a seat that printed its last line at T0 and only heartbeats until `until`. */
const beats = (until: number, withTs: boolean): CoreEvent[] => {
  const out: CoreEvent[] = [];
  for (let t = T0 + BEAT; t <= until; t += BEAT) out.push(working(t, T0, withTs));
  return out;
};

const view = (): SessionView => makeView({ id: 'r1', status: 'executing' as never, unit_ix: 1 } as never, [
  makeUnit({ id: 'r1:triage', session_id: 'r1', ord: 1, stage: 'recon', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: 'r1:fix', session_id: 'r1', ord: 2, stage: 'build', status: 'distributed', assigned_cli: 'codex' }),
]);

/** Crew's `/system` run as its writer sends it (wicked-crew packages/crew/src/api/system-snapshot.ts `runLiveness`). */
const crewRun = (liveness: 'working' | 'quiet' | 'stalled', quietForMs: number): SystemRun =>
  normalizeSnapshot({ runs: [{
    runId: 'r1', title: 'Fix the invoice total', status: 'executing', liveness, reason: `no event for ${Math.round(quietForMs / MIN)} min`,
    phase: 'fix', unitOrd: 2, seat: 'codex', lastEventAt: new Date(T0).toISOString(), evidence: 'event_log', quietForMs,
    quietAfterMs: 5 * MIN, stallAfterMs: 15 * MIN, createdAt: new Date(T0 - 10 * MIN).toISOString(),
  }] }).runs[0]!;

afterEach(() => {
  vi.useRealTimers();
  useRuntimeStore.getState().clear('r1');
  useRunEventStore.setState({ byRun: {} });
  resetSystemStore();
});

describe('a run that only heartbeats for more than 15 min (studio#1368)', () => {
  it('the heartbeat predicate matches crew: the engine heartbeat and the quiet seat\'s working frame, nothing else', () => {
    expect(isHeartbeatFrame({ type: 'heartbeat' })).toBe(true);
    expect(isHeartbeatFrame(working(T0 + BEAT, T0, false))).toBe(true);
    expect(isHeartbeatFrame({ type: 'toolActivity', state: 'started', kind: 'run' })).toBe(false);
    expect(isHeartbeatFrame({ type: 'unitDispatched' })).toBe(false);
  });

  it('the durable trail: the run page says how long the step has been silent', () => {
    const trail = [real('unitDispatched', T0), ...beats(T0 + 16 * MIN, true)];
    expect(lastActivityAt(trail)).toBe(T0);
    expect(silentStep(view(), trail, T0 + 16 * MIN)).toMatchObject({ minutes: 16, ord: 2, cli: 'codex' });
  });

  it('live frames: no beat lands in the stall log, so the header is silent and the run stalls', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0);
    useRuntimeStore.getState().ingest(real('unitDispatched', T0));
    // Half an hour of beats and nothing else (studio's own stall mark is 30 min, `isStalled`).
    const end = T0 + 31 * MIN;
    for (const f of beats(end, false)) {
      vi.setSystemTime((f as unknown as { at: number }).at);
      useRuntimeStore.getState().ingest(f);
    }
    expect((useRuntimeStore.getState().logs['r1'] ?? []).map((e) => e.type)).toEqual(['unitDispatched']);
    expect(stalledRuns([view()], activityEvidence({}), end)).toEqual({ r1: T0 });
    // The header's hook (SessionView's badge reads it): the beats are in the run's event store too (live activity's row).
    useRunEventStore.setState({ byRun: { r1: [real('unitDispatched', T0), ...beats(end, false)] } });
    expect(renderHook(() => useSilentStep(view())).result.current).toMatchObject({ minutes: 31 });
  });

  it('a page with no frame of the run reads crew\'s own activity clock', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(T0 + 16 * MIN);
    useRunEventStore.setState({ byRun: { r1: beats(T0 + 16 * MIN, true) } });
    useSystemStore.setState({ mode: 'system', snapshot: { ...normalizeSnapshot({}), runs: [crewRun('stalled', 16 * MIN)] } });
    expect(renderHook(() => useSilentStep(view())).result.current).toMatchObject({ minutes: 16 });
  });
});

describe('the Desk, a project\'s In progress and Jobs say crew\'s liveness (studio#1368)', () => {
  const name = (cli: string): string => cli;
  const liveness = (run: SystemRun): Map<string, SystemRun> => new Map([[run.runId, run]]);

  it('a stalled or quiet run says how long it has been silent, a working one says Working', () => {
    const stalled = liveness(crewRun('stalled', 16 * MIN));
    expect(progressRows([view()], { max: 3, agentName: name, liveness: stalled }).rows[0]).toMatchObject({ word: 'Working', silent: 'No output for 16 min' });
    expect(progressRows([view()], { max: 3, agentName: name, liveness: liveness(crewRun('quiet', 6 * MIN)) }).rows[0]!.silent).toBe('No output for 6 min');
    expect(progressRows([view()], { max: 3, agentName: name, liveness: liveness(crewRun('working', 30_000)) }).rows[0]!.silent).toBeNull();
    expect(progressRows([view()], { max: 3, agentName: name }).rows[0]!.silent).toBeNull();
    expect(homeProgress([view()], 3, stalled).rows[0]!.silent).toBe('No output for 16 min');
    const jobs = runsView([view()], DEFAULT_REFINE, { group: 'active', status: 'all', query: '', now: T0 + 16 * MIN, title: () => 'Fix', names: { project: (p) => p, agent: name }, liveness: stalled });
    expect(jobs.rows[0]).toMatchObject({ word: 'Working', silent: 'No output for 16 min' });
  });
});
