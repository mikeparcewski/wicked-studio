/**
 * One phase report per phase in a power run (operator 2026-10-30): Intake, Build, Checks, each hand-off step that ran
 * and Deliver, each the run-thread plugin's own sandboxed instance (protocol 3, events.batch) scoped to its phase, at
 * the end of the phase's messages, folded to its summary with the current phase open.
 */
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/client.js', () => ({ api: { getRunEvents: vi.fn(async () => ({ events: [] })), listClis: vi.fn(async () => []) } }));

import type { CoreEvent } from '../src/api/types.js';
import { powerPhases } from '../src/board/powerMode.js';
import { PinnedRunPlugins, RunPhasePlugins, blockViewId } from '../src/components/session/RunThreadPlugin.js';
import { toRow, type TopicRow } from '../src/editors/runEvents.js';
import { buildSpans, emptyReport, foldRows, phaseDashboard, phaseSummary, scopeOf, spansWords, writesDoc, type PhaseScope } from '../src/plugins/wicked-phase-report/model.js';
import { useRunPluginView } from '../src/store/runPluginView.js';
import { at, buildEvents, change, state, step } from './powerFixtures.js';

const units = (status: Record<number, string>) => [
  { id: 'r-pm:intake', ord: 0, status: status[0] ?? 'done', stage: 'intake' },
  { id: 'r-pm:build', ord: 1, status: status[1] ?? 'executing', stage: 'build' },
  { id: 'r-pm:review', ord: 2, status: status[2] ?? 'planned', stage: 'review' },
  { id: 'r-pm:verify', ord: 3, status: status[3] ?? 'planned', stage: 'verify' },
  { id: 'r-pm:deliver', ord: 4, status: status[4] ?? 'planned', stage: 'deliver' },
];
const events = buildEvents(true) as unknown as CoreEvent[];

describe('a power run’s phases', () => {
  it('are Intake, Build, Checks, each hand-off step that runs, then Deliver, each with its units', () => {
    const ph = powerPhases(units({}), state(), events, false);
    expect(ph.map((p) => `${p.key}:${p.ords.join(',')}`)).toEqual(['intake:0', 'build:1', 'checks:1', 'review:2', 'qe:3', 'deliver:4']);
    expect(ph.map((p) => p.label)).toEqual(['Intake', 'Build', 'Checks', 'Review', 'QE', 'Deliver']);
  });
  it('the current one: the build while it runs, the first hand-off step not passed, the last once the run ended', () => {
    expect(powerPhases(units({}), state(), events, false).filter((p) => p.current).map((p) => p.key)).toEqual(['build']);
    const handoff = state({ handoff: { round: 1, maxRounds: 2, steps: [step('checks', 'passed', null, null, 33), step('review', 'running', 'codex', null, 34)] } });
    expect(powerPhases(units({ 1: 'done' }), handoff, events, false).find((p) => p.current)?.key).toBe('review');
    const checks = state({ handoff: { round: 1, maxRounds: 2, steps: [step('checks', 'running', null, null, 33)] } });
    expect(powerPhases(units({ 1: 'done' }), checks, events, false).find((p) => p.current)?.key).toBe('checks');
    expect(powerPhases(units({ 1: 'done', 2: 'done', 3: 'done', 4: 'done' }), handoff, events, true).find((p) => p.current)?.key).toBe('deliver');
  });
  it('a security step only when the run has one', () => {
    const withSec = [...units({}), { id: 'r-pm:security_review', ord: 5, status: 'planned', stage: 'security_review' }];
    expect(powerPhases(withSec, state(), events, false).map((p) => p.key)).toContain('security');
    expect(powerPhases(units({}), state(), events, false).map((p) => p.key)).not.toContain('security');
  });
});

describe('the plugin, scoped to a phase', () => {
  const rows = (): TopicRow[] => (buildEvents(true) as unknown as CoreEvent[])
    .map((e, i) => toRow(e, 'r-pm', at(0), `s${i}`, (cli) => ({ claude: 'Claude Code', codex: 'Codex', pi: 'Pi CLI' } as Record<string, string>)[cli] ?? null))
    .filter((r): r is TopicRow => r !== null);
  const report = () => { const r = emptyReport(); foldRows(r, rows()); r.loaded = true; return r; };
  const scope = (phase: PhaseScope['phase'], label: string, ords: number[]): PhaseScope => ({ phase, label, ords });

  it('reads its scope from host.hello, and refuses a malformed one (whole run)', () => {
    expect(scopeOf({ phase: 'build', label: 'Build', ords: [1, 'x'] })).toEqual({ phase: 'build', label: 'Build', ords: [1] });
    expect(scopeOf({ phase: 'deploy', label: 'x', ords: [] })).toBeNull();
    expect(scopeOf(undefined)).toBeNull();
  });
  it('only the Build instance (or a phased run’s one block) writes and shows the working document', () => {
    expect(writesDoc(null)).toBe(true);
    expect(writesDoc(scope('build', 'Build', [1]))).toBe(true);
    for (const p of ['intake', 'checks', 'review', 'qe', 'deliver'] as const) expect(writesDoc(scope(p, p, [0]))).toBe(false);
  });
  it('folds to its own phase’s line', () => {
    const r = report();
    expect(phaseSummary(r, scope('intake', 'Intake', [0]))).toMatch(/^Intake · rigor standard \(score 34\)( · \d\d:\d\d–\d\d:\d\d)?$/u);
    expect(phaseSummary(r, scope('build', 'Build', [1]))).toMatch(/^Build · 1 turn · checkpoint 2 · rigor high ↑/u);
    expect(phaseSummary(r, scope('review', 'Review', [2]))).toMatch(/^Review · Codex · approved/u);
    expect(phaseSummary(r, scope('qe', 'QE', [3]))).toMatch(/^QE · Pi CLI · running/u);
  });
  it('draws only its phase’s tiles', () => {
    const r = report();
    expect(phaseDashboard(r, scope('intake', 'Intake', [0]), at(40)).tiles).toEqual(['now', 'rigor']);
    expect(phaseDashboard(r, scope('checks', 'Checks', [1]), at(40)).tiles).toEqual(['now', 'checks']);
    const review = phaseDashboard(r, scope('review', 'Review', [2]), at(40));
    expect(review.tiles).toEqual(['now', 'helpers', 'decisions']);
    expect(review.now.value).toBe('Review · approved');
    // With no unit rows yet, the hand-off record names the seat and the time.
    expect(review.helpers).toEqual([{ name: 'Codex', steps: 'Review' }]);
    expect(review.now.sub).toMatch(/^Codex · at \d\d:\d\d$/u);
    expect(review.handoff).toBeNull();
    // The build is the orchestrator's turns: its Now says the turn, never "not started".
    const build = phaseDashboard(r, scope('build', 'Build', [1]), at(40));
    expect(build.now.value).toBe('Build · handed off');
    // Its own time: from the first turn to the hand-off (not the unit's whole span).
    expect(build.now.sub).toMatch(/^\d\d:\d\d–\d\d:\d\d · 26 min$/u);
  });
});

describe('Build and Checks share one unit: each phase’s time comes from its own events (bc2366e1)', () => {
  // The real run's shape: turn 1 hands off at 13:37, the floor fails at 14:45, a fix turn pauses at checkpoint 2, you
  // answer at 14:53 (continue at high rigor), the retry floor waits on you at 14:54, you approve at 14:56 and the
  // hand-off's checks pass.
  const clockAt = (h: number, m: number, sec = 0): number => new Date(2026, 9, 29, h, m, sec).getTime();
  const e = (type: string, ts: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ type, session: 'bc', ts, ...extra });
  const events = [
    e('unitDispatched', clockAt(13, 27, 56), { ord: 2, attempt: 0 }), e('unitExecuting', clockAt(13, 27, 56), { ord: 2 }),
    e('powerTurnStarted', clockAt(13, 27, 56), { ord: 2, turn: 1, cli: 'claude' }),
    e('powerCheckpointReached', clockAt(13, 37, 25), { ord: 2, checkpoint: 1, turn: 1, trigger: 'commit', picked: 0, rigor: 'standard', paused: false }),
    e('powerTurnCompleted', clockAt(13, 37, 25), { ord: 2, turn: 1, cli: 'claude', outcome: 'handoff' }),
    e('repoChecksEvaluated', clockAt(14, 45, 46), { ord: 2, attempt: 0, passed: false, outcome: 'failed', floor: 'creator', checks: [] }),
    e('resumed', clockAt(14, 45, 47), { ord: 2 }),
    e('powerTurnStarted', clockAt(14, 45, 48), { ord: 2, turn: 1, cli: 'claude' }),
    e('powerCheckpointReached', clockAt(14, 48, 49), { ord: 2, checkpoint: 2, turn: 1, trigger: 'turn', picked: 0, rigor: 'standard', paused: true, pause: { reasons: ['struggling: 80 min against an estimate of 20 min'] } }),
    e('powerTurnCompleted', clockAt(14, 48, 49), { ord: 2, turn: 1, cli: 'claude', outcome: 'paused' }),
    e('rigorRescored', clockAt(14, 53, 38), { change: { ...change(4, 0, 'operator', 'standard', 'high', 30, 60, 2, ['continue at high rigor']), at: clockAt(14, 53, 38), by: 'local' } }),
    e('awaitingHuman', clockAt(14, 54, 48), { ord: 2, gateKind: 'escalation' }),
    e('resumed', clockAt(14, 56, 9), { ord: 2 }), e('unitDone', clockAt(14, 56, 9), { ord: 2 }),
    e('powerHandoffStepped', clockAt(14, 56, 14), { round: 1, step: { step: 'checks', ord: 2, status: 'passed', seat: 'claude', summary: null, at: clockAt(14, 56, 14) } }),
    e('powerHandoffStepped', clockAt(14, 56, 14), { round: 1, step: { step: 'review', ord: 3, status: 'running', seat: 'codex', summary: null, at: clockAt(14, 56, 14) } }),
  ];
  const r = emptyReport();
  foldRows(r, (events as unknown as CoreEvent[]).map((x, i) => toRow(x, 'bc', 0, `s${i}`, () => null)).filter((x): x is TopicRow => x !== null));
  r.loaded = true;

  it('Build is the turns, the pause up to your answer included; Checks is each floor to its result, the retry too', () => {
    const sp = buildSpans(r, 2);
    expect(spansWords(sp.build)).toBe('13:27–13:37 + 14:45–14:53');
    expect(spansWords(sp.checks)).toBe('13:37–14:45 + 14:53–14:56');
  });
  it('the blocks say them, never the unit’s whole span twice', () => {
    expect(phaseSummary(r, { phase: 'build', label: 'Build', ords: [2] })).toMatch(/ · 13:27–13:37 \+ 14:45–14:53$/u);
    expect(phaseSummary(r, { phase: 'checks', label: 'Checks', ords: [2] })).toMatch(/ · 13:37–14:45 \+ 14:53–14:56$/u);
    expect(phaseDashboard(r, { phase: 'checks', label: 'Checks', ords: [2] }, clockAt(16, 0)).now.sub).toBe('13:37–14:45 + 14:53–14:56 · 1 h 11 min');
    expect(phaseDashboard(r, { phase: 'build', label: 'Build', ords: [2] }, clockAt(16, 0)).now.sub).toBe('13:27–13:37 + 14:45–14:53 · 17 min');
  });
  it('the floor’s escalation is the Checks’ decision, and Build’s Time and cost is its own turns and its own usage', () => {
    // The whole job: started 13:26, the intake's usage on unit 1, finished 15:26 (2 h). None of that is the Build's.
    const whole = emptyReport();
    const more = [
      ...events,
      e('sessionStarted', clockAt(13, 26, 44)),
      e('cliUsage', clockAt(13, 27, 55), { ord: 1, attempt: 0, costUsd: 0.28, inputTokens: 247018, outputTokens: 3213 }),
      e('cliUsage', clockAt(14, 45, 45), { ord: 2, attempt: 0, costUsd: 0.31, inputTokens: 652811, outputTokens: 5899 }),
      e('cliUsage', clockAt(14, 54, 47), { ord: 2, attempt: 1, costUsd: 0.65, inputTokens: 297335, outputTokens: 1364 }),
      e('sessionCompleted', clockAt(15, 26, 21)),
    ];
    foldRows(whole, (more as unknown as CoreEvent[]).map((x, i) => toRow(x, 'bc', 0, `w${i}`, () => null)).filter((x): x is TopicRow => x !== null));
    whole.loaded = true;
    const build = phaseDashboard(whole, { phase: 'build', label: 'Build', ords: [2] }, clockAt(16, 0));
    const checks = phaseDashboard(whole, { phase: 'checks', label: 'Checks', ords: [2] }, clockAt(16, 0));
    expect(build.decisions.items).toEqual([]);
    expect(build.time).toEqual({ value: '17 min', sub: '≈ $0.96 · 957k tokens' });
    expect(checks.tiles).toContain('decisions');
    expect(checks.decisions.items).toEqual([{ text: 'A failed check or review', when: 'answered 14:56', open: false }]);
    // The spans did not move.
    expect(build.now.sub).toBe('13:27–13:37 + 14:45–14:53 · 17 min');
    expect(checks.now.sub).toBe('13:37–14:45 + 14:53–14:56 · 1 h 11 min');
  });
  it('a build still running has an open span', () => {
    const live = emptyReport();
    foldRows(live, (events.slice(0, 3) as unknown as CoreEvent[]).map((x, i) => toRow(x, 'bc', 0, `l${i}`, () => null)).filter((x): x is TopicRow => x !== null));
    expect(spansWords(buildSpans(live, 2).build)).toBe('since 13:27');
    expect(buildSpans(live, 2).checks).toEqual([]);
  });
});

describe('the phase blocks in the thread', () => {
  beforeEach(() => {
    if (typeof URL.createObjectURL !== 'function') Object.assign(URL, { createObjectURL: () => 'blob:test', revokeObjectURL: () => undefined });
    window.localStorage.clear();
    useRunPluginView.setState({ blocks: {}, phases: {} });
  });
  afterEach(() => { document.body.innerHTML = ''; });

  const phases = powerPhases(units({ 1: 'done', 2: 'executing' }), state({ handoff: { round: 1, maxRounds: 2, steps: [step('checks', 'passed', null, null, 33), step('review', 'running', 'codex', null, 34)] } }), events, false);

  it('one sandboxed plugin frame per phase, each named by its phase; the current phase open, the rest folded', async () => {
    render(<>{phases.map((p) => <RunPhasePlugins key={p.key} runId="r-pm" phase={p} />)}</>);
    await act(async () => { await Promise.resolve(); });
    const blocks = screen.getAllByTestId('run-plugin');
    expect(blocks.map((b) => b.dataset['phase'])).toEqual(['intake', 'build', 'checks', 'review', 'qe', 'deliver']);
    for (const b of blocks) {
      expect(b.dataset['plugin']).toBe('wicked-phase-report');
      expect(b.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-scripts');
    }
    expect(blocks.filter((b) => b.dataset['folded'] === 'false').map((b) => b.dataset['phase'])).toEqual(['review']);
    expect(screen.getAllByTestId('run-plugin-phase').map((x) => x.textContent)).toEqual([' · Intake', ' · Build', ' · Checks', ' · Review', ' · QE', ' · Deliver']);
  });

  it('a pinned phase block moves to the pinned strip with its phase, and is still there after a reload', async () => {
    const review = phases.find((p) => p.key === 'review')!;
    const view = render(<><PinnedRunPlugins runIds={['r-pm']} /><RunPhasePlugins runId="r-pm" phase={review} /></>);
    await act(async () => { await Promise.resolve(); });
    act(() => { screen.getByTestId('run-plugin-pin').click(); });
    expect(screen.getByTestId('run-plugin').dataset['placement']).toBe('pinned');
    expect(screen.getByTestId('run-plugin').dataset['phase']).toBe('review');
    view.unmount();
    // A reload: the store is new, the pin is remembered in this browser.
    useRunPluginView.setState({ blocks: {}, phases: {} });
    render(<><PinnedRunPlugins runIds={['r-pm']} /><RunPhasePlugins runId="r-pm" phase={review} /></>);
    await act(async () => { await Promise.resolve(); });
    const b = screen.getByTestId('run-plugin');
    expect(b.dataset['placement']).toBe('pinned');
    expect(b.dataset['phase']).toBe('review');
    expect(blockViewId('wicked-phase-report', review)).toBe('wicked-phase-report@review');
  });
});
