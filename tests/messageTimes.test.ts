/**
 * Message timestamps (power-mode mockup, operator 2026-10-29): every thread message says when it was said, from what
 * crew recorded — never "now" for an old run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { askedAt, endedAt, messageTimeWords, stepTimes } from '../src/board/messageTimes.js';
import { arrivedAt, useRunEventStore } from '../src/store/events.js';
import { makeView } from './factories.js';

const at = (h: number, m: number, day = 29): number => new Date(2026, 9, day, h, m, 0).getTime();
const NOW = at(15, 0);
const ev = (type: string, ord: number | undefined, ts?: number): CoreEvent => ({ type, session: 'r', ...(ord !== undefined ? { ord } : {}), ...(ts !== undefined ? { ts } : {}) } as never);

beforeEach(() => useRunEventStore.setState({ byRun: {} }));
afterEach(() => vi.restoreAllMocks());

/** Frames as the live socket delivers them (no `ts`), each received at its own time. */
function live(frames: Array<[string, number | undefined, number]>): CoreEvent[] {
  for (const [type, ord, at] of frames) {
    vi.spyOn(Date, 'now').mockReturnValue(at);
    useRunEventStore.getState().ingest({ type, session: 'r', ...(ord !== undefined ? { ord } : {}) } as never);
    vi.restoreAllMocks();
  }
  return useRunEventStore.getState().byRun['r'] ?? [];
}

describe('messageTimeWords', () => {
  it('says one instant as HH:MM today', () => {
    expect(messageTimeWords({ from: at(14, 3), to: null }, NOW)).toBe('14:03');
  });
  it('says a span as start–end', () => {
    expect(messageTimeWords({ from: at(14, 16), to: at(14, 21) }, NOW)).toBe('14:16–14:21');
  });
  it('a span inside one minute is one time', () => {
    expect(messageTimeWords({ from: at(14, 16), to: at(14, 16) + 20_000 }, NOW)).toBe('14:16');
  });
  it('an end before its start (two clocks) is said as the start alone', () => {
    expect(messageTimeWords({ from: at(15, 11), to: at(14, 9) }, NOW)).toBe('15:11');
  });
  it('names the day when it is not today', () => {
    expect(messageTimeWords({ from: at(9, 5, 27), to: at(9, 40, 27) }, NOW)).toBe('27 Oct 09:05–09:40');
    expect(messageTimeWords({ from: at(23, 50, 28), to: at(0, 10, 29) }, NOW)).toBe('28 Oct 23:50–29 Oct 00:10');
  });
  it('says nothing without a time', () => {
    expect(messageTimeWords(null, NOW)).toBeNull();
    expect(messageTimeWords({ from: null, to: null }, NOW)).toBeNull();
    expect(messageTimeWords({ from: null, to: at(14, 2) }, NOW)).toBe('14:02');
  });
});

describe('stepTimes', () => {
  it('dates each step by its last attempt: newest dispatch to the frame that ended it', () => {
    const t = stepTimes([
      ev('unitDispatched', 2, at(14, 5)), ev('unitDone', 2, at(14, 9)),
      ev('unitDispatched', 3, at(14, 9)), ev('stepFailed', 3, at(14, 12)),
      ev('unitDispatched', 3, at(15, 11)), ev('unitDone', 3, at(15, 15)), ev('gateDecided', 3, at(15, 16)),
    ]);
    expect(t.get(2)).toEqual({ from: at(14, 5), to: at(14, 9), ended: true });
    expect(t.get(3)).toEqual({ from: at(15, 11), to: at(15, 15), ended: true });
  });
  it('a frame from the live socket (no ts) is dated when the page received it, whenever the thread reads it later', () => {
    const frames = live([['unitDispatched', 1, at(14, 0)], ['unitDone', 1, at(14, 5)]]);
    expect(arrivedAt(frames[0]!)).toBe(at(14, 0));
    vi.spyOn(Date, 'now').mockReturnValue(at(14, 30));
    expect(stepTimes(frames).get(1)).toEqual({ from: at(14, 0), to: at(14, 5), ended: true });
  });
  it('a recorded frame is never stamped with an arrival', () => {
    useRunEventStore.getState().ingest({ type: 'unitDone', session: 'r', ord: 1, ts: at(9, 0) } as never);
    expect(arrivedAt(useRunEventStore.getState().byRun['r']![0]!)).toBeNull();
    expect(stepTimes([ev('unitDone', 1)]).get(1)).toEqual({ from: null, to: null, ended: true });
  });
  it('two attempts that both ended live each keep their own span (no stamp reused across attempts)', () => {
    const frames = live([['unitDispatched', 0, at(14, 2)], ['unitDone', 0, at(14, 5)], ['unitDispatched', 0, at(14, 15)], ['unitDone', 0, at(14, 20)]]);
    expect(stepTimes(frames).get(0)).toEqual({ from: at(14, 15), to: at(14, 20), ended: true });
  });
  it('a newer attempt still running leaves the finished attempt\'s span in place', () => {
    const t = stepTimes([ev('unitDispatched', 1, at(14, 0)), ev('unitDone', 1, at(14, 5)), ev('unitDispatched', 1, at(14, 30))]);
    expect(t.get(1)).toEqual({ from: at(14, 0), to: at(14, 5), ended: true });
  });
  it('a running step is not ended', () => {
    expect(stepTimes([ev('unitDispatched', 1, at(14, 0))]).get(1)).toEqual({ from: at(14, 0), to: null, ended: false });
    expect(stepTimes(null).size).toBe(0);
  });
});

describe('endedAt / askedAt', () => {
  it('a run ended at its first terminal frame, else its ended_at (seconds)', () => {
    const v = makeView({ id: 'r', status: 'completed' } as never, []);
    expect(endedAt(v, [ev('sessionCompleted', undefined, at(14, 41))])).toBe(at(14, 41));
    (v.session as { ended_at?: number }).ended_at = at(14, 42) / 1000;
    expect(endedAt(v, [])).toBe(at(14, 42));
    delete (v.session as { ended_at?: number }).ended_at;
    expect(endedAt(v, [])).toBeNull();
  });
  it('a terminal frame that came live is dated when it arrived; an old run with nothing recorded has no end time', () => {
    const v = makeView({ id: 'r', status: 'completed' } as never, []);
    expect(endedAt(v, live([['sessionCompleted', undefined, at(14, 41)]]))).toBe(at(14, 41));
    expect(endedAt(v, [ev('unitDone', 1, at(14, 0))])).toBeNull();
  });
  it('a question was asked at its newest awaitingHuman frame', () => {
    expect(askedAt([ev('awaitingHuman', 2, at(14, 3)), ev('awaitingHuman', 2, at(14, 30)), ev('awaitingHuman', 4, at(14, 50))], 2)).toBe(at(14, 30));
    expect(askedAt([], 2)).toBeNull();
  });
});
