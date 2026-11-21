/**
 * studio#945 / studio#947: the power panel never hides a newer pause, and the pause this page answered never opens
 * again. Frames fold from the state's own time (not when this page's answer arrived); a session read that is further
 * along brings its pause; a pause answer records which pause it closed.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { mergePower } from '../src/board/powerMode.js';
import { rememberPower, usePower, usePowerLocal } from '../src/hooks/usePower.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useRunEventStore } from '../src/store/events.js';
import { makeView } from './factories.js';
import { at, change, state, step } from './powerFixtures.js';

const RUN = 'r-945';
const ev = (x: Array<Record<string, unknown>>): CoreEvent[] => x as unknown as CoreEvent[];
const pz = (min: number) => ({ at: at(min), checkpoint: 3, reasons: ['grew'], recommended: 'split' as const });
/** A checkpoint frame that opened a pause: recorded (with `ts`) or live (no `ts`, dated by its arrival). */
const cpFrame = (min: number, recorded = true) => ({
  type: 'powerCheckpointReached', session: RUN, ord: 1, checkpoint: 3, turn: 3, trigger: 'turn', head: null, picked: 0, rigor: 'high', paused: true, pause: pz(min),
  ...(recorded ? { ts: at(min) } : {}),
});
const flip = (min: number) => [{ at: at(min), on: true, by: 'you' as const, reason: null, stayPhased: [] }];
const viewOf = (power: ReturnType<typeof state>) => makeView({ id: RUN, problem: 'x', status: 'executing', power } as never, []);
const turnsOf = (n: number) => ({ cli: 'claude', ord: 1, turns: n, inTurn: true, sessionRestarts: 0 });

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  useCapabilities.setState({ loaded: true, powerMode: true });
  usePowerLocal.setState({ byRun: {}, answeredByRun: {} });
  useRunEventStore.setState({ byRun: {} });
});
afterEach(() => {
  vi.useRealTimers();
  useCapabilities.setState({ powerMode: false });
  useRunEventStore.setState({ byRun: {} });
});

describe('studio#945: frames fold from the state\'s own time, and the answered pause stays closed', () => {
  it('a pause that opened after the daemon handled a flip, but came in before the flip\'s answer arrived, shows', () => {
    // the flip was handled at 20; the pause opened at 22 and its live frame arrived at 25; the flip's answer at 30
    vi.setSystemTime(at(25));
    useRunEventStore.getState().ingest(cpFrame(22, false) as unknown as CoreEvent);
    vi.setSystemTime(at(30));
    rememberPower(RUN, state({ toggles: flip(20) }));
    const { result } = renderHook(() => usePower(viewOf(state())));
    expect(result.current!.pause).toEqual(pz(22));
  });

  it('a pause answer keeps its hand-off over a session read that still holds the answered pause', () => {
    // the session was read while paused at 22; the answer (split) started a hand-off that has no dated step yet
    const session = state({ pause: pz(22) });
    const answer = state({ pause: null, handoff: { round: 1, maxRounds: 3, steps: [] } });
    vi.setSystemTime(at(30));
    rememberPower(RUN, answer, pz(22));
    const { result } = renderHook(() => usePower(viewOf(session)));
    expect(result.current!.pause).toBeNull();
    expect(result.current!.handoff).toEqual({ round: 1, maxRounds: 3, steps: [] });
    // the same through the merge itself
    const merged = mergePower(session, [], answer, { at: at(22), checkpoint: 3 })!;
    expect(merged.handoff).toEqual(answer.handoff);
    expect(merged.pause).toBeNull();
  });

  it('the pause this page answered never opens again from its own frame (live or recorded)', () => {
    const answer = state({ pause: null });
    for (const frame of [cpFrame(22, true), cpFrame(22, false)]) {
      useRunEventStore.setState({ byRun: {} });
      usePowerLocal.setState({ byRun: {}, answeredByRun: {} });
      vi.setSystemTime(at(23));
      useRunEventStore.getState().ingest(frame as unknown as CoreEvent);
      vi.setSystemTime(at(30));
      rememberPower(RUN, answer, pz(22));
      const { result, unmount } = renderHook(() => usePower(viewOf(state())));
      expect(result.current!.pause).toBeNull();
      unmount();
    }
    // a later pause (a new checkpoint after the answer) still opens
    const later = { ...cpFrame(35), pause: { ...pz(35), checkpoint: 4 } };
    expect(mergePower(state(), ev([cpFrame(22), later]), answer, { at: at(22), checkpoint: 3 })!.pause).toEqual(later.pause);
  });

  it('a later flip keeps the record of the pause answered before it', () => {
    vi.setSystemTime(at(30));
    rememberPower(RUN, state({ pause: null }), pz(22));
    rememberPower(RUN, state({ pause: null, toggles: flip(31) }));
    expect(usePowerLocal.getState().answeredByRun[RUN]).toEqual({ at: at(22), checkpoint: 3 });
  });
});

describe('studio#947: a session read further along than this page\'s answer brings its pause', () => {
  const raised = [...state().history, change(4, 20, 'operator', 'high', 'highest', 34, 34, null)];

  it('a new checkpoint pause shows after this page\'s raise, though a hand-off step is dated at or after it', () => {
    const answer = state({ history: raised, rigor: 'highest' });
    const session = state({ history: raised, rigor: 'highest', pause: pz(25), handoff: { round: 1, maxRounds: 3, steps: [step('checks', 'running', null, null, 26)] } });
    const merged = mergePower(session, ev([cpFrame(25)]), answer)!;
    expect(merged.pause).toEqual(pz(25));
    expect(merged.handoff).toEqual(session.handoff);
  });

  it('a pause open at this page\'s raise and answered elsewhere since clears', () => {
    const answer = state({ history: raised, rigor: 'highest', pause: pz(15) });
    const session = state({ history: raised, rigor: 'highest', pause: null, orchestrator: turnsOf(3) });
    expect(mergePower(session, [], answer)!.pause).toBeNull();
    // the session not further along (an older read at the same tip): the answer's pause stands
    expect(mergePower(state({ history: raised, rigor: 'highest', pause: null }), [], answer)!.pause).toEqual(pz(15));
  });

  it('a session read that still holds the pause this page answered is not taken for a newer one', () => {
    const answer = state({ pause: null });
    const session = state({ pause: pz(22), orchestrator: turnsOf(3) });
    expect(mergePower(session, [], answer, { at: at(22), checkpoint: 3 })!.pause).toBeNull();
    expect(mergePower(session, [], answer, { at: at(22), checkpoint: 3 })!.orchestrator.turns).toBe(3);
  });

  it('a malformed session pause is never adopted: the answer stands', () => {
    const answer = state({ history: raised, pause: pz(15) });
    const bad = state({ history: raised, pause: { at: 'soon', checkpoint: 3 } as never, orchestrator: turnsOf(3) });
    const merged = mergePower(bad, [], answer)!;
    expect(merged.pause).toEqual(pz(15));
    expect(merged.orchestrator.turns).toBe(2);
  });
});
