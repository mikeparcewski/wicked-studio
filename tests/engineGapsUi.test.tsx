/**
 * The engine-gaps landings on the run page (core#1207, core#1211, 2026-10-30): a quiet seat's "working" frames and
 * codex / pi tool rows in the live activity, and the judge that reviews a hand-off before the floor. The frames are the
 * engine's own shapes (`tool_activity.rs` Heartbeat / codex_item / pi_event, `cli_runner.rs` JUDGE_NOTE).
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent } from '../src/api/types.js';
import { floorLineOf, isFloorDelta } from '../src/board/floorLine.js';
import { floorBadge, floorWords, runningFloor } from '../src/board/floorRun.js';
import { activityRows, activitySummary, visibleRows, workingWords } from '../src/board/liveActivity.js';
import { silentStep } from '../src/board/silentStep.js';
import { LiveActivity } from '../src/components/session/LiveActivity.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useRunEventStore } from '../src/store/events.js';
import { clearCachedRoster, setCachedRoster } from '../src/store/rosterCache.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import { useSheets } from '../src/store/sheets.js';
import { makeUnit, makeView } from './factories.js';

const R = 'r-eg';
const T0 = 1_793_364_037_000;
const S = 1000;
const MIN = 60_000;
const ev = (x: Array<Record<string, unknown>>): CoreEvent[] => x.map((e) => ({ session: R, ...e })) as unknown as CoreEvent[];
/** A `toolActivity` frame as the sink sends it (camelCase wire; `kind` is the engine's guess). */
const frame = (o: Record<string, unknown>): Record<string, unknown> => ({ type: 'toolActivity', ord: 5, attempt: 0, ok: null, durationMs: null, ...o });
/** The heartbeat: `working-<attempt>`, the seat as the tool, its silence in words and in ms. */
const working = (at: number, quietS: number, seat = 'codex'): Record<string, unknown> =>
  frame({ id: 'working-0', state: 'working', kind: 'working', tool: seat, target: `last output ${quietS} s ago`, durationMs: quietS * S, at, ts: at });

describe('2. a quiet seat says it is working; codex and pi rows read like claude\'s', () => {
  const dispatched = { type: 'unitDispatched', ord: 5, attempt: 0, ts: T0 };

  it('one "Codex · working · last output N s ago" row per attempt, updated in place, counted from the seat\'s last output', () => {
    const rows = activityRows(ev([dispatched, working(T0 + 15 * S, 15), working(T0 + 30 * S, 30), working(T0 + 45 * S, 45)]), 5);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'working', running: true, text: 'Codex · working · last output 45 s ago', working: { seat: 'codex', quietSince: T0 } });
    expect(workingWords('Codex', T0, T0 + 40 * S)).toBe('Codex · working · last output 40 s ago');
    expect(workingWords('Pi CLI', T0, T0 + 130 * S)).toBe('Pi CLI · working · last output 2 min ago');
  });

  it('the row goes once the seat does something, and comes back if it goes quiet again', () => {
    const busy = ev([dispatched, working(T0 + 15 * S, 15), frame({ id: 'item_1', state: 'started', kind: 'run', tool: 'Bash', target: 'git status', at: T0 + 20 * S, ts: T0 + 20 * S })]);
    expect(activityRows(busy, 5).map((r) => r.kind)).toEqual(['run']);
    const quietAgain = [...busy, ...ev([working(T0 + 40 * S, 20)])];
    expect(activityRows(quietAgain, 5).map((r) => r.kind)).toEqual(['run', 'working']);
  });

  it('a "working" row is never a tool call in the summary, and is gone once the turn ended', () => {
    const log = ev([dispatched, working(T0 + 15 * S, 15)]);
    expect(activitySummary(log, 5)).toBeNull();
    const rows = activityRows(log, 5);
    expect(visibleRows(rows, null, T0 + 20 * S)).toHaveLength(1);
    expect(visibleRows(rows, T0 + 20 * S, T0 + 21 * S)).toHaveLength(0);
  });

  it('codex\'s commands, file changes and MCP calls, and pi\'s reads, in claude\'s words', () => {
    const log = ev([
      dispatched,
      // codex `bash -lc '…'`, unwrapped by the engine
      frame({ id: 'item_1', state: 'started', kind: 'test', tool: 'Bash', target: 'npx vitest run tests/a.test.ts', ts: T0 + S }),
      frame({ id: 'item_1', state: 'finished', kind: 'test', tool: 'Bash', target: 'npx vitest run tests/a.test.ts', ok: false, durationMs: 9000, ts: T0 + 10 * S }),
      frame({ id: 'item_2', state: 'finished', kind: 'edit', tool: 'Edit', target: 'src/board/x.ts', ok: true, ts: T0 + 11 * S }),
      frame({ id: 'item_3', state: 'started', kind: 'other', tool: 'mcp__estate__search', target: null, ts: T0 + 12 * S }),
      // pi `tool_execution_start` read
      frame({ id: 'call_9', state: 'started', kind: 'read', tool: 'Read', target: 'src/lib/money.ts', ts: T0 + 13 * S }),
    ]);
    expect(activityRows(log, 5).map((r) => `${r.kind}:${r.text}`)).toEqual([
      'test:Tests failed · `npx vitest run tests/a.test.ts`',
      'edit:Edited src/board/x.ts',
      'other:Using estate search',
      'read:Reading src/lib/money.ts',
    ]);
  });

  describe('in the live list', () => {
    beforeEach(() => {
      useRunEventStore.setState({ byRun: {} });
      useRuntimeStore.setState({ outputs: {} } as never);
      setCachedRoster([{ key: 'codex', display_name: 'Codex', binary: 'codex', enabled_for_council: true }]);
      vi.useFakeTimers();
      vi.setSystemTime(T0 + 40 * S);
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); clearCachedRoster(); });

    it('says the seat by its name and counts the silence up live, with no "ago" of its own', () => {
      useRunEventStore.setState({ byRun: { [R]: ev([dispatched, working(T0 + 30 * S, 30)]) as never } });
      render(<LiveActivity runId={R} ord={5} />);
      const row = screen.getByTestId('live-activity-row');
      expect(row.getAttribute('data-kind')).toBe('working');
      expect(row.textContent).toBe('Codex · working · last output 40 s ago');
      act(() => { vi.advanceTimersByTime(6 * S); });
      expect(screen.getByTestId('live-activity-row').textContent).toBe('Codex · working · last output 46 s ago');
    });
  });
});

const JUDGE = (m: number): string => `\njudge: a judge seat is reviewing the change before the checks run — ${m} min\n`;
const F0 = "\nrepo checks floor (creator): running the repository's own checks — 0 min\n";
const delta = (ts: number, text: string): Record<string, unknown> => ({ type: 'unitOutputDelta', ord: 3, attempt: 0, ts, text });
/** The build handed off at T0; the judge reviews the change before the floor. */
const judging = (): CoreEvent[] => ev([
  { type: 'unitDispatched', ord: 3, attempt: 0, ts: T0 - 3 * MIN },
  { type: 'powerTurnStarted', ord: 3, attempt: 0, turn: 1, cli: 'claude', ts: T0 - 3 * MIN },
  { type: 'powerTurnCompleted', ord: 3, attempt: 0, turn: 1, outcome: 'handoff', ts: T0 },
  delta(T0, JUDGE(0)),
]);

describe('4. the judge before the floor says it is reviewing, in place of the silent gap', () => {
  it('reads the judge\'s line; the newest line of a chunk wins', () => {
    expect(floorLineOf(JUDGE(5))).toEqual({ phase: 'judge', role: 'judge', minutes: 5, check: null });
    expect(floorLineOf(`${JUDGE(0)}${F0}`)).toMatchObject({ phase: 'checks', minutes: 0 });
    expect(floorLineOf(`${F0}${JUDGE(0)}`)).toMatchObject({ phase: 'judge' });
    expect(isFloorDelta({ type: 'unitOutputDelta', text: JUDGE(0) })).toBe(true);
    expect(floorLineOf('the judge: I think this is fine')).toBeNull();
  });

  it('"A judge seat is reviewing the change · 1 min" until the floor starts (its own clock) or the gate is evaluated', () => {
    const f = runningFloor(judging(), T0 + 90 * S)!;
    expect(f).toMatchObject({ ord: 3, phase: 'judge', minutes: 1, since: T0 });
    expect(floorWords(f)).toBe('A judge seat is reviewing the change · 1 min');
    expect(floorBadge(f)).toBe('Judge reviewing');
    const floor = [...judging(), ...ev([delta(T0 + 2 * MIN, F0)])];
    const c = runningFloor(floor, T0 + 3 * MIN)!;
    expect(c).toMatchObject({ phase: 'checks', since: T0 + 2 * MIN, minutes: 1 });
    expect(floorBadge(c)).toBe('Running checks');
    expect(runningFloor([...judging(), ...ev([{ type: 'gateEvaluated', ord: 3, attempt: 0, ts: T0 + 2 * MIN }])], T0 + 3 * MIN)).toBeNull();
    // A floor's gate evaluation never ends the floor before its result.
    expect(runningFloor([...floor, ...ev([{ type: 'gateEvaluated', ord: 3, attempt: 0, ts: T0 + 3 * MIN }])], T0 + 4 * MIN)?.phase).toBe('checks');
  });

  it('no silence warning while the judge reviews', () => {
    const view = makeView({ id: R, status: 'executing', unit_ix: 0 } as never, [makeUnit({ id: `${R}:fix`, session_id: R, ord: 3, status: 'distributed', assigned_cli: 'claude' })]);
    expect(silentStep(view, judging(), T0 + 9 * MIN)).toBeNull();
  });

  it('the run event log keeps the judge\'s line', () => {
    useRunEventStore.setState({ byRun: {} });
    useRunEventStore.getState().ingest({ type: 'unitOutputDelta', session: 'rz', ord: 3, text: JUDGE(0) } as never);
    expect(useRunEventStore.getState().byRun['rz']).toHaveLength(1);
  });

  describe('on the run page', () => {
    beforeEach(() => {
      useSheets.setState({ open: null, stopping: {} } as never);
      useCapabilities.setState({ loaded: true } as never);
      vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404'));
      vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

    it('the working line is studio\'s "A judge seat is reviewing the change · 1 min", and the header says Judge reviewing', () => {
      vi.setSystemTime(T0 + 90 * S);
      useRunEventStore.setState({ byRun: { [R]: judging() } });
      const run = makeView({ id: R, status: 'executing', problem: 'Fix the estate row', unit_ix: 0, created_at: 1_700_000_000 } as never, [
        makeUnit({ id: `${R}:fix`, session_id: R, ord: 3, status: 'distributed', assigned_cli: 'claude', stage: 'build', description: 'fix it' }),
      ]);
      render(<SessionPage sessionId={`run:${R}`} runs={[run]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
      expect(screen.getByTestId('session-working-text').textContent).toBe('studio · A judge seat is reviewing the change · 1 min');
      expect(document.body.textContent).toContain('Judge reviewing');
      expect(document.body.textContent).not.toMatch(/No output for/u);
    });
  });
});
