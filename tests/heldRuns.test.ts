import { describe, expect, it } from 'vitest';
import { isHeldRun, markHeld } from '../src/board/heldRuns.js';
import { deskLiveCounts, statusWord } from '../src/board/statusWords.js';
import { liveRows, outcomeOf } from '../src/board/deskInsights.js';
import { makeView } from './factories.js';

/** studio#805: a live run a Needs-you row holds reads as waiting on you everywhere statusWord speaks. */
describe('held runs: one mark, read by statusWord', () => {
  const live = makeView({ id: 'r1', status: 'executing' });
  const gate = makeView({ id: 'g1', status: 'awaiting_human' });
  const done = makeView({ id: 'd1', status: 'completed' });

  it('marks only live runs in the held set, on a copy, and leaves the wire status alone', () => {
    const runs = [live, gate, done];
    const out = markHeld(runs, new Set(['r1', 'g1', 'd1']));
    expect(out.map((v) => isHeldRun(v.session))).toEqual([true, false, false]);
    expect(out[0]!.session.status).toBe('executing');
    expect(isHeldRun(live.session)).toBe(false);
    expect(markHeld(runs, new Set())).toBe(runs);
    expect(markHeld(runs, new Set(['g1']))).toBe(runs);
  });

  it('a held run is Waiting on you to statusWord, outcomeOf, the live count and Running now', () => {
    const [held] = markHeld([live], new Set(['r1']));
    expect(statusWord(live)).toEqual({ word: 'Working', tone: 'run' });
    expect(statusWord(held!)).toEqual({ word: 'Waiting on you', tone: 'gate' });
    expect(outcomeOf(held!)).toBe('Waiting on you');
    expect(deskLiveCounts([held!]).working).toBe(0);
    expect(liveRows([held!], () => 't')).toHaveLength(0);
    expect(liveRows([live], () => 't')).toHaveLength(1);
  });

  it('an archived run still reads Archived', () => {
    const [held] = markHeld([makeView({ id: 'a1', status: 'executing', archived_at: 1 } as Parameters<typeof makeView>[0])], new Set(['a1']));
    expect(statusWord(held!).word).toBe('Archived');
  });
});
