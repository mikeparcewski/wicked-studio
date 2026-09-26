import { describe, expect, it } from 'vitest';
import type { PlanPreviewResponse } from '../src/api/teamPlan.js';
import {
  editOutcome,
  humanConfirmFor,
  launchPreviewView,
  parseTouch,
  planEditAvailability,
  planFromSelection,
  scopeOffset,
} from '../src/board/planModel.js';

/** DES-TEAMING-002 T9 — the pure plan model the composer and run page render. */

const base = {
  deterministic: 0, destructive: false, floor_override: null, reasons: [], floor: [],
  high_risk: false, pauses: false, pause_reason: null,
} satisfies Partial<PlanPreviewResponse>;

const pending: PlanPreviewResponse = {
  ...base, score: 0, band: '0-19', graph: 'pending_pa_scope', pauses: true, pause_reason: 'manual_mode',
  floor: ['understand'],
  steps: [
    { catalog: 'understand', id: 'pa-scope', added_by: 'plan' },
    { catalog: 'build', id: 'build', added_by: 'plan' },
    // A baseline floor step: pending previews must not draw it as the real floor.
    { catalog: 'review', id: 'review', added_by: 'floor', floor_reason: 'baseline' },
  ],
};

const scored: PlanPreviewResponse = {
  ...base, score: 55, band: '40-69', graph: 'ready', pauses: true, pause_reason: 'manual_mode',
  steps: [
    { catalog: 'test_plan', id: 'test_plan', added_by: 'floor', floor_reason: 'band 40-69 requires test_plan' },
    { catalog: 'build', id: 'build', added_by: 'plan' },
    { catalog: 'review', id: 'review', added_by: 'floor', floor_reason: 'band 40-69 requires review' },
  ],
};

describe('composing a plan', () => {
  it('steps default to their catalog id; a repeated phase gets a unique id', () => {
    expect(planFromSelection([{ catalog: 'build' }, { catalog: 'review' }, { catalog: 'build' }], [])).toEqual({
      steps: [{ catalog: 'build' }, { catalog: 'review' }, { catalog: 'build', id: 'build-2' }],
    });
  });

  it('touch is sent only when non-empty, trimmed and de-duplicated', () => {
    expect(planFromSelection([{ catalog: 'build' }], ['  ', ''])).toEqual({ steps: [{ catalog: 'build' }] });
    expect(planFromSelection([{ catalog: 'build' }], [' a.ts', 'a.ts', 'b.ts'])).toEqual({
      steps: [{ catalog: 'build' }], touch: ['a.ts', 'b.ts'],
    });
    expect(parseTouch('a.ts\n b.ts , c.ts\n\n')).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });
});

describe('the launch preview', () => {
  it('pending_pa_scope: no score, no floor markers (the floor is only the baseline), pa-scope not drawn', () => {
    const v = launchPreviewView(pending);
    expect(v.kind).toBe('pending-scope');
    expect(v).not.toHaveProperty('score');
    expect(v).not.toHaveProperty('band');
    expect(v.steps.map((s) => s.id)).toEqual(['build', 'review']);
    expect(v.steps.every((s) => !s.byFloor)).toBe(true);
    expect(v.pauses).toBe(true);
  });

  it('pending and not paused says it may still pause once the scope lands', () => {
    const v = launchPreviewView({ ...pending, pauses: false, pause_reason: null });
    expect(v.pauseText).toMatch(/pauses if the PA.s scope lands high risk/);
  });

  it('scored: score, band and the steps the floor added', () => {
    const v = launchPreviewView(scored);
    if (v.kind !== 'scored') throw new Error('expected scored');
    expect([v.score, v.band]).toEqual([55, '40-69']);
    expect(v.floorAdded.map((s) => s.id)).toEqual(['test_plan', 'review']);
    expect(v.steps.find((s) => s.id === 'build')?.byFloor).toBe(false);
    expect(v.pauseText).toMatch(/approve the plan/);
  });

  it('high risk names the band in the pause reason', () => {
    const v = launchPreviewView({ ...scored, band: '70-100', high_risk: true, pause_reason: 'high_risk' });
    expect(v.pauseText).toMatch(/high risk \(band 70-100\)/);
  });
});

describe('before:N past the PA scope step', () => {
  it('the offset is 1 exactly when pa-scope leads the steps', () => {
    expect(scopeOffset(pending)).toBe(1);
    expect(scopeOffset(scored)).toBe(0);
    expect(scopeOffset(null)).toBe(0);
  });

  it('humanConfirm shifts before:N by the offset; other postures are unchanged', () => {
    expect(humanConfirmFor(undefined, 'before', 1, 1)).toBe('before:2');
    expect(humanConfirmFor('balanced', 'before', 3, 0)).toBe('before:3');
    expect(humanConfirmFor('balanced', 'all', 3, 1)).toBe('all');
    expect(humanConfirmFor('balanced', 'none', 3, 1)).toBeUndefined();
    expect(humanConfirmFor('ask', 'none', 1, 1)).toBe('all');
    expect(humanConfirmFor('autonomous', 'before', 1, 1)).toBeUndefined();
  });
});

describe('mid-run edit answers', () => {
  it('a proposal carries band, high risk and the floor additions', () => {
    expect(editOutcome({ proposal_id: 'p1', duplicate: false, band: '70-100', high_risk: true, floor_added: ['review'] }))
      .toEqual({ kind: 'applied', proposalId: 'p1', band: '70-100', highRisk: true, floorAdded: ['review'] });
  });

  it('duplicate: true reads as already applied', () => {
    expect(editOutcome({ proposal_id: 'p1', duplicate: true, band: null, high_risk: null, floor_added: [] }))
      .toEqual({ kind: 'already-applied', proposalId: 'p1' });
  });

  it('a gate answer is told apart by its status', () => {
    expect(editOutcome({ status: 'executing' })).toEqual({ kind: 'answered-gate', status: 'executing' });
  });

  it('only a live planned run offers an edit, and not while it waits on a human', () => {
    const preset = { kind: 'preset', name: 'feature', user_plan: false, system: false };
    expect(planEditAvailability({ status: 'executing', run_identity: preset })).toEqual({ show: true, editable: true });
    expect(planEditAvailability({ status: 'awaiting_human', run_identity: preset })).toMatchObject({ show: true, editable: false });
    expect(planEditAvailability({ status: 'completed', run_identity: preset })).toEqual({ show: false });
    expect(planEditAvailability({ status: 'executing', run_identity: { ...preset, kind: 'workflow' } })).toEqual({ show: false });
    expect(planEditAvailability({ status: 'executing' })).toEqual({ show: false });
  });
});
