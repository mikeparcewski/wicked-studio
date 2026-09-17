import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import {
  ELISION_MARKER,
  deliverLift,
  liftIsFailure,
  liftOutcomeLabel,
  reverifyChangedTree,
  splitElided,
  textCarriesFailure,
  type DeliverLiftView,
} from '../src/components/deliverLiftModel.js';
import type { GateFloorCheck, GateFloorView } from '../src/components/gateVerdictModel.js';
import {
  DETAIL_REVERIFY_FAILED,
  DETAIL_WRONG_HEAD,
  REFUSAL_REVERIFY_FAILED,
  REFUSAL_WRONG_HEAD,
  STEP_FAILED_WRONG_HEAD,
  deliverRetryPrompt,
  deliverWorkerFailedReason,
} from './fixtures/wire433.js';

// ── inline fixture helpers (only the fields the fold reads) ──────────────────

function liftEv(over: Record<string, unknown> = {}): CoreEvent {
  return {
    type: 'deliverLiftEvaluated', session: 'r-1', ord: 5, attempt: 0,
    outcome: 'unchanged', baseRef: 'origin/main',
    baseBefore: 'aaaaaaa', baseAfter: 'aaaaaaa',
    treeBefore: 'bbbbbbb', treeAfter: 'bbbbbbb',
    conflicts: [], note: null, ...over,
  } as unknown as CoreEvent;
}

function sfEv(detail: string, over: Record<string, unknown> = {}): CoreEvent {
  return { type: 'stepFailed', session: 'r-1', ord: 5, attempt: 0, detail, ...over } as unknown as CoreEvent;
}

function dispEv(attempt: number, ord = 5): CoreEvent {
  return { type: 'unitDispatched', session: 'r-1', ord, attempt } as unknown as CoreEvent;
}

function rcEv(over: Record<string, unknown> = {}): CoreEvent {
  return {
    type: 'repoChecksEvaluated', session: 'r-1', ord: 5, attempt: 0,
    passed: true, criterion: '', checks: [], skipped: [], ...over,
  } as unknown as CoreEvent;
}

function view(over: Partial<DeliverLiftView> = {}): DeliverLiftView {
  return {
    ord: 5, attempt: 0, outcome: 'unchanged', baseRef: 'origin/main',
    baseBefore: 'aaa', baseAfter: 'aaa', treeBefore: 'bbb', treeAfter: 'bbb',
    conflicts: [], note: null, reverify: null, failure: null, ...over,
  };
}

function chk(over: Partial<GateFloorCheck> = {}): GateFloorCheck {
  return {
    name: 'test', argv: [], source: '', exitCode: 0, timedOut: false, spawnError: null,
    durationMs: 0, stdoutTail: null, stderrTail: null, classification: null,
    preExisting: [], regressions: [], ...over,
  };
}

function flr(passed: boolean, checks: GateFloorCheck[], skipped: string[] = []): GateFloorView {
  return { passed, criterion: '', attempt: 0, checks, skipped };
}

// ── deliverLift — story lifecycle ────────────────────────────────────────────

describe('deliverLift — story lifecycle', () => {
  it('empty event log → null (with and without deliverOrd)', () => {
    expect(deliverLift([], 5)).toBeNull();
    expect(deliverLift([])).toBeNull();
  });

  it('log with no deliver story (unrelated events) → null', () => {
    const unrelated: CoreEvent[] = [
      { type: 'unitDispatched', session: 'r-1', ord: 3, attempt: 0 } as unknown as CoreEvent,
      { type: 'gateEvaluated', session: 'r-1', ord: 4, combined: false } as unknown as CoreEvent,
    ];
    expect(deliverLift(unrelated, 5)).toBeNull();
    expect(deliverLift(unrelated)).toBeNull();
  });

  it('deliverLiftEvaluated starts a story (with and without explicit deliverOrd)', () => {
    expect(deliverLift([liftEv()], 5)!.ord).toBe(5);
    expect(deliverLift([liftEv()])!.ord).toBe(5);
  });

  it('outcome word kept verbatim: all five engine tokens', () => {
    for (const outcome of ['unchanged', 'lifted', 'conflict', 'skipped', 'failed'] as const) {
      expect(deliverLift([liftEv({ outcome })], 5)!.outcome).toBe(outcome);
    }
  });

  it('all DeliverLiftView fields populated from deliverLiftEvaluated', () => {
    const v = deliverLift([
      liftEv({
        outcome: 'conflict', baseRef: 'origin/main',
        baseBefore: 'abc1234', baseAfter: 'def5678',
        treeBefore: 'tree000', treeAfter: null,
        conflicts: ['package.json', 'src/App.tsx'],
        note: 'merge conflict',
      }),
    ], 5)!;
    expect(v.outcome).toBe('conflict');
    expect(v.baseRef).toBe('origin/main');
    expect(v.baseBefore).toBe('abc1234');
    expect(v.baseAfter).toBe('def5678');
    expect(v.treeBefore).toBe('tree000');
    expect(v.treeAfter).toBeNull();
    expect(v.conflicts).toEqual(['package.json', 'src/App.tsx']);
    expect(v.note).toBe('merge conflict');
    expect(v.reverify).toBeNull();
    expect(v.failure).toBeNull();
  });

  it('deliver: stepFailed without deliverOrd → null (only a lift frame starts an unscoped story)', () => {
    expect(deliverLift([sfEv('deliver: LIFT-CONFLICT — something')])).toBeNull();
  });

  it('deliver: stepFailed with deliverOrd → view with outcome=null and failure set (refused before lift)', () => {
    const v = deliverLift([sfEv('deliver: BASE MOVED since verification')], 5);
    expect(v).not.toBeNull();
    expect(v!.outcome).toBeNull();
    expect(v!.failure).toBe('deliver: BASE MOVED since verification');
    expect(v!.reverify).toBeNull();
  });

  it('non-deliver: stepFailed with deliverOrd and no prior lift → null', () => {
    expect(deliverLift([sfEv('some worker stack trace')], 5)).toBeNull();
  });

  it('repoChecksEvaluated before any lift → not attached (no story in hand)', () => {
    const v = deliverLift([rcEv({ passed: false }), liftEv()], 5)!;
    expect(v.reverify).toBeNull();
  });

  it('repoChecksEvaluated after lift → reverify attached with the floor result', () => {
    const v = deliverLift([
      liftEv({ outcome: 'lifted' }),
      rcEv({ passed: false, checks: [chk({ name: 'lint', exitCode: 1 })], skipped: ['test'] }),
    ], 5)!;
    expect(v.reverify).not.toBeNull();
    expect(v.reverify!.passed).toBe(false);
    expect(v.reverify!.checks).toHaveLength(1);
    expect(v.reverify!.skipped).toEqual(['test']);
  });
});

// ── deliverLift — refused-before-lift shape (wire fixture) ───────────────────

describe('deliverLift — refused-before-lift shape', () => {
  it('STEP_FAILED_WRONG_HEAD with deliverOrd=5: outcome=null, failure=wire detail, no reverify, no conflicts', () => {
    // STEP_FAILED_WRONG_HEAD has ord=5 and detail starting with "deliver:", so the fold builds
    // a refused view even though no deliverLiftEvaluated precedes it (wicked-core#433 final review).
    const v = deliverLift([STEP_FAILED_WRONG_HEAD], 5);
    expect(v).not.toBeNull();
    expect(v!.ord).toBe(5);
    expect(v!.attempt).toBe(0);
    expect(v!.outcome).toBeNull();
    expect(v!.failure).toBe(DETAIL_WRONG_HEAD);
    expect(v!.reverify).toBeNull();
    expect(v!.conflicts).toEqual([]);
  });
});

// ── deliverLift — retry reset (unitDispatched) ───────────────────────────────

describe('deliverLift — retry reset (unitDispatched)', () => {
  it('unitDispatched starts a fresh story: conflict attempt 0 → dispatch → new lift → conflicts cleared', () => {
    const v = deliverLift([
      liftEv({ outcome: 'conflict', conflicts: ['package-lock.json'] }),
      dispEv(1),
      liftEv({ outcome: 'unchanged', attempt: 1, conflicts: [] }),
    ], 5)!;
    expect(v.outcome).toBe('unchanged');
    expect(v.conflicts).toEqual([]);
    expect(v.attempt).toBe(1);
  });

  it('after unitDispatched, a new repoChecksEvaluated attaches to the new attempt lift', () => {
    const v = deliverLift([
      liftEv({ outcome: 'conflict', conflicts: ['x'] }),
      dispEv(1),
      liftEv({ outcome: 'lifted', attempt: 1 }),
      rcEv({ passed: true }),
    ], 5)!;
    expect(v.outcome).toBe('lifted');
    expect(v.reverify).not.toBeNull();
    expect(v.reverify!.passed).toBe(true);
  });
});

// ── liftOutcomeLabel ──────────────────────────────────────────────────────────

describe('liftOutcomeLabel', () => {
  it('maps each engine token to its label', () => {
    expect(liftOutcomeLabel('unchanged')).toBe('base unchanged');
    expect(liftOutcomeLabel('lifted')).toBe('lifted onto the current tip');
    expect(liftOutcomeLabel('conflict')).toBe('LIFT-CONFLICT');
    expect(liftOutcomeLabel('skipped')).toBe('lift skipped');
    expect(liftOutcomeLabel('failed')).toBe('lift failed');
  });

  it('null outcome → "refused before the lift"', () => {
    expect(liftOutcomeLabel(null)).toBe('refused before the lift');
  });

  it('unknown token passes through verbatim (forward-compat with newer engine tokens)', () => {
    expect(liftOutcomeLabel('some_future_outcome')).toBe('some_future_outcome');
  });
});

// ── liftIsFailure ─────────────────────────────────────────────────────────────

describe('liftIsFailure', () => {
  it('conflict outcome → true', () => {
    expect(liftIsFailure(view({ outcome: 'conflict' }))).toBe(true);
  });

  it('failed outcome → true', () => {
    expect(liftIsFailure(view({ outcome: 'failed' }))).toBe(true);
  });

  it('non-null failure (deliver refusal) → true even with a null outcome', () => {
    expect(liftIsFailure(view({ outcome: null, failure: 'deliver: BASE MOVED' }))).toBe(true);
  });

  it('reverify.passed=false → true (failed re-verify)', () => {
    const rc: GateFloorView = { passed: false, criterion: '', attempt: 0, checks: [], skipped: [] };
    expect(liftIsFailure(view({ outcome: 'lifted', reverify: rc }))).toBe(true);
  });

  it('unchanged outcome, no failure, no reverify → false', () => {
    expect(liftIsFailure(view({ outcome: 'unchanged' }))).toBe(false);
  });

  it('lifted outcome, passing reverify, no failure → false', () => {
    const rc: GateFloorView = { passed: true, criterion: '', attempt: 0, checks: [], skipped: [] };
    expect(liftIsFailure(view({ outcome: 'lifted', reverify: rc }))).toBe(false);
  });

  it('skipped outcome, no failure → false', () => {
    expect(liftIsFailure(view({ outcome: 'skipped' }))).toBe(false);
  });
});

// ── reverifyChangedTree ───────────────────────────────────────────────────────

describe('reverifyChangedTree', () => {
  it('passed=false, all exit 0, no skipped → true (post-check proof failure)', () => {
    expect(reverifyChangedTree(flr(false, [chk()]))).toBe(true);
  });

  it('passed=false, non-zero exit code → false', () => {
    expect(reverifyChangedTree(flr(false, [chk({ exitCode: 1 })]))).toBe(false);
  });

  it('passed=true, all exit 0 → false (the floor passed — no contradiction)', () => {
    expect(reverifyChangedTree(flr(true, [chk()]))).toBe(false);
  });

  it('passed=false, all exit 0, has skipped → false (skipped prevents proof)', () => {
    expect(reverifyChangedTree(flr(false, [chk()], ['test']))).toBe(false);
  });

  it('passed=false, no checks → false (empty floor cannot prove changed tree)', () => {
    expect(reverifyChangedTree(flr(false, []))).toBe(false);
  });

  it('passed=false, all exit 0 but one timedOut → false', () => {
    expect(reverifyChangedTree(flr(false, [chk(), chk({ timedOut: true })]))).toBe(false);
  });

  it('passed=false, all exit 0 but one spawnError → false', () => {
    expect(reverifyChangedTree(flr(false, [chk(), chk({ spawnError: 'ENOENT' })]))).toBe(false);
  });
});

// ── splitElided / ELISION_MARKER ─────────────────────────────────────────────

describe('splitElided / ELISION_MARKER', () => {
  it('text with no marker → one-element array containing the whole text', () => {
    const parts = splitElided('some plain output');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe('some plain output');
  });

  it('DETAIL_REVERIFY_FAILED (elided wire detail) → three elements: head / marker / tail', () => {
    const parts = splitElided(DETAIL_REVERIFY_FAILED);
    expect(parts).toHaveLength(3);
    expect(ELISION_MARKER.test(parts[1]!)).toBe(true);
    expect(parts[0]!.length).toBeGreaterThan(0);
    expect(parts[2]!.length).toBeGreaterThan(0);
  });

  it('odd indices match ELISION_MARKER', () => {
    const parts = splitElided('head\n[… 42 chars elided …]\ntail');
    expect(ELISION_MARKER.test(parts[1]!)).toBe(true);
  });

  it('even indices are the kept words (head and tail verbatim)', () => {
    const parts = splitElided('HEAD\n[… 5 chars elided …]\nTAIL');
    expect(parts[0]).toBe('HEAD\n');
    expect(parts[2]).toBe('\nTAIL');
  });

  it('empty string → one-element array with one empty string', () => {
    expect(splitElided('')).toEqual(['']);
  });
});

// ── textCarriesFailure ────────────────────────────────────────────────────────

describe('textCarriesFailure', () => {
  it('null text → false', () => {
    expect(textCarriesFailure(null, 'deliver: some detail')).toBe(false);
  });

  it('undefined text → false', () => {
    expect(textCarriesFailure(undefined, 'deliver: some detail')).toBe(false);
  });

  it('null failure → false', () => {
    expect(textCarriesFailure('some prompt text', null)).toBe(false);
  });

  it('non-elided failure: all kept segments found in plain-worker-failure framing → true', () => {
    // DETAIL_WRONG_HEAD fits 400 chars so no elision; deliverWorkerFailedReason wraps the 300/500
    // excerpt — the full refusal text is a substring of that wider window.
    const text = deliverWorkerFailedReason(REFUSAL_WRONG_HEAD);
    expect(textCarriesFailure(text, DETAIL_WRONG_HEAD)).toBe(true);
  });

  it('elided failure: all kept segments found in triage retry prompt (wider excerpt) → true', () => {
    // DETAIL_REVERIFY_FAILED is the 150/250 head+tail; deliverRetryPrompt quotes the 450/750
    // excerpt — every kept segment (head 150 chars, tail 250 chars) is a substring of the wider window.
    const text = deliverRetryPrompt(REFUSAL_REVERIFY_FAILED);
    expect(textCarriesFailure(text, DETAIL_REVERIFY_FAILED)).toBe(true);
  });

  it('elided failure: head segment not in unrelated text → false', () => {
    expect(textCarriesFailure('totally unrelated text', DETAIL_REVERIFY_FAILED)).toBe(false);
  });

  it('empty text with non-null failure → false', () => {
    expect(textCarriesFailure('', 'deliver: some detail')).toBe(false);
  });

  it('failure with only whitespace around the marker → false (no non-empty kept segments)', () => {
    // splitElided('\n[… 5 chars elided …]\n') → ['\\n', marker, '\\n'] → trim → ['', ''] → filter → []
    // kept.length === 0 → false, regardless of text
    expect(textCarriesFailure('anything here', '\n[… 5 chars elided …]\n')).toBe(false);
  });
});
