/** Live activity while a step runs (operator 2026-10-30): rows from the seat's tool calls and edits, newest last,
 *  the step's newest words, and one summary line when it ends. */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { activityRows, activitySummary, currentTurn, narration, toolKind, turnEnded } from '../src/board/liveActivity.js';
import { LiveActivity } from '../src/components/session/LiveActivity.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRuntimeStore } from '../src/store/runtime.js';

const R = 'r-live';
const T = (s: number): number => 1_800_000_000_000 + s * 1000;
const tool = (id: string, state: 'started' | 'finished', toolName: string, target: string | null, s: number, ok: boolean | null = null): Record<string, unknown> =>
  ({ type: 'toolActivity', session: R, ord: 2, attempt: 0, id, state, tool: toolName, target, ok, ts: T(s) });
const ev = (x: Array<Record<string, unknown>>): CoreEvent[] => x as unknown as CoreEvent[];

describe('the model', () => {
  const frames = ev([
    { type: 'unitDispatched', session: R, ord: 2, attempt: 0, ts: T(0) },
    tool('a', 'started', 'Read', 'src/lib/money.ts', 1), tool('a', 'finished', 'Read', 'src/lib/money.ts', 2, true),
    tool('b', 'started', 'Bash', 'npm test -- invoices', 3),
    { type: 'powerActivity', session: R, ord: 2, turn: 1, at: T(4), kind: 'edit', path: 'src/routes/invoices.ts', added: 9, removed: 2, ts: T(4) },
  ]);
  it('a started call and its finish are one row; a test command reads as the tests; an edit has its diffstat', () => {
    expect(activityRows(frames, 2).map((r) => `${r.kind}:${r.running}:${r.text}`)).toEqual([
      'read:false:Read src/lib/money.ts',
      'test:true:Running the tests `npm test -- invoices`',
      'edit:false:Edited src/routes/invoices.ts +9 −2',
    ]);
  });
  it('only the newest attempt of the step counts', () => {
    const again = ev([...frames, { type: 'unitDispatched', session: R, ord: 2, attempt: 1, ts: T(10) }, tool('c', 'finished', 'Grep', 'formatMoney', 11, true)]);
    expect(activityRows(again, 2).map((r) => r.text)).toEqual(['Searched formatMoney']);
  });
  it('a power build lists the turn running now, not the whole build', () => {
    const turns = ev([
      { type: 'unitDispatched', session: R, ord: 2, attempt: 0, ts: T(0) },
      { type: 'powerTurnStarted', session: R, ord: 2, turn: 1, ts: T(1) }, tool('a', 'finished', 'Read', 'src/a.ts', 2, true),
      { type: 'powerTurnCompleted', session: R, ord: 2, turn: 1, ts: T(3) },
      { type: 'powerTurnStarted', session: R, ord: 2, turn: 2, ts: T(4) }, tool('b', 'started', 'Edit', 'src/b.ts', 5),
    ]);
    expect(currentTurn(turns, 2)).toEqual({ turn: 2, attempt: null });
    expect(activityRows(turns, 2, currentTurn(turns, 2)).map((r) => r.text)).toEqual(['Editing src/b.ts']);
    expect(currentTurn(frames, 2)).toBeNull();
    expect(turnEnded(turns, 2, 2)).toBe(false);
    expect(turnEnded(turns, 2, 1)).toBe(true);
  });
  it('the summary counts what it did; with no tool frames it counts the calls the gate judged', () => {
    const done = ev([...frames, tool('b', 'finished', 'Bash', 'npm test -- invoices', 20, true), { type: 'powerActivity', session: R, ord: 2, turn: 1, at: T(21), kind: 'commit', sha: 'c07d1f3aa', subject: 'Serve /v2', ts: T(21) }]);
    expect(activitySummary(done, 2)).toBe('Read 1 file · ran the tests once · edited 1 file · 1 commit');
    const judged = ev([{ type: 'unitDispatched', session: R, ord: 3, ts: T(0) }, ...['Bash', 'Bash', 'Read', 'Skill', 'Edit'].map((t, i) => ({ type: 'governanceHookFired', session: R, ord: 3, toolName: t, decision: 'allow', ts: T(30 + i) }))]);
    expect(activitySummary(judged, 3)).toBe('Read 1 file · ran 2 commands · made 1 edit · used 1 skill');
  });
  it('tool names map to kinds; the newest line of the step\'s words, plain', () => {
    expect([toolKind('Read'), toolKind('apply_patch'), toolKind('Bash'), toolKind('Mystery')]).toEqual(['read', 'edit', 'run', 'other']);
    expect(narration('**Role:** scope.\n\nLook at how the route assembles `vault`.\n')).toBe('Look at how the route assembles vault.');
    expect(narration(undefined)).toBeNull();
  });
});

describe('the live list', () => {
  beforeEach(() => { useRunEventStore.setState({ byRun: {} }); useRuntimeStore.setState({ outputs: {} } as never); vi.useFakeTimers(); vi.setSystemTime(T(5)); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('changes as frames arrive and ages refresh every few seconds', () => {
    useRunEventStore.setState({ byRun: { [R]: ev([{ type: 'unitDispatched', session: R, ord: 2, ts: T(0) }, tool('a', 'started', 'Read', 'src/a.ts', 1)]) as never } });
    render(<LiveActivity runId={R} ord={2} />);
    expect(screen.getAllByTestId('live-activity-row').map((r) => r.textContent)).toEqual(['Reading src/a.ts4 s']);
    act(() => { useRunEventStore.setState((s) => ({ byRun: { [R]: [...s.byRun[R]!, ...ev([tool('a', 'finished', 'Read', 'src/a.ts', 6, true), tool('b', 'started', 'Bash', 'git status', 7)])] as never } })); });
    expect(screen.getAllByTestId('live-activity-row').map((r) => r.dataset['running'])).toEqual(['false', 'true']);
    act(() => { vi.advanceTimersByTime(3000); });
    expect(screen.getAllByTestId('live-activity-row')[1]!.textContent).toMatch(/Running `git status`1 s$/);
    act(() => { useRuntimeStore.setState({ outputs: { [`${R}:u2`]: 'Now checking the route guard.' } } as never); });
    expect(screen.getByTestId('live-activity-said').textContent).toBe('“Now checking the route guard.”');
  });
  it('shows the newest five, and how many came earlier', () => {
    useRunEventStore.setState({ byRun: { [R]: ev([{ type: 'unitDispatched', session: R, ord: 2, ts: T(0) }, ...Array.from({ length: 8 }, (_, i) => tool(`x${i}`, 'finished', 'Read', `f${i}.ts`, i + 1, true))]) as never } });
    render(<LiveActivity runId={R} ord={2} />);
    expect(screen.getAllByTestId('live-activity-row')).toHaveLength(5);
    expect(screen.getByTestId('live-activity-earlier').textContent).toBe('3 earlier');
  });
});
