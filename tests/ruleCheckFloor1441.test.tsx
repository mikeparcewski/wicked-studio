/**
 * studio#1441: during a long steering-rule check the run page said "No output for 11 min from Codex on Review" and
 * offered "Ask Codex what's happening" and "Move it to another helper", though Codex had finished its review and the
 * engine was judging the rules. The rule check is the engine's work, like the checks floor and the judge before it.
 * Now the step says "Checking the steering rules · 11 min · judges Codex and Pi" and offers nothing that moves the
 * reviewer; the rule check's own lines count as output.
 *
 * The lines are the engine's own, as `cli_runner.rs` writes them through `engine_note` ("\n{text}\n"): the judges note
 * ("rule check: {n} steering rule(s) in force; judges: {seats}") and `with_floor_heartbeat`'s ticks under the label
 * "rule check: judging the steering rules" ("{label} — {m} min", at 0 min and every 5 min). The judges are named as
 * studio names a seat key with no roster at hand (`cliLabel`: `pi` → Pi).
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent } from '../src/api/types.js';
import { floorLineOf, isFloorDelta } from '../src/board/floorLine.js';
import { floorBadge, floorWords, runningFloor } from '../src/board/floorRun.js';
import { silentStep } from '../src/board/silentStep.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useRunEventStore } from '../src/store/events.js';
import { useSheets } from '../src/store/sheets.js';
import { makeUnit, makeView } from './factories.js';

const R = 'r-1441';
const T0 = 1_793_364_037_000;
const MIN = 60_000;
const ev = (x: Array<Record<string, unknown>>): CoreEvent[] => x.map((e) => ({ session: R, ...e })) as unknown as CoreEvent[];
const delta = (ts: number, text: string): Record<string, unknown> => ({ type: 'unitOutputDelta', ord: 5, attempt: 0, ts, text });
const JUDGES = '\nrule check: 5 steering rule(s) in force; judges: codex, pi\n';
const TICK = (m: number): string => `\nrule check: judging the steering rules — ${m} min\n`;

/** Codex reviewed (unit 5) and finished at T0; the engine then judges the steering rules, ticking every 5 min. */
const ruleCheck = (): CoreEvent[] => ev([
  { type: 'unitDispatched', ord: 5, attempt: 0, ts: T0 - 6 * MIN },
  delta(T0 - MIN, 'Review complete: no blocking findings.'),
  delta(T0, JUDGES),
  delta(T0, TICK(0)),
  delta(T0 + 5 * MIN, TICK(5)),
  delta(T0 + 10 * MIN, TICK(10)),
]);

const reviewView = () => makeView({ id: R, status: 'executing', unit_ix: 0 } as never, [
  makeUnit({ id: `${R}:review`, session_id: R, ord: 5, status: 'distributed', assigned_cli: 'codex', stage: 'review', description: 'review it' }),
]);

describe('studio#1441: a long rule check is the engine working, not a silent reviewer', () => {
  it('reads the rule check\'s lines as the engine\'s own work, and the event log keeps them', () => {
    expect(floorLineOf(TICK(10))).toMatchObject({ phase: 'rules', minutes: 10 });
    expect(floorLineOf(JUDGES)).toMatchObject({ phase: 'rules', minutes: 0, judges: ['codex', 'pi'] });
    expect(isFloorDelta({ type: 'unitOutputDelta', text: TICK(0) })).toBe(true);
    useRunEventStore.setState({ byRun: {} });
    useRunEventStore.getState().ingest({ type: 'unitOutputDelta', session: 'rz', ord: 5, text: TICK(5) } as never);
    expect(useRunEventStore.getState().byRun['rz']).toHaveLength(1);
  });

  it('"Checking the steering rules · 11 min · judges Codex and Pi" until the gate is evaluated', () => {
    const f = runningFloor(ruleCheck(), T0 + 11.7 * MIN)!;
    expect(f).toMatchObject({ ord: 5, phase: 'rules', minutes: 11, since: T0 });
    expect(floorWords(f)).toBe('Checking the steering rules · 11 min · judges Codex and Pi');
    expect(floorBadge(f)).toBe('Checking rules');
    expect(runningFloor([...ruleCheck(), ...ev([{ type: 'gateEvaluated', ord: 5, attempt: 0, ts: T0 + 12 * MIN }])], T0 + 13 * MIN)).toBeNull();
  });

  it('no silence warning while the rules are judged, whatever crew\'s clock says', () => {
    expect(silentStep(reviewView(), ruleCheck(), T0 + 11.7 * MIN)).toBeNull();
    expect(silentStep(reviewView(), ruleCheck(), T0 + 11.7 * MIN, { crew: { minutes: 11 } as never })).toBeNull();
  });

  describe('on the run page', () => {
    beforeEach(() => {
      useSheets.setState({ open: null, stopping: {} } as never);
      useCapabilities.setState({ loaded: true } as never);
      vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404'));
      vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

    it('the step says it is checking the rules, and offers nothing that moves the reviewer', () => {
      vi.setSystemTime(T0 + 11.7 * MIN);
      useRunEventStore.setState({ byRun: { [R]: ruleCheck() } });
      const run = makeView({ id: R, status: 'executing', problem: 'Fix the estate row', unit_ix: 0, created_at: 1_700_000_000 } as never, [
        makeUnit({ id: `${R}:review`, session_id: R, ord: 5, status: 'distributed', assigned_cli: 'codex', stage: 'review', description: 'review it' }),
      ]);
      render(<SessionPage sessionId={`run:${R}`} runs={[run]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
      expect(screen.getByTestId('session-working-text').textContent).toBe('studio · Checking the steering rules · 11 min · judges Codex and Pi');
      expect(document.body.textContent).toContain('Checking rules');
      expect(document.body.textContent).not.toMatch(/No output for/u);
      expect(document.body.textContent).not.toContain('Move it to another helper');
      expect(document.body.textContent).not.toContain('what’s happening');
    });
  });

  describe('round 1 (codex, pi): only the engine\'s own lines, and only while the check runs', () => {
    // `rule_check.rs` RuleReport::summary, then " ({elapsed} ms)" (`cli_runner.rs`).
    const DONE = '\nrule check: 5 rules checked: 5 kept, 0 broken, 0 not applicable (702113 ms)\n';

    it('a line quoted inside the reviewer\'s own output is not the engine\'s', () => {
      const quoted = 'The fixture expects "rule check: judging the steering rules — 10 min" here.';
      expect(floorLineOf(quoted)).toBeNull();
      expect(floorLineOf(`I saw rule check: 5 steering rule(s) in force; judges: codex`)).toBeNull();
      expect(isFloorDelta({ type: 'unitOutputDelta', text: quoted })).toBe(false);
    });

    it('the check\'s summary ends it, without waiting for the gate', () => {
      expect(runningFloor([...ruleCheck(), ...ev([delta(T0 + 11 * MIN, DONE)])], T0 + 11.7 * MIN)).toBeNull();
      expect(isFloorDelta({ type: 'unitOutputDelta', text: DONE })).toBe(true);
    });

    it('a check whose heartbeat stopped is no longer said to be running', () => {
      // The last tick was at 10 min; the engine ticks every 5 min, so at 21 min the check is not running any more.
      expect(runningFloor(ruleCheck(), T0 + 21 * MIN)).toBeNull();
      expect(runningFloor(ruleCheck(), T0 + 14 * MIN)).not.toBeNull();
    });

    it('an earlier attempt\'s late tick never reopens the check over a new attempt', () => {
      const redispatched = [...ruleCheck(), ...ev([{ type: 'unitDispatched', ord: 5, attempt: 1, ts: T0 + 10.5 * MIN }, delta(T0 + 11 * MIN, TICK(11))])];
      expect(runningFloor(redispatched, T0 + 11.5 * MIN)).toBeNull();
    });

    it('the judges note and the first tick in one chunk keep the judges', () => {
      const chunk = ev([delta(T0, `${JUDGES}${TICK(0)}`)]);
      expect(floorWords(runningFloor(chunk, T0 + 2 * MIN)!)).toBe('Checking the steering rules · 2 min · judges Codex and Pi');
      expect(floorLineOf('\nrule check: 1 steering rule(s) in force; judges: none\n')).toMatchObject({ phase: 'rules', judges: [] });
      expect(floorLineOf('\nrule check: 2 steering rule(s) in force; judges: codex#2, claude-b\n')?.judges).toEqual(['codex#2', 'claude-b']);
    });
  });
});
