/**
 * Message timestamps (power-mode mockup, operator 2026-10-29): every thread message says when it was said, from what
 * crew recorded — never "now" for an old run.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { askedAt, endedAt, firstSeenAt, messageTimeWords, resetFirstSeen, stepTimes } from '../src/board/messageTimes.js';
import { makeView } from './factories.js';

const at = (h: number, m: number, day = 29): number => new Date(2026, 9, day, h, m, 0).getTime();
const NOW = at(15, 0);
const ev = (type: string, ord: number | undefined, ts?: number): CoreEvent => ({ type, session: 'r', ...(ord !== undefined ? { ord } : {}), ...(ts !== undefined ? { ts } : {}) } as never);

beforeEach(() => resetFirstSeen());

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
  it('a step that ended over the live socket (no ts) is ended with no recorded end', () => {
    expect(stepTimes([ev('unitDispatched', 1, at(14, 0)), ev('unitDone', 1)]).get(1)).toEqual({ from: at(14, 0), to: null, ended: true });
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
  it('a question was asked at its newest awaitingHuman frame', () => {
    expect(askedAt([ev('awaitingHuman', 2, at(14, 3)), ev('awaitingHuman', 2, at(14, 30)), ev('awaitingHuman', 4, at(14, 50))], 2)).toBe(at(14, 30));
    expect(askedAt([], 2)).toBeNull();
  });
});

describe('firstSeenAt', () => {
  it('stamps a live-ended message once, and keeps that stamp', () => {
    expect(firstSeenAt('k', true, 10)).toBeNull();
    expect(firstSeenAt('k', false, 20)).toBe(20);
    expect(firstSeenAt('k', false, 99)).toBe(20);
  });
});
