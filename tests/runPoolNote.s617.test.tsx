// studio#617 (wicked-core#810): the run's record says how each unit's worker pool was filled, and a
// pool seated short says so in the warning tone, naming the missing instances and the remedy.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { CoreEvent } from '../src/api/types.js';
import { RunPoolNote, poolWords, shortfallWords, unitPools } from '../src/components/RunPoolNote.js';
import { makeUnit } from './factories.js';

afterEach(cleanup);

const RUN = 'r-pool';
const units = [
  makeUnit({ id: `${RUN}:plan`, session_id: RUN, ord: 1, phase_ref: 'plan' }),
  makeUnit({ id: `${RUN}:build`, session_id: RUN, ord: 2, phase_ref: 'build' }),
  makeUnit({ id: `${RUN}:review`, session_id: RUN, ord: 3, phase_ref: 'review' }),
];
const dist = (ord: number, pool: unknown, seq: number): CoreEvent =>
  ({ type: 'unitDistributed', session: RUN, ord, seq, ts: seq, cli: 'claude', pool } as unknown as CoreEvent);

describe('studio#617 — a unit\'s worker pool', () => {
  it('folds the latest distribution per ord; a pool of 1 (null) and an older engine (absent) say nothing', () => {
    const events = [
      dist(1, null, 1),
      dist(2, { requested: 3, seated: 1, monitors: [], missing: ['claude#2', 'claude#3'], shortfall: 'only one claude instance is signed in' }, 2),
      // a re-dispatch re-seats the pool: the latest frame speaks
      dist(2, { requested: 3, seated: 2, monitors: ['claude#2'], missing: ['claude#3'], shortfall: 'claude#3 is not signed in' }, 3),
      { type: 'unitDistributed', session: RUN, ord: 3, seq: 4, ts: 4, cli: 'codex' } as unknown as CoreEvent,
    ];
    const lines = unitPools(events, units);
    expect(lines.map((l) => l.ord)).toEqual([2]);
    expect(poolWords(lines[0]!)).toBe('build: pool 3 · seated 2 · monitors claude#2');
    expect(shortfallWords(lines[0]!)).toBe('build was seated short — 2 of 3. claude#3 is not signed in. Missing: claude#3 — sign it in under Settings to fill the pool.');
  });

  it('renders a filled pool quietly and a short pool with its shortfall', () => {
    const events = [
      dist(2, { requested: 2, seated: 2, monitors: ['claude#2'], missing: [], shortfall: null }, 1),
      dist(3, { requested: 3, seated: 2, monitors: ['codex#2'], missing: ['codex#3'], shortfall: null }, 2),
    ];
    render(<RunPoolNote events={events} units={units} />);
    const rows = screen.getAllByTestId('run-pool');
    expect(rows.map((r) => r.dataset.short)).toEqual(['false', 'true']);
    expect(rows[0]!.textContent).toBe('build: pool 2 · seated 2 · monitors claude#2');
    expect(screen.getAllByTestId('run-pool-shortfall')).toHaveLength(1);
    expect(screen.getByTestId('run-pool-shortfall').textContent).toContain('Missing: codex#3');
  });

  it('a pool short with nothing signed out to name still says the remedy', () => {
    const [line] = unitPools([dist(2, { requested: 4, seated: 2, monitors: ['claude#2'], missing: [], shortfall: null }, 1)], units);
    expect(shortfallWords(line!)).toBe('build was seated short — 2 of 4. Add another instance of a seat under Settings and sign it in to fill the pool.');
  });

  it('is absent on a run with no pooled unit', () => {
    render(<RunPoolNote events={[dist(1, null, 1)]} units={units} />);
    expect(screen.queryByTestId('run-pools')).toBeNull();
  });
});
