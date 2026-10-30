/** Cross-model review of studio#933 (codex 4xP2, agy 2xP1 + 4xP2 + P3): one test per finding. */
import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import type { HandoffStep } from '../src/api/power.js';
import { approvedLine } from '../src/board/failingChecks.js';
import { isPowerPaused } from '../src/board/heldRuns.js';
import { changeReason, mergePower, rigorAt, rigorMarkWords, settleHandoff } from '../src/board/powerMode.js';
import { evaluatorFace } from '../src/board/runConversation.js';
import { POWER_CHANGED, rememberPower } from '../src/hooks/usePower.js';
import { at, change, state, step } from './powerFixtures.js';

const ev = (x: Array<Record<string, unknown>>): CoreEvent[] => x as unknown as CoreEvent[];
const pz = (min: number) => ({ at: at(min), checkpoint: 3, reasons: ['grew'], recommended: 'split' as const });
const cpFrame = (min: number) => ({ type: 'powerCheckpointReached', session: 'r', ord: 1, checkpoint: 3, turn: 3, trigger: 'turn', head: null, picked: 0, rigor: 'high', paused: true, pause: pz(min), ts: at(min) });

describe('mergePower and the pause', () => {
  it('a pause in the recorded trail that the state already answered never comes back (reload, another tab)', () => {
    const answered = state({ pause: null, history: [...state().history, change(4, 31, 'operator', 'high', 'highest', 34, 34, null)] });
    expect(mergePower(answered, ev([cpFrame(29)]))!.pause).toBeNull();
  });
  it('a pause newer than the state shows (it came live before the run list did)', () => {
    expect(mergePower(state(), ev([cpFrame(29)]))!.pause).toEqual(pz(29));
  });
  it('this page\'s earlier answer never hides a later pause (codex P2, agy P1.4)', () => {
    const local = state({ on: true, toggles: [{ at: at(20), on: true, by: 'you', reason: null, stayPhased: [] }] });
    expect(mergePower(state(), ev([cpFrame(29)]), local, at(20))!.pause).toEqual(pz(29));
    expect(mergePower(state(), ev([cpFrame(29)]), local, at(30))!.pause).toBeNull();
  });
  it('the hand-off step that ends a pause is still folded (agy P1.1)', () => {
    const merged = mergePower(state(), ev([cpFrame(29), { type: 'powerHandoffStepped', session: 'r', round: 1, step: step('checks', 'passed', null, null, 33), ts: at(33) }]))!;
    expect(merged.pause).toBeNull();
    expect(merged.handoff!.steps.map((s) => `${s.step}:${s.status}`)).toEqual(['checks:passed']);
  });
  it('switching to phased ends the pause (agy P1.2)', () => {
    const merged = mergePower(state(), ev([cpFrame(29), { type: 'powerToggled', session: 'r', toggle: { at: at(30), on: false, by: 'you', reason: null, stayPhased: [] }, ts: at(30) }]))!;
    expect(merged.on).toBe(false);
    expect(merged.pause).toBeNull();
  });
  it('an older replayed hand-off frame never overwrites a newer result the state holds (codex P2, agy P1.5)', () => {
    const s = state({ handoff: { round: 1, maxRounds: 3, steps: [step('checks', 'passed', null, '412 tests', 40)] } });
    const merged = mergePower(s, ev([{ type: 'powerHandoffStepped', session: 'r', round: 1, step: step('checks', 'running', null, null, 30), ts: at(30) }]))!;
    expect(merged.handoff!.steps).toEqual([step('checks', 'passed', null, '412 tests', 40)]);
  });
});

describe('the pause holds a run only in power mode, and the run list is re-read after an answer', () => {
  it('isPowerPaused needs power on', () => {
    expect(isPowerPaused({ id: 'r', status: 'executing', power: { on: true, pause: pz(1) } } as never)).toBe(true);
    expect(isPowerPaused({ id: 'r', status: 'executing', power: { on: false, pause: pz(1) } } as never)).toBe(false);
  });
  it('rememberPower announces the change (App re-reads the run list on it)', () => {
    let heard = 0;
    const on = (): void => { heard += 1; };
    window.addEventListener(POWER_CHANGED, on);
    rememberPower('r', state());
    window.removeEventListener(POWER_CHANGED, on);
    expect(heard).toBe(1);
  });
});

describe('the approved floor, test by test (codex P2) and in grammar (agy P2)', () => {
  it('"on the base too" only of the failures shown on the base', () => {
    expect(approvedLine({ checks: ['test'], onBase: false, failures: 2, fresh: 1, shared: 1 })).toBe('You approved 2 failing tests in the test check: 1 fails only with this change, 1 on the base too.');
    expect(approvedLine({ checks: ['test'], onBase: true, failures: 2, fresh: 0, shared: 2 })).toBe('You approved 2 failing tests in the test check; they fail on the base too.');
    expect(approvedLine({ checks: ['lint'], onBase: true, failures: 0 })).toBe('You approved the lint check, which did not pass; it fails on the base too.');
  });
});

describe('hand-off steps that never got their final record', () => {
  it('a step with no ord reads its unit by kind; a completed run went through its checks; an older round is over', () => {
    const stuck: HandoffStep[] = [{ ...step('review', 'running', 'codex', null, 30), ord: null }, { ...step('checks', 'running', null, null, 30), ord: null }];
    const byKind = (_ord: number | null, kind: HandoffStep['step']): string | undefined => (kind === 'review' ? 'done' : undefined);
    expect(settleHandoff(stuck, byKind, true, true).map((s) => `${s.step}:${s.status}`)).toEqual(['checks:passed', 'review:passed']);
    expect(settleHandoff(stuck, () => undefined, true, false).map((s) => s.status)).toEqual(['skipped', 'skipped']);
  });
});

describe('rigor words', () => {
  it('boilerplate reasons say nothing more than who (agy P2): no "raised by you, Raised by you…", no "local"', () => {
    expect(changeReason({ reasons: ['Raised by you from the job page'] })).toBeNull();
    expect(changeReason({ reasons: ['raised by local'] })).toBeNull();
    expect(changeReason({ reasons: ['raised by local: continue at high rigor after a checkpoint pause'] })).toBe('continue at high rigor after a checkpoint pause');
    const w = rigorMarkWords({ ...change(5, 20, 'operator', 'standard', 'high', 34, 34, null, ['Raised by you from the job page']), by: 'local' });
    expect(w.tail).toBe('you raised it — hand-off now runs the full suite');
  });
  it('rigorAt falls back to the state\'s rigor with no history, and breaks equal times by seq (agy P3)', () => {
    expect(rigorAt(state({ history: [], rigor: 'high' }), at(10))).toBe('high');
    const same = state({ history: [change(2, 10, 'commit', 'standard', 'high', 34, 58, 1), change(3, 10, 'operator', 'high', 'highest', 34, 34, null)] });
    expect(rigorAt(same, at(10))).toBe('highest');
  });
});

describe('the evaluator face (agy P2)', () => {
  it('reads a sentence beside a machine line, keeps the period after a path, and leads with a FAIL verdict', () => {
    expect(evaluatorFace('VERDICT: PASS\nAll 7 checks passed.', 'QE')!.sentence).toBe('All 7 checks passed.');
    expect(evaluatorFace('Wrote /tmp/run/out.json. Two notes follow.\n\nVERDICT: PASS', 'QE')!.sentence).toBe('Wrote.');
    expect(evaluatorFace('Looked.\nITEM 1: PASS\nITEM 2: PASS\nVERDICT: FAIL', 'Review')).toMatchObject({ verdictLine: 'Review did not pass (2 of 2 items passed)', tone: 'fail' });
    expect(evaluatorFace('Summary line without a stop\nITEM 1: PASS\nVERDICT: PASS', 'QE')!.sentence).toBe('Summary line without a stop');
  });
});
