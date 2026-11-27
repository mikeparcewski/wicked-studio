/**
 * studio#1499 (W6): a healthy scripted step was called wedged. In the train-18 cert (J6 v3 Run B) the first step, the
 * Tool step `domain-run`, ran 35 min and writes its output only when it ends. At 31 min the run page said "No output for
 * N min from Bash", offered "Ask Bash" and "Move it to another helper", and Needs you listed "No activity for 31m — the
 * run may be wedged". A scripted step is working, not silent: "Domain run is working · 31 min", no seat levers, not a
 * need.
 *
 * Fixtures:
 *  - the events are Run B's own log (`GET /runs/d2941d80…/events`, tests/fixtures/run-d2941d80-domain-events.json);
 *  - the units are the real Tool unit `GET /runs/b0ade71f…` served (its deliver unit, with `tool_cmd`, as wicked-core's
 *    `WorkUnit` serializes it: core src/domain.rs:1370), re-keyed to Run B's two Tool steps with the commands Run B's
 *    `toolExecutorDispatched` frames name. Only the run and unit status fields are set to the moment under test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import standin from './fixtures/run-b0ade71f-standin.json';
import runB from './fixtures/run-d2941d80-domain-events.json';
import type { CoreEvent, SessionView, WorkUnit } from '../src/api/types.js';
import { scriptedStep, scriptedWords, runsScript } from '../src/board/scriptedStep.js';
import { silentStep } from '../src/board/silentStep.js';
import { runDeltaOf, stalledRuns } from '../src/board/stalls.js';
import { RunQuestions } from '../src/components/session/ThreadQuestions.js';
import { RunTab } from '../src/components/session/RunTab.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import { useGateStore } from '../src/store/gates.js';
import { usePlanCatalog } from '../src/store/planCatalog.js';
import { useTeamPlanStore } from '../src/store/teamPlan.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import { useRunAcceptanceStore } from '../src/store/runAcceptance.js';
import { setCachedRoster } from '../src/store/rosterCache.js';
import * as sheets from '../src/store/sheets.js';
import { resetRunPanel } from '../src/store/runPanel.js';
import { RUN_PANEL_KEY } from '../src/board/runPanelModel.js';

const EVENTS = (runB as unknown as { runId: string; events: CoreEvent[] }).events;
const RUN = (runB as unknown as { runId: string }).runId;
const seqOf = (e: CoreEvent): number => (e as unknown as { seq: number }).seq;
const upTo = (seq: number): CoreEvent[] => EVENTS.filter((e) => seqOf(e) <= seq);
const frame = (seq: number): CoreEvent & Record<string, unknown> => EVENTS.find((e) => seqOf(e) === seq)! as CoreEvent & Record<string, unknown>;
const MIN = 60_000;
/** Run B's `unitDispatched` for ord 1, attempt 0 (seq 1482). */
const DISPATCHED = frame(1482).ts as number;
const AT_31 = DISPATCHED + 31 * MIN;

const TEMPLATE = (standin as unknown as { run: SessionView }).run.units.find((u) => Array.isArray(u.tool_cmd))!;
const SESSION = (standin as unknown as { run: SessionView }).run.session;
const cmdOf = (seq: number): string[] => frame(seq)['cmd'] as string[];
const toolUnit = (ord: number, key: string, cli: string, cmd: string[] | null | undefined, status: WorkUnit['status']): WorkUnit => {
  const u = { ...TEMPLATE, id: `${RUN}:${key}`, session_id: RUN, ord, assigned_cli: cli, status, description: key } as WorkUnit & Record<string, unknown>;
  if (cmd === undefined) delete u['tool_cmd'];
  else u.tool_cmd = cmd;
  return u;
};
/** Run B as its view read while ord `on` ran: unit 1 `domain-run` (bash), unit 2 `domain-graph` (wicked-core). */
const viewB = (o: { on?: 1 | 2; cmd1?: string[] | null | undefined; status?: string } = {}): SessionView => {
  const on = o.on ?? 1;
  return {
    session: { ...SESSION, id: RUN, status: (o.status ?? 'executing') as never, unit_ix: on - 1 } as SessionView['session'],
    units: [
      toolUnit(1, 'domain-run', 'bash', 'cmd1' in o ? o.cmd1 : cmdOf(1484), on === 1 ? 'distributed' : 'done'),
      toolUnit(2, 'domain-graph', 'wicked-core', cmdOf(1751), 'distributed'),
    ],
  };
};

describe('studio#1499: a scripted step is working, not silent (Run B, 31 min into domain-run)', () => {
  it('the run page reads "Domain run is working · 31 min", and the silence rules stand down', () => {
    const log = upTo(1484);
    const s = scriptedStep(viewB(), log, AT_31)!;
    expect(s).toEqual({ ord: 1, label: 'Domain run', minutes: 31 });
    expect(scriptedWords(s)).toBe('Domain run is working · 31 min');
    // On main: "No output for 31 min", and with crew's quiet verdict "No output for 7 min" (the cert's words).
    expect(silentStep(viewB(), log, AT_31)).toBeNull();
    expect(silentStep(viewB(), log, AT_31, { crew: { minutes: 7, ord: null, cli: null } })).toBeNull();
  });

  it('it is not a need: no "No activity for 31m — the run may be wedged" row', () => {
    // On main: { [RUN]: DISPATCHED }, which Needs you words as the wedge row and marks the run held ("Waiting").
    expect(stalledRuns([viewB()], () => DISPATCHED + 54, AT_31)).toEqual({});
  });

  it('the Now panel says it, and no silent-step card offers "Ask" or "Move it to another helper"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(AT_31);
      useRunEventStore.setState({ byRun: { [RUN]: upTo(1484) } });
      const q = render(<RunQuestions view={viewB()} />);
      expect(q.queryByTestId('silent-step')).toBeNull();
      expect(q.queryByTestId('silent-step-move')).toBeNull();
      q.unmount();
      await act(async () => { render(<RunTab runs={[viewB()]} sessionId="chat-1" title="Domain map" />); });
      expect(screen.getByTestId('run-tab-pill').textContent).toBe('Domain run is working · 31 min');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('studio#1499 design classes', () => {
  it('STALE READS: once the log shows the step done, or the next step dispatched, a lagging view claims nothing', () => {
    // The view still says ord 1 is distributed; the log has moved on.
    expect(scriptedStep(viewB(), upTo(1747), AT_31)).toBeNull(); // unitDone ord 1
    expect(scriptedStep(viewB(), upTo(1744), AT_31)).toBeNull(); // unitOutputCaptured: the command is over
    expect(scriptedStep(viewB(), upTo(1748), AT_31)).toBeNull(); // unitDispatched ord 2
    expect(scriptedStep(viewB({ status: 'completed' }), upTo(1757), AT_31)).toBeNull();
    // The view that has caught up names ord 2, the next scripted step, from its own dispatch.
    expect(scriptedStep(viewB({ on: 2 }), upTo(1752), (frame(1748).ts as number) + 2 * MIN)).toEqual({ ord: 2, label: 'Domain graph', minutes: 2 });
  });

  it('STALE READS (codex r1): a lagging view\'s Tool cursor never hides the next step\'s stall', () => {
    // The view still has domain-run under the cursor; the log has domain-graph dispatched and quiet for 31 min, as long as the cert saw it.
    const log = upTo(1748);
    const evidence = frame(1748).ts as number;
    expect(stalledRuns([viewB()], () => evidence, evidence + 31 * MIN, () => log)).toEqual({ [RUN]: evidence });
    expect(runsScript(viewB(), log)).toBe(false);
    // The app's own read: the event store, which every live frame reaches.
    useRunEventStore.setState({ byRun: { [RUN]: log } });
    expect(stalledRuns([viewB()], () => evidence, evidence + 31 * MIN)).toEqual({ [RUN]: evidence });
    useRunEventStore.setState({ byRun: { [RUN]: upTo(1484) } });
    expect(stalledRuns([viewB()], () => DISPATCHED, AT_31)).toEqual({});
  });

  it('STALE READS (coord ruling on the DES): a window holding only the next step\'s working frames ends the claim', () => {
    // Codex r2: no unitDispatched for either step in the window, only domain-graph working (1749) or captured (1753).
    for (const seq of [1749, 1753]) {
      const log = [frame(seq)];
      expect(scriptedStep(viewB(), log, AT_31)).toBeNull();
      expect(silentStep(viewB(), log, (frame(seq).ts as number) + 31 * MIN)).not.toBeNull();
      expect(stalledRuns([viewB()], () => frame(seq).ts as number, (frame(seq).ts as number) + 31 * MIN, () => log)).toEqual({ [RUN]: frame(seq).ts });
    }
    // An earlier step's gate frames are not another step working: the claim stands.
    expect(scriptedStep(viewB({ on: 2 }), [frame(1752), frame(1745), frame(1746)], AT_31)?.ord).toBe(2);
  });

  it('STALE READS (studio#1507): a page whose log holds only the next step\'s output deltas still lists its stall', async () => {
    // The page loaded after domain-graph's dispatch: the only frames it saw are that step's live output deltas, which the
    // event store drops (events.ts IGNORED) and the runtime store keeps as its delta clock. Fed as App feeds both.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const at = frame(1752).ts as number;
      vi.setSystemTime(at);
      useRuntimeStore.getState().clear(RUN);
      const live: Record<string, unknown> = { ...frame(1752) };
      delete live['ts']; delete live['seq']; // a live /ws frame carries neither
      useRuntimeStore.getState().ingest(live as unknown as CoreEvent);
      useRunEventStore.getState().ingest(live as unknown as CoreEvent);
      expect(useRunEventStore.getState().byRun[RUN] ?? []).toEqual([]);
      expect(stalledRuns([viewB()], () => at, at + 31 * MIN)).toEqual({ [RUN]: at });
      expect(runsScript(viewB(), useRunEventStore.getState().byRun[RUN], runDeltaOf(RUN))).toBe(false);
      // The Tool step's own output is not another step working: the claim stands.
      useRuntimeStore.getState().ingest({ ...live, ord: 1 } as unknown as CoreEvent);
      expect(stalledRuns([viewB({ on: 1 })], () => at, at + 31 * MIN)).toEqual({});
    } finally {
      vi.useRealTimers();
      useRuntimeStore.getState().clear(RUN);
    }
  });

  it('IDENTITY REUSE (coord ruling on the DES): a run that ended and was resumed is read from its resumed dispatch', () => {
    const resumed = [
      ...upTo(1484),
      { ...frame(1757), type: 'sessionFailed', seq: 1600, ts: DISPATCHED + 10 * MIN },
      { ...frame(1482), attempt: 1, seq: 1601, ts: DISPATCHED + 12 * MIN },
    ] as CoreEvent[];
    expect(scriptedStep(viewB(), resumed, AT_31)).toEqual({ ord: 1, label: 'Domain run', minutes: 19 });
    expect(silentStep(viewB(), resumed, AT_31)).toBeNull();
    // Ended and not resumed: no claim.
    expect(scriptedStep(viewB(), resumed.slice(0, -1), AT_31)).toBeNull();
  });

  it('a Tool step whose output is captured (its gate running) offers no seat levers either (codex r1, W4)', () => {
    // The view lags at ord 1; the log has its capture and gate, not the next dispatch. No "is working" claim, and no
    // silent-seat card ("Ask Bash", "Move it to another helper"): no seat runs it.
    const log = upTo(1746);
    expect(scriptedStep(viewB(), log, AT_31)).toBeNull();
    expect(silentStep(viewB(), log, AT_31 + 40 * MIN)).toBeNull();
  });

  it('IDENTITY REUSE: an agent step goes back to the silence rules; the newest attempt is the one counted', () => {
    // The same ord run by a seat (no tool_cmd): not scripted, so "No output for 31 min" still speaks.
    expect(scriptedStep(viewB({ cmd1: null }), upTo(1484), AT_31)).toBeNull();
    // (It counts from the step's last frame, toolExecutorDispatched 27 ms after the dispatch: 30 whole minutes.)
    expect(silentStep(viewB({ cmd1: null }), upTo(1484), AT_31)?.minutes).toBe(30);
    // Attempt 0 failed and attempt 1 was dispatched at 20 min; a late capture from attempt 0 never closes attempt 1.
    const retry = [
      ...upTo(1484),
      { ...frame(1743), type: 'stepFailed', seq: 1500, ts: DISPATCHED + 19 * MIN },
      { ...frame(1482), attempt: 1, seq: 1501, ts: DISPATCHED + 20 * MIN },
      { ...frame(1744), attempt: 0, seq: 1502, ts: DISPATCHED + 21 * MIN },
    ] as CoreEvent[];
    expect(scriptedStep(viewB(), retry, AT_31)).toEqual({ ord: 1, label: 'Domain run', minutes: 11 });
  });

  it('PARTIAL FAILURE: an older view without tool_cmd keeps today\'s rules; no log means no minutes', () => {
    expect(scriptedStep(viewB({ cmd1: undefined }), upTo(1484), AT_31)).toBeNull();
    const noLog = scriptedStep(viewB(), undefined, AT_31)!;
    expect(noLog).toEqual({ ord: 1, label: 'Domain run', minutes: null });
    expect(scriptedWords(noLog)).toBe('Domain run is working');
    // A log that does not reach the dispatch yet (a partial read) claims the view's step without a clock.
    expect(scriptedStep(viewB(), upTo(1450), AT_31)).toEqual({ ord: 1, label: 'Domain run', minutes: null });
    // The Everything page has crew's verdict and the view, no log.
    expect(runsScript(viewB(), undefined)).toBe(true);
    expect(runsScript(viewB({ cmd1: null }), undefined)).toBe(false);
    expect(runsScript(undefined, undefined)).toBe(false);
  });

  it('PARTIAL FAILURE (codex r1): a log window holding only the step\'s end still ends it', () => {
    // A live log since page load can miss the dispatch and hold only the closing frame.
    expect(scriptedStep(viewB(), [frame(1744)], AT_31)).toBeNull(); // unitOutputCaptured alone
    expect(scriptedStep(viewB(), [frame(1747)], AT_31)).toBeNull(); // unitDone alone
    expect(runsScript(viewB(), [frame(1747)])).toBe(false);
  });

  it('UNTRUSTED TEXT OUT: the words come from the unit key, never the command or its output', () => {
    const MARK = '<img src=x onerror=alert(1)>MARKER';
    const log = [...upTo(1484), { ...frame(1743), text: MARK, seq: 1490, ts: DISPATCHED + MIN }] as CoreEvent[];
    const words = scriptedWords(scriptedStep(viewB({ cmd1: ['bash', '-c', `echo ${MARK}`] }), log, AT_31)!);
    expect(words).toBe('Domain run is working · 31 min');
    expect(words).not.toContain('MARKER');
  });
});

beforeEach(() => {
  localStorage.removeItem(RUN_PANEL_KEY);
  resetRunPanel();
  sheets.useSheets.setState({ open: null, pointed: null, stopping: {} });
  useGateStore.setState({ gates: {}, approaching: {} });
  useTeamPlanStore.setState({ byRun: {}, refs: {} });
  usePlanCatalog.setState({ catalog: 'ready', entries: [] });
  useRunEventStore.setState({ byRun: {} });
  useRunAcceptanceStore.setState({ byRun: {} });
  setCachedRoster([{ key: 'claude', display_name: 'Claude Code', binary: 'claude', enabled_for_council: true }]);
  vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] });
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Unexpected transport read')));
});

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
