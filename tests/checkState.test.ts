import { describe, expect, it } from 'vitest';
import type { RunAcceptanceSummary, WalkthroughStepState } from '../src/api/types.js';
import type { ChainModel, ChainStep } from '../src/board/chainModel.js';
import { chainSentence } from '../src/board/chainModel.js';
import { applyCheckState, checkChip, checkedSentence, deliverAcceptance, provedAt, type MomentOf } from '../src/board/checkState.js';
import { momentOfRecording } from '../src/store/recordings.js';
import type { Recording } from '../src/board/walkthroughModel.js';

/**
 * WT-U2: "checked" comes only from the acceptance read's per-step check state; the chips' words; the
 * moment comes from the walkthrough's chapter marks (crew's `atSec` is null on today's wire); the
 * chain sentence once steps carry a check state; the deliver card's line is crew's, with a tone.
 */

function step(id: string, state: ChainStep['state'] = 'done', over: Partial<ChainStep> = {}): ChainStep {
  return { id, catalog: id, block: 'build', label: id[0]!.toUpperCase() + id.slice(1), state, addedBy: 'pa', ...over };
}

function chain(steps: ChainStep[], over: Partial<ChainModel> = {}): ChainModel {
  const live = steps.filter((s) => s.state !== 'struck' && s.state !== 'replaced');
  return {
    source: 'team', steps, proposed: false, transportLine: null,
    done: live.filter((s) => s.state === 'done' || s.state === 'checked').length, total: live.length, checked: null, ...over,
  };
}

/** crew's wire: the chapter keys, no moment (walkthrough-acceptance.ts writes `atSec: null`). */
const wire: WalkthroughStepState[] = [
  { stepId: 'build', checkState: 'checked', provedBy: [{ chapter: '04-pay', atSec: null }, { chapter: '05-receipt', atSec: null }] },
  { stepId: 'test', checkState: 'claimed', provedBy: [] },
];

/** The take's chapter marks: 04-pay starts at 0:30 and failed at 0:41; 05-receipt at 0:48. */
const moments: MomentOf = (chapter, kind) => {
  const at: Record<string, { start: number | null; fail: number | null }> = {
    '04-pay': { start: 30, fail: 41 }, '05-receipt': { start: 48, fail: null }, '01-cart': { start: null, fail: null },
  };
  const c = at[chapter];
  return c === undefined ? null : kind === 'fail' ? (c.fail ?? c.start) : c.start;
};

describe('applyCheckState — the only source of "checked"', () => {
  it('a done step a sealed walkthrough proves becomes checked; a claimed step stays done; counts follow', () => {
    const c = applyCheckState(chain([step('understand'), step('build'), step('test')]), wire);
    expect(c.steps.map((s) => [s.id, s.state, s.checkState])).toEqual([
      ['understand', 'done', undefined], ['build', 'checked', 'checked'], ['test', 'done', 'claimed'],
    ]);
    expect([c.done, c.total, c.checked]).toEqual([3, 3, 1]);
  });
  it('a running step the walkthrough already proved is NOT called checked (the bus says it is still working)', () => {
    const c = applyCheckState(chain([step('build', 'running')]), wire);
    expect(c.steps[0]?.state).toBe('running');
    expect(c.steps[0]?.checkState).toBe('checked');
  });
  it('nothing on the wire, a proposed plan, or no matching step: the chain is returned as is', () => {
    const base = chain([step('build')]);
    expect(applyCheckState(base, null)).toBe(base);
    expect(applyCheckState(base, [])).toBe(base);
    expect(applyCheckState(chain([step('build')], { proposed: true }), wire).steps[0]?.state).toBe('done');
    const other = chain([step('deliver')]);
    expect(applyCheckState(other, wire)).toBe(other);
  });
  it('a struck or replaced step is left alone and never counted', () => {
    const c = applyCheckState(chain([step('build', 'struck'), step('test')]), [{ stepId: 'build', checkState: 'checked', provedBy: [] }, { stepId: 'test', checkState: 'checked', provedBy: [] }]);
    expect(c.steps[0]?.checkState).toBeUndefined();
    expect([c.done, c.total, c.checked]).toEqual([1, 1, 1]);
  });
});

describe('checkChip — the words on a step, the moment from the take', () => {
  it('checked at the first proving chapter that the take places (crew sends no time)', () => {
    expect(checkChip(step('build'), wire, moments)).toEqual({ kind: 'checked', text: 'checked at 0:30', atSec: 30 });
  });
  it('the wire’s own atSec wins when crew ever asserts one', () => {
    expect(provedAt({ stepId: 'x', checkState: 'checked', provedBy: [{ chapter: 'a', atSec: null }, { chapter: 'b', atSec: 61 }] }, moments)).toBe(61);
    expect(provedAt({ stepId: 'x', checkState: 'checked', provedBy: [{ chapter: '04-pay', atSec: 12 }] }, moments)).toBe(12);
  });
  it('no recording on screen, or a chapter the take does not hold: "checked" with nothing to open — never an invented time', () => {
    expect(checkChip(step('build'), wire)).toEqual({ kind: 'checked', text: 'checked', atSec: null });
    expect(checkChip(step('build'), [{ stepId: 'build', checkState: 'checked', provedBy: [{ chapter: '01-cart', atSec: null }] }], moments)).toEqual({ kind: 'checked', text: 'checked', atSec: null });
    expect(checkChip(step('build'), [{ stepId: 'build', checkState: 'checked', provedBy: [{ chapter: '01-cart', atSec: null }, { chapter: '05-receipt', atSec: null }] }], moments)).toEqual({ kind: 'checked', text: 'checked at 0:48', atSec: 48 });
  });
  it('a failed check opens at the failing moment; owned_by_you says whose the testing is; claimed and unknown wear nothing', () => {
    expect(checkChip(step('build'), [{ stepId: 'build', checkState: 'failed', provedBy: [{ chapter: '04-pay', atSec: null }] }], moments)).toEqual({ kind: 'failed', text: 'check failed at 0:41', atSec: 41 });
    expect(checkChip(step('build'), [{ stepId: 'build', checkState: 'failed', provedBy: [{ chapter: '05-receipt', atSec: null }] }], moments)).toEqual({ kind: 'failed', text: 'check failed at 0:48', atSec: 48 });
    expect(checkChip(step('build'), [{ stepId: 'build', checkState: 'owned_by_you', provedBy: [] }], moments)).toEqual({ kind: 'yours', text: 'end-to-end testing is yours', atSec: null });
    expect(checkChip(step('test'), wire, moments)).toBeNull();
    expect(checkChip(step('understand'), wire, moments)).toBeNull();
    expect(checkChip(step('build'), null, moments)).toBeNull();
  });
  it('never says "Followed"', () => {
    for (const cs of ['checked', 'failed', 'claimed', 'owned_by_you'] as const) {
      const chip = checkChip(step('build'), [{ stepId: 'build', checkState: cs, provedBy: [{ chapter: '04-pay', atSec: 1 }] }], moments);
      expect(chip?.text ?? '').not.toMatch(/followed/i);
    }
  });
});

describe('momentOfRecording — the take’s chapter marks as moments', () => {
  const rec = {
    kind: 'walkthrough', runId: 'r-walk-pass', chapters: [
      { key: '04-pay', startSec: 30, failedAbsSec: 41 }, { key: '05-receipt', startSec: 48, failedAbsSec: null }, { key: '06-orders', startSec: null, failedAbsSec: null },
    ],
  } as unknown as Recording;
  it('start, the failing moment (else the start), null for an unplaced or unknown chapter', () => {
    const m = momentOfRecording(rec);
    expect([m('04-pay', 'start'), m('04-pay', 'fail'), m('05-receipt', 'fail'), m('06-orders', 'start'), m('zz', 'start')]).toEqual([30, 41, 48, null, null]);
    expect(momentOfRecording(null)('04-pay', 'start')).toBeNull();
  });
});

describe('checkedSentence — the chain sentence once a step carries a check state', () => {
  it('every checkable step checked and all done → "done and checked"', () => {
    const c = applyCheckState(chain([step('understand'), step('build'), step('test')]), [
      { stepId: 'understand', checkState: 'checked', provedBy: [] }, { stepId: 'build', checkState: 'checked', provedBy: [] }, { stepId: 'test', checkState: 'checked', provedBy: [] },
    ]);
    expect(checkedSentence(c)).toBe('3 of 3 done and checked');
  });
  it('some checked → the count; a step only claimed keeps "done" from being "checked"', () => {
    expect(checkedSentence(applyCheckState(chain([step('understand'), step('build'), step('test')]), wire))).toBe('3 of 3 done · 1 checked');
  });
  it('only one of the chain’s steps proven → the count, never "done and checked" (journey desk_checks: 6 of 6, build alone checked)', () => {
    const c = applyCheckState(chain([step('understand'), step('build'), step('test')]), [{ stepId: 'build', checkState: 'checked', provedBy: [] }]);
    expect(checkedSentence(c)).toBe('3 of 3 done · 1 checked');
  });
  it('a chain whose steps are only claimed or yours keeps its plain sentence — no "· 0 checked" (journey desk_checks: yours)', () => {
    const c = applyCheckState(chain([step('understand'), step('build'), step('test'), step('deliver', 'todo')]), [{ stepId: 'build', checkState: 'owned_by_you', provedBy: [] }]);
    expect(c.steps[1]?.checkState).toBe('owned_by_you');
    expect(c.checked).toBeNull();
    expect(chainSentence(c)).toBe('3 of 4 done');
  });
  it('no check state anywhere → null (the caller keeps "2 of 5 done")', () => {
    expect(checkedSentence(chain([step('build'), step('test', 'todo')]))).toBeNull();
  });
  it('steps only claimed or left to the operator (nothing a seal checked or failed) → null too; a failed check counts', () => {
    expect(checkedSentence(applyCheckState(chain([step('understand'), step('build'), step('test'), step('deliver', 'todo')]), [{ stepId: 'build', checkState: 'owned_by_you', provedBy: [] }]))).toBeNull();
    expect(checkedSentence(applyCheckState(chain([step('build')]), [{ stepId: 'build', checkState: 'claimed', provedBy: [] }]))).toBeNull();
    expect(checkedSentence(applyCheckState(chain([step('build'), step('test')]), [{ stepId: 'build', checkState: 'failed', provedBy: [] }]))).toBe('2 of 2 done · 0 checked');
  });
});

describe('deliverAcceptance — crew’s line, with a tone', () => {
  const s = (over: Partial<RunAcceptanceSummary>): RunAcceptanceSummary => ({ required: true, satisfied: true, line: 'Checked by a walkthrough: 3 of 3 steps at a1b2c3d.', walkthrough: null, ...over });
  it('satisfied → ok, verbatim', () => {
    expect(deliverAcceptance(s({}))).toEqual({ text: 'Checked by a walkthrough: 3 of 3 steps at a1b2c3d.', tone: 'ok' });
  });
  it('not satisfied → bad; nothing required → quiet', () => {
    expect(deliverAcceptance(s({ satisfied: false, line: 'Not accepted yet: the walkthrough failed in chapter 4.' }))).toEqual({ text: 'Not accepted yet: the walkthrough failed in chapter 4.', tone: 'bad' });
    expect(deliverAcceptance(s({ required: false, line: 'Nothing had to be proved before delivery.' }))?.tone).toBe('quiet');
  });
  it('no summary on this daemon, or an empty line → nothing is drawn', () => {
    expect(deliverAcceptance(undefined)).toBeNull();
    expect(deliverAcceptance(null)).toBeNull();
    expect(deliverAcceptance(s({ line: '' }))).toBeNull();
  });
});
