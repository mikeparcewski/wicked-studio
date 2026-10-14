// Run clarity: the step list marks the step that is "now" — waiting on you (the open gate's unit),
// else working, else where it stopped — with a word, `data-now` and `aria-current="step"`.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { ChainModel, ChainStep } from '../src/board/chainModel.js';
import { ChainLine, nowStep } from '../src/components/session/ChainLine.js';
import { makeUnit } from './factories.js';

afterEach(cleanup);

const step = (id: string, label: string, state: ChainStep['state']): ChainStep => ({ id, catalog: id, block: 'build', label, state, addedBy: 'pa' });
const chain = (steps: ChainStep[], over: Partial<ChainModel> = {}): ChainModel => ({
  source: 'units', steps, proposed: false, transportLine: null, checked: null,
  done: steps.filter((s) => s.state === 'done').length, total: steps.length, ...over,
});
const units = [1, 2, 3].map((ord) => makeUnit({ id: `r:u${ord}`, session_id: 'r', ord, status: ord === 1 ? 'done' : 'distributed' }));

describe('nowStep', () => {
  it('the gate’s unit is waiting on you, ahead of a running or stopped step', () => {
    const c = chain([step('u1', 'Research', 'done'), step('u2', 'Test', 'running'), step('u3', 'Fix', 'failed')]);
    expect(nowStep(c, units, 2, 'working')).toStrictEqual({ index: 1, kind: 'wait', word: 'waiting on you' });
    // The gate's step wins even when another step is the one running (agy r1).
    expect(nowStep(c, units, 3, 'working')).toStrictEqual({ index: 2, kind: 'wait', word: 'waiting on you' });
    expect(nowStep(c, units, null, 'working')).toStrictEqual({ index: 1, kind: 'run', word: 'now' });
    const stopped = chain([step('u1', 'Research', 'done'), step('u2', 'Test', 'failed'), step('u3', 'Fix', 'todo')]);
    expect(nowStep(stopped, units, null, 'stopped')).toStrictEqual({ index: 1, kind: 'stopped', word: 'stopped here' });
  });

  it('a step’s own state is not enough (codex r2): an orphaned or finished run marks no running step; a live run no failed one', () => {
    const c = chain([step('u1', 'Research', 'done'), step('u2', 'Test', 'running')]);
    expect(nowStep(c, units, null, 'other')).toBeNull(); // executing but orphaned: "nothing is working on it"
    expect(nowStep(c, units, null, 'stopped')).toBeNull(); // a retained claim on a failed / cancelled run
    const refused = chain([step('u1', 'Research', 'done'), step('u2', 'Test', 'failed')]);
    expect(nowStep(refused, units, null, 'working')).toBeNull(); // a refused step being retried is not where it stopped
    expect(nowStep(refused, units, null)).toBeNull();
  });

  it('nothing is "now" for a proposed plan, a finished line, or a gate on a unit with no step', () => {
    expect(nowStep(chain([step('u1', 'Research', 'todo')], { proposed: true }), units, 1)).toBeNull();
    expect(nowStep(chain([step('u1', 'Research', 'done')]), units, null)).toBeNull();
    expect(nowStep(chain([step('u1', 'Research', 'done')]), units, 9)).toBeNull();
  });
});

describe('a team chain never reads the u<ord> key (codex r1)', () => {
  it('a team step NAMED u2 is not unit 2’s step: the unit’s phase id is', () => {
    const team = chain([step('u2', 'Research', 'done'), step('test', 'Test', 'todo')], { source: 'team' });
    const teamUnits = [
      makeUnit({ id: 'r:a', session_id: 'r', ord: 1, status: 'done', description: 'u2 — research' }),
      makeUnit({ id: 'r:b', session_id: 'r', ord: 2, status: 'distributed', description: 'test — the test' }),
    ];
    expect(nowStep(team, teamUnits, 2)).toStrictEqual({ index: 1, kind: 'wait', word: 'waiting on you' });
    expect(nowStep(team, teamUnits, 1)).toStrictEqual({ index: 0, kind: 'wait', word: 'waiting on you' });
  });
});

describe('ChainLine marks now', () => {
  it('the waiting step carries its word, data-now and aria-current; the others do not', () => {
    const c = chain([step('u1', 'Research', 'done'), step('u2', 'Test', 'todo'), step('u3', 'Fix', 'todo')]);
    render(<ChainLine chain={c} runId="r" units={units} waitOrd={2} />);
    const steps = screen.getAllByTestId('chain-step');
    expect(steps[1]).toHaveAttribute('data-now', 'wait');
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    expect(steps[1]).toHaveAttribute('aria-label', expect.stringContaining('Test: not started, waiting on you'));
    expect(screen.getByTestId('chain-step-now')).toHaveTextContent('waiting on you');
    expect(steps[0]).not.toHaveAttribute('data-now');
    expect(steps[2]).not.toHaveAttribute('aria-current');
  });

  it('the marker adds to the step’s state for a screen reader, never replaces it (agy r1)', () => {
    const c = chain([step('u1', 'Research', 'done'), step('u2', 'Test', 'running')]);
    const { unmount } = render(<ChainLine chain={c} runId="r" units={units} phase="working" />);
    expect(screen.getAllByTestId('chain-step')[1]).toHaveAttribute('aria-label', expect.stringContaining('Test: working, now'));
    unmount();
    const stopped = chain([step('u1', 'Research', 'done'), step('u2', 'Test', 'failed')]);
    render(<ChainLine chain={stopped} runId="r" units={units} phase="stopped" />);
    // A failed step's own word is "stopped"; "stopped here" keeps it, so it is not said twice.
    expect(screen.getAllByTestId('chain-step')[1]).toHaveAttribute('aria-label', expect.stringContaining('Test: stopped here'));
  });

  it('a line with nothing now has no marker', () => {
    render(<ChainLine chain={chain([step('u1', 'Research', 'done')])} runId="r" units={units} />);
    expect(screen.queryByTestId('chain-step-now')).toBeNull();
  });
});
