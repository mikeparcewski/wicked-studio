/**
 * The power-mode re-time's UI gaps (crew ea73afc0 / core acf30461 on studio 0.13.0 + #933, 2026-10-30). The frames below
 * are the run's own shapes (the engine's floor lines, its tool frames and its gate lifecycle), cut to what each fix reads.
 */
import { act, cleanup, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { CoreEvent } from '../src/api/types.js';
import { floorLineOf, isFloorDelta } from '../src/board/floorLine.js';
import { floorWords, runningFloor } from '../src/board/floorRun.js';
import { activityRows, activitySummary, commandKind, currentTurn, editedPath, turnEndedAt, visibleRows, KEEP_FINISHED_MS } from '../src/board/liveActivity.js';
import { powerPhases } from '../src/board/powerMode.js';
import { silentStep } from '../src/board/silentStep.js';
import { toRow, type TopicRow } from '../src/editors/runEvents.js';
import { emptyReport, foldRows, phaseDashboard, phaseSummary, type PhaseScope } from '../src/plugins/wicked-phase-report/model.js';
import { docLines, pluginWritesLines } from '../src/plugins/wicked-phase-report/workingDoc.js';
import { LiveActivity } from '../src/components/session/LiveActivity.js';
import { SessionPage } from '../src/components/session/SessionView.js';
import { useRunningFloor } from '../src/hooks/useRunningFloor.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useRunEventStore } from '../src/store/events.js';
import { useRuntimeStore } from '../src/store/runtime.js';
import { useSheets } from '../src/store/sheets.js';
import { state } from './powerFixtures.js';
import { makeUnit, makeView } from './factories.js';

const R = 'r1';
const T0 = 1_793_364_037_000;
const MIN = 60_000;
const ev = (x: Array<Record<string, unknown>>): CoreEvent[] => x.map((e) => ({ session: R, ...e })) as unknown as CoreEvent[];
const floorLine = (ord: number, ts: number, text: string): Record<string, unknown> => ({ type: 'unitOutputDelta', ord, attempt: 0, ts, text });
const F0 = "\nrepo checks floor (creator): running the repository's own checks — 0 min\n";
const F = (total: number, check: string, pass: number, inMin: number): string =>
  `\nrepo checks floor (creator): running the repository's own checks — ${total} min; now \`${check}\` on the change (pass ${pass} of \`${check}\`), ${inMin} min in\n`;

/** The build's turn ended at T0 and handed off: the floor started then and says so every 5 min. */
const floorRunning = (): CoreEvent[] => ev([
  { type: 'unitDispatched', ord: 3, attempt: 0, ts: T0 - 3 * MIN },
  { type: 'powerTurnStarted', ord: 3, attempt: 0, turn: 1, cli: 'claude', ts: T0 - 3 * MIN },
  { type: 'powerTurnCompleted', ord: 3, attempt: 0, turn: 1, outcome: 'handoff', ts: T0 },
  floorLine(3, T0, F0),
  floorLine(3, T0 + 5 * MIN, F(5, 'test', 1, 3)),
  floorLine(3, T0 + 10 * MIN, F(10, 'test', 1, 8)),
]);

describe('1. a running floor is the engine working, not a silent seat', () => {
  it('reads the floor\'s own lines: the newest of a chunk, its check and minutes; other words are not the floor', () => {
    expect(floorLineOf(`${F0}${F(5, 'test', 1, 3)}`)).toEqual({ role: 'creator', minutes: 5, check: 'test' });
    expect(floorLineOf(F0)).toEqual({ role: 'creator', minutes: 0, check: null });
    expect(floorLineOf("\ndependencies: checking the worktree's node_modules for the seats — 0 min\n")).toBeNull();
    expect(isFloorDelta({ type: 'unitOutputDelta', text: F0 })).toBe(true);
    expect(isFloorDelta({ type: 'unitOutputDelta', text: 'I fixed it.' })).toBe(false);
  });

  it('"Running checks · test · 12 min" from the floor\'s start, until its result or the next turn', () => {
    const f = runningFloor(floorRunning(), T0 + 12 * MIN)!;
    expect(f).toMatchObject({ ord: 3, check: 'test', minutes: 12, since: T0 });
    expect(floorWords(f)).toBe('Running checks · test · 12 min');
    // Joined mid-floor (the first line seen says 15 min in): the start is read back from it.
    expect(runningFloor(ev([floorLine(3, T0 + 15 * MIN, F(15, 'test', 2, 0))]), T0 + 16 * MIN)?.minutes).toBe(16);
    const ended = [...floorRunning(), ...ev([{ type: 'repoChecksEvaluated', ord: 3, attempt: 0, passed: false, ts: T0 + 35 * MIN }])];
    expect(runningFloor(ended, T0 + 36 * MIN)).toBeNull();
    const nextTurn = [...floorRunning(), ...ev([{ type: 'powerTurnStarted', ord: 3, attempt: 1, turn: 1, ts: T0 + 36 * MIN }])];
    expect(runningFloor(nextTurn, T0 + 37 * MIN)).toBeNull();
  });

  it('no silence warning during a floor; the seat\'s own quiet turn still gets one', () => {
    const view = makeView({ id: R, status: 'executing', unit_ix: 0 } as never, [makeUnit({ id: 'r1:fix', session_id: R, ord: 3, status: 'distributed', assigned_cli: 'claude' })]);
    // The page's live socket missed the heartbeats: 9 min since the floor's last line it heard.
    const one = ev([...(floorRunning().slice(0, 4) as unknown as Array<Record<string, unknown>>)]);
    expect(silentStep(view, one, T0 + 9 * MIN)).toBeNull();
    const ownTurn = [...floorRunning(), ...ev([
      { type: 'repoChecksEvaluated', ord: 3, attempt: 0, passed: false, ts: T0 + 30 * MIN },
      { type: 'powerTurnStarted', ord: 3, attempt: 1, turn: 1, ts: T0 + 30 * MIN },
    ])];
    expect(silentStep(view, ownTurn, T0 + 37 * MIN)).toEqual({ minutes: 7, ord: 3, cli: 'claude' });
  });

  it('the run event log keeps the floor\'s lines (live and replayed), and drops every other output delta', () => {
    useRunEventStore.setState({ byRun: {} });
    const s = useRunEventStore.getState();
    s.ingest({ type: 'unitOutputDelta', session: 'rx', ord: 3, text: F0 } as never);
    s.ingest({ type: 'unitOutputDelta', session: 'rx', ord: 3, text: 'Reading the route.' } as never);
    expect(useRunEventStore.getState().byRun['rx']!.map((e) => (e as { text?: string }).text)).toEqual([F0]);
    s.hydrate('ry', ev([{ type: 'unitOutputDelta', ord: 3, text: 'words', seq: 1, ts: T0 }, { type: 'unitOutputDelta', ord: 3, text: F(5, 'test', 1, 3), seq: 2, ts: T0 }]).map((e) => ({ ...e, session: 'ry' })) as never);
    expect(useRunEventStore.getState().byRun['ry']).toHaveLength(1);
  });

  describe('on the run page', () => {
    beforeEach(() => {
      useSheets.setState({ open: null, stopping: {} } as never);
      useCapabilities.setState({ loaded: true } as never);
      vi.spyOn(client.api, 'getWatch').mockRejectedValue(new Error('404'));
      vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
    const run = () => makeView({ id: R, status: 'executing', problem: 'Fix the estate row', unit_ix: 0, created_at: 1_700_000_000 } as never, [
      makeUnit({ id: 'r1:fix', session_id: R, ord: 3, status: 'distributed', assigned_cli: 'claude', stage: 'build', description: 'fix it' }),
    ]);

    it('the working line says "Running checks · test · 12 min", the header says Running checks, and nothing offers a reassign', () => {
      vi.setSystemTime(T0 + 12 * MIN);
      useRunEventStore.setState({ byRun: { [R]: floorRunning().slice(0, 4) } });
      render(<SessionPage sessionId={`run:${R}`} runs={[run()]} runsLoaded needRows={[]} navigate={() => {}} onAsk={() => {}} />);
      expect(screen.getByTestId('session-working-floor').textContent).toBe('· Running checks · 12 min');
      // The floor is the engine's work: the line is studio's, not the idle seat's.
      expect(screen.getByTestId('session-working-text').textContent).toBe('studio · Running checks · 12 min');
      expect(screen.queryByTestId('silent-step')).toBeNull();
      expect(screen.queryByText('Move it to another helper')).toBeNull();
      expect(document.body.textContent).not.toMatch(/No output for/u);
      expect(document.body.textContent).toContain('Running checks');
    });

    it('the hook follows the floor\'s newest check', () => {
      vi.setSystemTime(T0 + 12 * MIN);
      useRunEventStore.setState({ byRun: { [R]: floorRunning() } });
      expect(renderHook(() => useRunningFloor(run())).result.current).toMatchObject({ check: 'test', minutes: 12 });
    });
  });
});

describe('2. an activity row says what the command does', () => {
  it('edits are edits, a test runner is the tests, a mention of tests/ is neither', () => {
    expect(commandKind("sed -n 266,278p tests/memory-route.test.ts; grep -n \"^import\" tests/memory-route.test.ts")).toBeNull();
    expect(commandKind('sed -i "125,133s/probeEstate({ memoryStore: store, exists/probeEstate({ memoryStore: store, res')).toBe('edit');
    expect(commandKind("python3 - <<'E' p='tests/memory-route.test.ts' s=open(p).read() s=s.replace(\"\"\" // ── GET /memory/coverage ─\"\"\",\"\"\" it('502s a…")).toBe('edit');
    expect(commandKind("cd packages/crew && python3 - <<'E' p='src/api/system-snapshot.ts' s=open(p).read() a=s.index(\"export function x\")")).toBeNull();
    expect(commandKind('npx vitest run tests/estate-mcp-client.test.ts 2>&1 | grep -E "FAIL|Error" | head -8')).toBe('test');
    expect(commandKind('cd packages/crew && npm run test:unit -- system')).toBe('test');
    expect(commandKind('cargo test -p wicked-core --lib floor')).toBe('test');
    expect(commandKind('cat > notes.md <<EOF')).toBe('edit');
    expect(commandKind('git status --short')).toBeNull();
    expect(editedPath("python3 - <<'E' p='tests/memory-route.test.ts' s=open(p).read()")).toBe('tests/memory-route.test.ts');
  });

  it('the engine\'s "test" guess on a heredoc edit and studio\'s on `sed -n tests/…` both read as what ran', () => {
    const frames = ev([
      { type: 'unitDispatched', ord: 3, ts: T0 },
      { type: 'toolActivity', ord: 3, id: 'a', state: 'finished', tool: 'Bash', kind: 'test', ok: true, target: "python3 - <<'E' p='tests/memory-route.test.ts' s=open(p).read() s=s.replace(\"x\",\"y\")", ts: T0 + 1000 },
      { type: 'toolActivity', ord: 3, id: 'b', state: 'finished', tool: 'Bash', kind: 'run', ok: true, target: 'sed -n 266,278p tests/memory-route.test.ts', ts: T0 + 2000 },
      { type: 'toolActivity', ord: 3, id: 'c', state: 'finished', tool: 'Bash', kind: 'test', ok: false, target: 'npx vitest run tests/x.test.ts', ts: T0 + 3000 },
    ]);
    expect(activityRows(frames, 3).map((r) => `${r.kind}:${r.text}`)).toEqual([
      'edit:Edited tests/memory-route.test.ts',
      'run:Ran `sed -n 266,278p tests/memory-route.test.ts`',
      'test:Tests failed · `npx vitest run tests/x.test.ts`',
    ]);
  });
});

/** Three attempts of the build, each with its turn 1 (the retime's a0, a1, a2). */
const retries = (): CoreEvent[] => ev([
  { type: 'unitDispatched', ord: 3, attempt: 0, ts: T0 },
  { type: 'powerTurnStarted', ord: 3, attempt: 0, turn: 1, ts: T0 },
  { type: 'toolActivity', ord: 3, attempt: 0, id: 'a0', state: 'finished', tool: 'Read', kind: 'read', target: 'src/a.ts', ok: true, ts: T0 + 1000 },
  { type: 'powerTurnCompleted', ord: 3, attempt: 0, turn: 1, outcome: 'handoff', ts: T0 + 2000 },
  { type: 'unitDispatched', ord: 3, attempt: 1, ts: T0 + 40 * MIN },
  { type: 'powerTurnStarted', ord: 3, attempt: 1, turn: 1, ts: T0 + 40 * MIN },
  { type: 'toolActivity', ord: 3, attempt: 1, id: 'a1', state: 'finished', tool: 'Edit', kind: 'edit', target: 'src/b.ts', ok: true, ts: T0 + 41 * MIN },
  { type: 'powerTurnCompleted', ord: 3, attempt: 1, turn: 1, outcome: 'handoff', ts: T0 + 42 * MIN },
  { type: 'unitDispatched', ord: 3, attempt: 2, ts: T0 + 80 * MIN },
  { type: 'powerTurnStarted', ord: 3, attempt: 2, turn: 1, ts: T0 + 80 * MIN },
  { type: 'toolActivity', ord: 3, attempt: 2, id: 'a2', state: 'started', tool: 'Bash', kind: 'test', target: 'npx vitest run tests/system-snapshot.test.ts', ok: null, ts: T0 + 80 * MIN + 11_000 },
]);

describe('5. live activity keeps a short call in view', () => {
  it('a retry\'s turn 1 is its own turn: its call shows while it runs, and each attempt\'s summary is its own', () => {
    const e = retries();
    expect(currentTurn(e, 3)).toEqual({ turn: 1, attempt: 2 });
    expect(turnEndedAt(e, 3, currentTurn(e, 3)!)).toBeNull();
    expect(activityRows(e, 3, currentTurn(e, 3)).map((r) => r.text)).toEqual(['Running the tests `npx vitest run tests/system-snapshot.test.ts`']);
    expect(activitySummary(e, 3, { turn: 1, attempt: 0 })).toBe('Read 1 file');
    expect(activitySummary(e, 3, { turn: 1, attempt: 1 })).toBe('Edited 1 file');
  });

  it('after the turn ends, its finished calls stay about a minute, then the list folds', () => {
    const rows = activityRows(retries(), 3, { turn: 1, attempt: 1 });
    const ended = T0 + 42 * MIN;
    expect(visibleRows(rows, null, ended + 5 * MIN)).toHaveLength(1); // a running turn keeps its rows
    expect(visibleRows(rows, ended, T0 + 41 * MIN + 30_000)).toHaveLength(1);
    expect(visibleRows(rows, ended, T0 + 41 * MIN + KEEP_FINISHED_MS + 1)).toHaveLength(0);
  });

  describe('the live list', () => {
    beforeEach(() => { useRuntimeStore.setState({ outputs: {} } as never); vi.useFakeTimers(); });
    afterEach(() => { cleanup(); vi.useRealTimers(); });
    it('shows a 39 s call through its run and for a minute after the turn ended', () => {
      vi.setSystemTime(T0 + 80 * MIN + 30_000);
      useRunEventStore.setState({ byRun: { [R]: retries() } });
      render(<LiveActivity runId={R} ord={3} />);
      expect(screen.getAllByTestId('live-activity-row').map((r) => r.dataset['running'])).toEqual(['true']);
      act(() => {
        useRunEventStore.setState((s) => ({ byRun: { [R]: [...s.byRun[R]!, ...ev([
          { type: 'toolActivity', ord: 3, attempt: 2, id: 'a2', state: 'finished', tool: 'Bash', kind: 'test', target: 'npx vitest run tests/system-snapshot.test.ts', ok: true, ts: T0 + 80 * MIN + 50_000 },
          { type: 'powerTurnCompleted', ord: 3, attempt: 2, turn: 1, outcome: 'handoff', ts: T0 + 80 * MIN + 59_000 },
        ])] } }));
      });
      act(() => { vi.advanceTimersByTime(15_000); });
      expect(screen.getAllByTestId('live-activity-row')[0]!.textContent).toMatch(/^Tests passed/u);
      // 55 s after it finished it is still there; past a minute the list folds.
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(screen.getAllByTestId('live-activity-row')).toHaveLength(1);
      act(() => { vi.advanceTimersByTime(6_000); });
      expect(screen.queryByTestId('live-activity')).toBeNull();
    });
  });
});

const rowsOf = (events: CoreEvent[]): TopicRow[] => events
  .map((e, i) => toRow(e, R, (e as { ts?: number }).ts ?? T0, `s${i}`, (cli) => ({ claude: 'Claude Code', codex: 'Codex' } as Record<string, string>)[cli] ?? null))
  .filter((r): r is TopicRow => r !== null);
const report = (events: CoreEvent[]) => { const r = emptyReport(); foldRows(r, rowsOf(events)); r.loaded = true; return r; };
const scope = (phase: PhaseScope['phase'], label: string, ords: number[]): PhaseScope => ({ phase, label, ords });

describe('3. the Plan (architecture) step has its own phase report', () => {
  const units = (s: Record<number, string>) => [
    { id: 'r1:pa-scope', ord: 1, status: s[1] ?? 'done', stage: 'pa-scope' },
    { id: 'r1:architecture', ord: 2, status: s[2] ?? 'executing', stage: 'architecture' },
    { id: 'r1:fix', ord: 3, status: s[3] ?? 'planned', stage: 'build' },
    { id: 'r1:review', ord: 4, status: s[4] ?? 'planned', stage: 'review' },
    { id: 'r1:deliver', ord: 5, status: s[5] ?? 'planned', stage: 'deliver' },
  ];
  it('Intake, Plan, Build, Checks, Review, Deliver; while the plan runs (no turn yet) the Plan is current, never Review', () => {
    const p = state({ orchestrator: { cli: 'claude', ord: null, turns: 0, inTurn: false, sessionRestarts: 0 } as never });
    const ph = powerPhases(units({}), p, [], false);
    // The build's blocks wait for its first turn; its unit still keeps Review from reading as current.
    expect(ph.map((x) => `${x.key}:${x.ords.join(',')}`)).toEqual(['intake:1', 'plan:2', 'review:4', 'deliver:5']);
    expect(ph.find((x) => x.current)?.key).toBe('plan');
    expect(powerPhases(units({ 2: 'done' }), p, [], false).find((x) => x.current)).toBeUndefined();
    const building = powerPhases(units({ 2: 'done' }), state(), [], false);
    expect(building.map((x) => x.key)).toEqual(['intake', 'plan', 'build', 'checks', 'review', 'deliver']);
    expect(building.find((x) => x.current)?.key).toBe('build');
  });
  it('its block reads as its own step', () => {
    const r = report(ev([
      { type: 'unitDistributed', ord: 2, cli: 'claude', ts: T0 },
      { type: 'unitExecuting', ord: 2, ts: T0 + MIN },
    ]));
    expect(phaseSummary(r, scope('plan', 'Plan', [2]))).toMatch(/^Plan · Claude Code · running · since \d\d:\d\d$/u);
    expect(phaseDashboard(r, scope('plan', 'Plan', [2]), T0 + 2 * MIN).now.value).toBe('Plan · running');
  });
});

describe('4. the Checks block resolves from the floor result', () => {
  const floor1 = ev([
    { type: 'unitExecuting', ord: 3, ts: T0 - 3 * MIN },
    { type: 'powerTurnStarted', ord: 3, attempt: 0, turn: 1, cli: 'claude', ts: T0 - 3 * MIN },
    { type: 'powerTurnCompleted', ord: 3, attempt: 0, turn: 1, outcome: 'handoff', ts: T0 },
    { type: 'repoChecksEvaluated', ord: 3, attempt: 0, passed: false, outcome: 'failed', ts: T0 + 35 * MIN, checks: [
      { name: 'install', exitCode: 0, timedOut: false, durationMs: 40_000 }, { name: 'typecheck', exitCode: 0, timedOut: false, durationMs: 30_000 },
      { name: 'lint', exitCode: 0, timedOut: false, durationMs: 20_000 }, { name: 'test', exitCode: 1, timedOut: false, durationMs: 29 * MIN },
    ] },
    { type: 'unitDenied', ord: 3, ts: T0 + 35 * MIN },
    { type: 'unitExecuting', ord: 3, ts: T0 + 35 * MIN + 1000 },
    { type: 'powerTurnStarted', ord: 3, attempt: 1, turn: 1, cli: 'claude', ts: T0 + 35 * MIN + 1000 },
  ]);
  const checks = scope('checks', 'Checks', [3]);
  it('after floor 1 failed and the retry turn runs, Checks says failed, not running', () => {
    const r = report(floor1);
    expect(phaseDashboard(r, checks, T0 + 36 * MIN).now.value).toBe('Checks · failed');
  });
  it('a failed floor the hand-off then passed (a person approved it at its gate) says so', () => {
    const r = report([...floor1.slice(0, 5), ...ev([
      { type: 'powerHandoffStepped', round: 1, maxRounds: 3, step: { at: T0 + 40 * MIN, ord: 3, round: 1, seat: 'claude', status: 'passed', step: 'checks', summary: null }, ts: T0 + 40 * MIN },
    ])]);
    expect(phaseDashboard(r, checks, T0 + 41 * MIN).now.value).toBe('Checks · failed · overridden');
  });
  it('while a floor runs with no result yet it is running; a passed floor says passed', () => {
    const running = report(floor1.slice(0, 3));
    expect(phaseDashboard(running, checks, T0 + 5 * MIN).now.value).toBe('Checks · running');
    const passed = report([...floor1.slice(0, 3), ...ev([{ type: 'repoChecksEvaluated', ord: 3, attempt: 0, passed: true, outcome: 'passed', ts: T0 + 20 * MIN, checks: [] }])]);
    expect(phaseDashboard(passed, checks, T0 + 21 * MIN).now.value).toBe('Checks · passed');
  });
});

describe('6. working document lines', () => {
  it('an answered question leaves Open questions: a resume at another unit answers the gate (ea73afc0 ord 4 → ord 3)', () => {
    const r = report(ev([
      { type: 'unitExecuting', ord: 4, ts: T0 },
      { type: 'awaitingHuman', ord: 4, gateKind: 'escalation', ts: T0 + 1000 },
      { type: 'resumed', ord: 3, ts: T0 + 1100 },
      { type: 'unitExecuting', ord: 3, ts: T0 + 1400 },
    ]));
    expect(docLines(r).questions).toEqual([]);
    expect(docLines(r).decisions).toHaveLength(1);
  });
  it('an open gate is still an open question', () => {
    const r = report(ev([{ type: 'unitExecuting', ord: 4, ts: T0 }, { type: 'awaitingHuman', ord: 4, gateKind: 'escalation', ts: T0 + 1000 }]));
    expect(docLines(r).questions).toHaveLength(1);
  });
  it('when crew writes the lines itself (eventLines), the plugin writes none', () => {
    expect(pluginWritesLines({ eventLines: true })).toBe(false);
    expect(pluginWritesLines({})).toBe(true);
    expect(pluginWritesLines(null)).toBe(true);
  });
});
