/**
 * Power mode in the run header and thread (DES-POWER-MODE; mockup design/mockups/power-mode.html): the pure words —
 * the switch's flip rules, the rigor chip, the timeline (intake, turns, activity, checkpoints, rigor marks, hand-off),
 * the hand-off rows and the merge of late frames into the session's state.
 */
import { describe, expect, it } from 'vitest';
import { powerOf } from '../src/api/power.js';
import type { CoreEvent } from '../src/api/types.js';
import { checkpointWords, handoffRow, handoffWords, higherRigors, mergePower, pauseOrder, powerSwitch, powerTimeline, raiseConsequence, rigorChip, rigorMarkWords } from '../src/board/powerMode.js';
import { at, buildEvents, change, plan, state, step } from './powerFixtures.js';

const clock = (ms: number): string => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const events = (x: Array<Record<string, unknown>>): CoreEvent[] => x as unknown as CoreEvent[];

describe('the switch (DES-POWER-MODE §2)', () => {
  it('phased required: Off and disabled, the reason in its tooltip', () => {
    const sw = powerSwitch(state({ on: false, available: false, refusedReason: 'regulated repo' }), 'executing');
    expect(sw).toMatchObject({ checked: false, disabled: 'Phased is required: regulated repo' });
  });
  it('On -> Off is always allowed and says the rest goes phased', () => {
    const sw = powerSwitch(state(), 'executing');
    expect(sw.checked).toBe(true);
    expect(sw.disabled).toBeNull();
    expect(sw.title).toMatch(/rest of the work goes phased/);
  });
  it('Off -> On names the phases the plan keeps phased', () => {
    const sw = powerSwitch(state({ on: false, plan: plan({ mandatoryPhases: [{ phase: 'design', why: 'policy' }] }) }), 'executing');
    expect(sw.disabled).toBeNull();
    expect(sw.title).toBe('Power mode for the rest. Design stays phased (required by the plan).');
  });
  it('an ended job cannot be switched', () => {
    expect(powerSwitch(state(), 'completed').disabled).toMatch(/has ended/);
  });
});

describe('rigor words', () => {
  it('the chip says the rigor, ↑ when it rose after intake, and since when and why', () => {
    const chip = rigorChip(state(), clock)!;
    expect(chip).toMatchObject({ rigor: 'high', raised: true });
    expect(chip.title).toBe(`Rigor high since ${clock(at(17))}: sign-in module touched. Hand-off: the full suite, a different reviewer, QE acceptance and a design check.`);
    expect(rigorChip(state({ rigor: 'standard', history: state().history.slice(0, 2) }), clock)!.raised).toBe(false);
  });
  it('what hand-off applies, from the plan when it is the plan\'s rigor', () => {
    expect(handoffWords('standard', plan())).toBe('targeted tests, a different reviewer and QE acceptance at hand-off');
    expect(handoffWords('highest')).toMatch(/security review/);
  });
  it('what a raise changes, and the rigors a raise can go to (never down)', () => {
    expect(raiseConsequence('standard', 'high')).toBe('hand-off now runs the full suite');
    expect(raiseConsequence('high', 'standard')).toBeNull();
    expect(higherRigors('high')).toEqual(['highest']);
    expect(higherRigors('highest')).toEqual([]);
  });
  it('the rigor mark: up with its reason and consequence; down is said as from evidence', () => {
    expect(rigorMarkWords(change(3, 17, 'commit', 'standard', 'high', 34, 58, 2, ['sign-in module touched']))).toEqual({ head: 'Rigor ↑ standard → high', tail: 'sign-in module touched — hand-off now runs the full suite' });
    expect(rigorMarkWords(change(4, 20, 'operator', 'high', 'highest', 34, 34, null, []))).toEqual({ head: 'Rigor ↑ high → highest', tail: 'you raised it — hand-off adds a security review on its own seat' });
    expect(rigorMarkWords(change(5, 30, 'pre_handoff', 'high', 'standard', 58, 30, 3, ['2 files, no sensitive area'])).tail).toBe('lowered from evidence: 2 files, no sensitive area');
  });
});

describe('the timeline', () => {
  const items = powerTimeline(events(buildEvents()), state());
  it('reads in order: the intake card, the turn, activity, checkpoint 1 (stays), activity, checkpoint 2 (your note), the rigor mark', () => {
    expect(items.map((i) => i.kind)).toEqual(['intake', 'turn', 'acts', 'checkpoint', 'acts', 'checkpoint', 'rigor']);
  });
  it('the checkpoint markers say what the mockup says', () => {
    const cps = items.filter((i) => i.kind === 'checkpoint').map((i) => (i as { words: string }).words);
    expect(cps).toEqual(['Checkpoint 1 · commit 1 · rigor stays standard (score 34 → 36)', 'Checkpoint 2 · commit 2 · picked up your note']);
  });
  it('the activity rows: an edit with its diffstat, a test run with its count, a commit with its short sha and subject', () => {
    const acts = items.find((i) => i.kind === 'acts') as unknown as { rows: Array<Record<string, unknown>> };
    expect(acts.rows).toEqual([
      expect.objectContaining({ lead: 'Edited', code: 'src/lib/money.ts', added: 31, removed: 6 }),
      expect.objectContaining({ lead: 'Tests passed', code: 'npm test -- money', tail: '14 passed', tone: 'pass' }),
      expect.objectContaining({ lead: 'Commit 1', sha: 'a41c9e2', tail: "Format invoice amounts in the account's currency", tone: 'commit' }),
    ]);
  });
  it('the intake rescore never makes a mark; a same-rigor checkpoint folds into its marker', () => {
    expect(items.filter((i) => i.kind === 'rigor')).toHaveLength(1);
  });
  it('a hand-off round is one card, each step as it stands now, in hand-off order', () => {
    const h = powerTimeline(events(buildEvents(true)), state()).find((i) => i.kind === 'handoff') as { steps: Array<{ step: string; status: string }> };
    expect(h.steps.map((s) => `${s.step}:${s.status}`)).toEqual(['checks:passed', 'review:passed', 'qe:running', 'compliance:pending']);
  });
  it('with no frames, the session state still gives the intake card and the hand-off', () => {
    const t = powerTimeline([], state({ handoff: { round: 1, maxRounds: 3, steps: [step('checks', 'passed', null, null, 30)] } }));
    expect(t.map((i) => i.kind)).toEqual(['intake', 'handoff']);
  });
  it('a test run that failed is said as failed', () => {
    expect(checkpointWords({ type: 'powerCheckpointReached', session: 'r', ord: 1, checkpoint: 3, turn: 3, trigger: 'turn', head: null, picked: 0, rigor: 'highest', paused: true }, null, 0))
      .toBe('Checkpoint 3 · end of turn 3 · rigor stays highest · paused for your decision');
    const t = powerTimeline(events([{ type: 'powerActivity', session: 'r', ord: 1, turn: 3, at: at(22), kind: 'test', command: 'npm test -- jpy', passed: 11, failed: 1 }]), null);
    expect((t[0] as unknown as { rows: Array<Record<string, unknown>> }).rows[0]).toMatchObject({ lead: 'Tests failed', tail: '1 failed, 11 passed', tone: 'fail' });
  });
});

describe('hand-off rows', () => {
  const name = (cli: string): string => ({ codex: 'Codex', pi: 'Pi CLI' } as Record<string, string>)[cli] ?? cli;
  it('checks, the distinct reviewer, QE and compliance, each with its status', () => {
    expect(handoffRow(step('checks', 'passed', null, '412 tests', 33), 'high', name)).toMatchObject({ who: 'Checks', role: 'full suite, rigor high', result: '✓ Passed', tone: 'pass', initial: null });
    expect(handoffRow(step('review', 'passed', 'codex', null, 31), 'high', name)).toMatchObject({ who: 'Codex', role: 'reviewing on its own seat', result: '✓ Approved', initial: 'C' });
    expect(handoffRow(step('review', 'failed', 'codex', null, 31), 'high', name)).toMatchObject({ result: 'Changes asked', tone: 'fail' });
    expect(handoffRow(step('qe', 'running', 'pi', null, 33), 'high', name)).toMatchObject({ who: 'Pi CLI', result: 'Running', tone: 'run' });
    expect(handoffRow(step('compliance', 'pending', null, null, 33), 'standard', name)).toMatchObject({ who: 'Compliance', result: 'Waiting', tone: 'wait' });
  });
});

describe('the pause dock', () => {
  it('the engine\'s recommendation leads, the rest follow in order', () => {
    expect(pauseOrder('split')).toEqual(['split', 'switch_phased', 'continue_high', 'stop']);
    expect(pauseOrder('continue_high')).toEqual(['continue_high', 'split', 'switch_phased', 'stop']);
  });
});

describe('the state as it stands now', () => {
  it('a newer rescore frame moves the rigor and the history; a flip frame moves the switch', () => {
    const base = state({ rigor: 'standard', history: state().history.slice(0, 2) });
    const merged = mergePower(base, events([
      { type: 'rigorRescored', session: 'r', change: change(3, 17, 'commit', 'standard', 'high', 34, 58, 2) },
      { type: 'powerToggled', session: 'r', toggle: { at: at(20), on: false, by: 'you', reason: null, stayPhased: [] } },
    ]))!;
    expect(merged.rigor).toBe('high');
    expect(merged.history.map((h) => h.seq)).toEqual([1, 2, 3]);
    expect(merged.on).toBe(false);
  });
  it('a frame already in the state changes nothing (the same seq twice)', () => {
    const merged = mergePower(state(), events([{ type: 'rigorRescored', session: 'r', change: change(3, 17, 'commit', 'standard', 'high', 34, 58, 2) }]))!;
    expect(merged.history).toHaveLength(3);
    expect(merged.on).toBe(true);
  });
  it('this page\'s own flip answer wins over an older session read', () => {
    const local = state({ on: false, toggles: [{ at: at(25), on: false, by: 'you', reason: null, stayPhased: [] }] });
    expect(mergePower(state(), [], local)!.on).toBe(false);
  });
  it('a checkpoint frame that opened a pause pauses the run until the next turn starts; this page\'s answer clears it', () => {
    const pz = { at: at(29), checkpoint: 3, reasons: ['grew'], recommended: 'split' as const };
    const cp = { type: 'powerCheckpointReached', session: 'r', ord: 1, checkpoint: 3, turn: 3, trigger: 'turn', head: null, picked: 0, rigor: 'highest', paused: true, pause: pz, ts: at(29) };
    expect(mergePower(state(), events([cp]))!.pause).toEqual(pz);
    expect(mergePower(state(), events([cp, { type: 'powerTurnStarted', session: 'r', ord: 1, attempt: 0, turn: 4, cli: 'claude' }]))!.pause).toBeNull();
    const answered = state({ pause: null, history: [...state().history, change(4, 30, 'operator', 'high', 'highest', 34, 34, null)] });
    expect(mergePower(state({ pause: pz }), events([cp]), answered)!.pause).toBeNull();
  });
  it('the turn log gives the orchestrator\'s words when the trail has no turn frames', () => {
    const t = powerTimeline([], state({ turnLog: [{ turn: 1, attempt: 0, cli: 'claude', startedAt: at(1), endedAt: at(2), outcome: 'checkpoint', summary: 'Found it.' }] }));
    expect(t.map((i) => i.kind)).toEqual(['intake', 'turn']);
  });
  it('powerOf reads AgentSession.power, and nothing from a run without it', () => {
    expect(powerOf({ id: 'r' })).toBeNull();
    expect(powerOf({ power: null })).toBeNull();
    expect(powerOf({ power: { on: true } })).toBeNull();
    expect(powerOf({ power: state() })!.rigor).toBe('high');
  });
});
