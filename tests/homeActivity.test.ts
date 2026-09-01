import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { ACTIVITY_CAP, narratorCtxOf, recentActivity } from '../src/board/homeActivity.js';
import { makeUnit, makeView } from './factories.js';

/**
 * The RECENT ACTIVITY fold (DES-HOME-COMMAND-CENTER §5): one narrated line per
 * OBSERVED run, the narrator's own templates, arrival-clock ordering, capped —
 * and honest absence for anything the session never saw.
 */

const NOW = 1_700_000_000_000;

const started = (session: string): CoreEvent => ({ type: 'sessionStarted', session });
const dispatched = (session: string, ord: number): CoreEvent => ({ type: 'unitDispatched', session, ord });

describe('recentActivity', () => {
  it('narrates each observed run once with unit vocabulary, newest arrival first', () => {
    const runs = [
      makeView({ id: 'r-old' }, [makeUnit({ id: 'r-old:survey', session_id: 'r-old', ord: 0 })]),
      makeView({ id: 'r-new' }),
    ];
    const byRun = {
      'r-old': [started('r-old'), dispatched('r-old', 0)],
      'r-new': [started('r-new')],
    };
    const tails: Record<string, number> = { 'r-old': NOW - 60_000, 'r-new': NOW - 1_000 };
    const rows = recentActivity(runs, byRun, (id) => tails[id]);
    expect(rows.map((r) => r.runId)).toEqual(['r-new', 'r-old']);
    expect(rows[0]!.line.text).toBe('Run started');
    // The unit-id suffix IS the phase word — the narrator's own vocabulary.
    expect(rows[1]!.line.text).toBe('Worker started survey');
    expect(rows[1]!.line.tone).toBe('work');
  });

  it('skips runs with no observed frames, no arrival clock, or archived', () => {
    const runs = [
      makeView({ id: 'r-unseen' }),
      makeView({ id: 'r-clockless' }),
      makeView({ id: 'r-archived', archived_at: NOW }),
    ];
    const byRun = {
      'r-clockless': [started('r-clockless')],
      'r-archived': [started('r-archived')],
    };
    const tails: Record<string, number> = { 'r-archived': NOW };
    expect(recentActivity(runs, byRun, (id) => tails[id])).toEqual([]);
  });

  it('caps at the strip size, keeping the newest', () => {
    const runs = Array.from({ length: 12 }, (_, i) => makeView({ id: `r-${i}` }));
    const byRun = Object.fromEntries(runs.map((v) => [v.session.id, [started(v.session.id)]]));
    const rows = recentActivity(runs, byRun, (id) => NOW - Number(id.slice(2)) * 1000);
    expect(rows).toHaveLength(ACTIVITY_CAP);
    expect(rows[0]!.runId).toBe('r-0');
    expect(rows[ACTIVITY_CAP - 1]!.runId).toBe(`r-${ACTIVITY_CAP - 1}`);
  });
});

describe('narratorCtxOf', () => {
  it('speaks the unit-id suffix, falls back to stage for free-text units, ?-safe', () => {
    const ctx = narratorCtxOf(
      makeView({ id: 'r-1', problem: 'the intent' }, [
        makeUnit({ id: 'r-1:clarify', session_id: 'r-1', ord: 0 }),
        makeUnit({ id: 'r-1:u1', session_id: 'r-1', ord: 1, stage: 'build' }),
      ]),
    );
    expect(ctx.phaseOf(0)).toBe('clarify');
    expect(ctx.phaseOf(1)).toBe('build');
    expect(ctx.phaseOf(9)).toBe('unit 9');
    expect(ctx.phaseOf(null)).toBe('this phase');
    expect(ctx.intent).toBe('the intent');
  });
});
