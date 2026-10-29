/**
 * The operator's look at a real power run on the rig (bc2366e1, delivered as core#1180), 2026-10-29: the hand-off card,
 * the rigor marker, the final message and the Phase report rows. Shapes copied from that run's GET /runs/:id.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as client from '../src/api/client.js';
import type { HandoffStep, PowerState, RigorChange } from '../src/api/power.js';
import { teamPlanApi } from '../src/api/teamPlan.js';
import type { WorkUnit } from '../src/api/types.js';
import { approvedLine } from '../src/board/failingChecks.js';
import { changeReason, rigorAt, rigorMarkWords, settleHandoff } from '../src/board/powerMode.js';
import { finalWords } from '../src/board/runConversation.js';
import { RunBlock, resetStepOutputs } from '../src/components/session/RunConversation.js';
import { resetRunCoverage } from '../src/hooks/useRunCoverage.js';
import { useCapabilities } from '../src/store/capabilities.js';
import { useRunEventStore } from '../src/store/events.js';
import { useGateStore } from '../src/store/gates.js';
import { useRunPluginView } from '../src/store/runPluginView.js';
import { makeUnit, makeView } from './factories.js';
import { plan } from './powerFixtures.js';

const RUN = 'r-real';
const T = (h: number, m: number): number => new Date(2026, 9, 29, h, m, 0).getTime();
const chg = (seq: number, at: number, trigger: RigorChange['trigger'], from: 'standard' | 'high', to: 'standard' | 'high', by: string, reasons: string[], checkpoint: number | null, paused = false): RigorChange =>
  ({ seq, at, trigger, from, to, direction: from === to ? 'same' : 'up', planned: 30, actual: 30, delta: 0, reasons, signals: null, by, floors: [], checkpoint, turn: null, paused });
const HISTORY = [
  chg(1, T(13, 27), 'intake', 'standard', 'standard', 'engine', ['reach 20'], null),
  chg(2, T(13, 37), 'pre_handoff', 'standard', 'standard', 'engine', ['reach 20'], 1),
  chg(3, T(14, 48), 'pre_handoff', 'standard', 'standard', 'engine', ['reach 20'], 2, true),
  chg(4, T(14, 53), 'operator', 'standard', 'high', 'local', ['raised by local: continue at high rigor after a checkpoint pause'], null),
];
const st = (step: HandoffStep['step'], status: HandoffStep['status'], seat: string | null, ord: number, at: number, summary: string | null = null): HandoffStep => ({ step, ord, round: 1, status, seat, summary, at });
const STEPS = [
  st('rescore', 'passed', null, 2, T(13, 37), 'rigor standard at hand-off'), st('rescore', 'passed', null, 2, T(14, 48), 'rigor standard at hand-off'),
  st('checks', 'passed', 'claude', 2, T(14, 56)), st('review', 'running', 'codex', 3, T(14, 56)), st('review', 'passed', 'codex', 3, T(15, 2)),
  st('qe', 'running', 'codex', 4, T(15, 2)), st('qe', 'passed', 'codex', 4, T(15, 25)),
];
const POWER: PowerState = {
  on: true, available: true, refusedReason: null, rigor: 'high', plan: plan({ score: 30, at: T(13, 27) }), history: HISTORY, toggles: [],
  orchestrator: { cli: 'claude', ord: 2, turns: 1, inTurn: false, sessionRestarts: 0 }, checkpoints: 2,
  handoff: { round: 1, maxRounds: 3, steps: STEPS }, pause: null, outcome: null,
};
const unit = (key: string, ord: number, status: string, cli: string | null, stage = 'build'): WorkUnit =>
  makeUnit({ id: `${RUN}:${key}`, session_id: RUN, ord, status, assigned_cli: cli, stage, description: key } as never);
const UNITS = [unit('pa-scope', 1, 'done', 'claude', 'scope'), unit('fix', 2, 'done', 'claude'), unit('review', 3, 'done', 'codex', 'review'), unit('verify', 4, 'done', 'codex', 'test'), unit('deliver', 5, 'done', 'bash')];
const EVENTS = [
  { type: 'powerIntakePlanned', session: RUN, ord: 1, ts: T(13, 27), seq: 40, plan: plan({ score: 30, at: T(13, 27) }) },
  { type: 'powerCheckpointReached', session: RUN, ord: 2, checkpoint: 1, turn: 1, trigger: 'pre_handoff', head: 'c0f9396', picked: 0, rigor: 'standard', paused: false, ts: T(13, 37), seq: 57 },
  { type: 'powerCheckpointReached', session: RUN, ord: 2, checkpoint: 2, turn: 1, trigger: 'pre_handoff', head: 'c0f9396', picked: 0, rigor: 'standard', paused: true, ts: T(14, 48), seq: 107 },
  { type: 'rigorRescored', session: RUN, change: HISTORY[3], ts: T(14, 53), seq: 115 },
];

describe('the real run, as words', () => {
  it('each hand-off step reads its newest record, and a finished unit or an ended run never reads Running', () => {
    const settled = settleHandoff(STEPS, () => undefined, true);
    expect(settled.map((s) => `${s.step}:${s.status}`)).toEqual(['rescore:passed', 'checks:passed', 'review:passed', 'qe:passed']);
    const stuck = [st('review', 'running', 'codex', 3, T(14, 56)), st('qe', 'running', 'codex', 4, T(15, 2)), st('compliance', 'pending', null, 9, T(15, 2))];
    const unitsDone = (ord: number): string | undefined => ({ 3: 'done', 4: 'rejected' } as Record<number, string>)[ord];
    expect(settleHandoff(stuck, unitsDone, true).map((s) => `${s.step}:${s.status}`)).toEqual(['review:passed', 'qe:failed', 'compliance:skipped']);
    expect(settleHandoff(stuck, () => 'executing', false).map((s) => s.status)).toEqual(['running', 'running', 'pending']);
  });
  it('the rigor that applied at hand-off is the one in effect when its checks ran (after the raise)', () => {
    expect(rigorAt(POWER, T(14, 56))).toBe('high');
    expect(rigorAt(POWER, T(14, 50))).toBe('standard');
  });
  it('the rigor marker says what you chose, never the actor id, and hand-off in the past once it ran', () => {
    expect(changeReason(HISTORY[3]!)).toBe('continue at high rigor after a checkpoint pause');
    const w = rigorMarkWords(HISTORY[3]!, { pausedCheckpoint: 2, handoffRan: true });
    expect(`${w.head} · ${w.tail}`).toBe('Rigor ↑ standard → high · you chose ‘continue at high rigor’ at checkpoint 2 — hand-off ran the full suite');
    expect(`${w.head} · ${w.tail}`).not.toMatch(/local/);
  });
  it('the final message for an approved floor: delivered as the PR, then what you approved, plainly', () => {
    expect(approvedLine({ checks: ['test'], onBase: true, failures: 6, unseparated: true })).toBe('You approved 6 failing tests in the test check; the base fails too, so they could not be told apart from this change.');
    expect(approvedLine({ checks: ['test'], onBase: true, failures: 1 })).toBe('You approved 1 failing test in the test check; it fails on the base too.');
    expect(approvedLine({ checks: ['test'], onBase: false, failures: 0 })).toBe('You approved the test check, which did not pass.');
    const view = makeView({ id: RUN, status: 'completed', delivery: { url: 'https://github.com/o/r/pull/1180', state: 'delivered' } } as never, UNITS);
    const words = finalWords(view, { done: 5, total: 5 }, { passed: true, tests: null, nothing: false, reviewers: ['codex'], overridden: 'You approved 6 failing tests in the test check.', deliveryVerified: true } as never);
    expect(words.lead).toBe('Delivered as pull request #1180');
    expect(words.line).toContain('You approved 6 failing tests in the test check.');
    expect(words.line).not.toMatch(/Overridden by you|is open/);
  });
});

describe('the real run, rendered', () => {
  beforeEach(() => {
    resetStepOutputs();
    resetRunCoverage();
    useCapabilities.setState({ loaded: true, powerMode: true });
    useGateStore.setState({ gates: {}, approaching: {} });
    useRunEventStore.setState({ byRun: { [RUN]: EVENTS as never } });
    vi.spyOn(teamPlanApi, 'team').mockResolvedValue({ teamed: false, rows: [], units: [] } as never);
    vi.spyOn(client.api, 'getWatch').mockResolvedValue({ coverage: [] } as never);
    vi.spyOn(client.api, 'getRoster').mockResolvedValue({ roster: [] } as never);
    vi.spyOn(client.api, 'getUnitOutput').mockResolvedValue({ output: 'VERDICT: PASS\n\nok' } as never);
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))));
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); useCapabilities.setState({ powerMode: false }); useRunPluginView.setState({ blocks: {} } as never); });

  it('the hand-off card on the delivered run: no Running rows, one row per step, rigor high at hand-off', async () => {
    render(<RunBlock view={makeView({ id: RUN, problem: 'x', status: 'completed', power: POWER } as never, UNITS)} badge={0} sessionId={`run:${RUN}`} />);
    const card = await screen.findByTestId('power-handoff');
    const rows = within(card).getAllByTestId('power-handoff-row');
    expect(rows.map((r) => r.dataset['step'])).toEqual(['rescore', 'checks', 'review', 'qe']);
    expect(card.textContent).not.toMatch(/Running|Waiting/);
    expect(rows[0]!.textContent).toContain('rigor high at hand-off');
    expect(rows[1]!.textContent).toContain('full suite, rigor high');
    expect(screen.getByTestId('power-rigor-mark').textContent).toContain('you chose ‘continue at high rigor’ at checkpoint 2 — hand-off ran the full suite');
  });

  it('two Phase report update rows next to each other become one', async () => {
    useRunPluginView.setState({ blocks: { [`${RUN}::wicked-phase-report`]: { pinned: false, folded: true, updatedOrds: [3, 4, 5], highlight: 0, pulse: 0, steps: { 3: 'Review', 4: 'Check', 5: 'Deliver' } } } } as never);
    render(<RunBlock view={makeView({ id: RUN, problem: 'x', status: 'completed' } as never, UNITS)} badge={0} sessionId={`run:${RUN}`} />);
    await waitFor(() => expect(screen.getAllByTestId('run-plugin-updated').length).toBeGreaterThan(0));
    expect(screen.getAllByTestId('run-plugin-updated').map((r) => r.dataset['ord'])).toEqual(['3', '5']);
  });
});
