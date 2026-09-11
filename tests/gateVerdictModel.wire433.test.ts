// wicked-core#431 / api-types 0.33.0 — the pure half of the three new stories on the gate, the
// deliver ord and the run head (tests/fixtures/wire433.ts): the named judge and the restore state
// on the verdict view, the deliver lift's newest-attempt fold, and the run base — every field
// `null`/absent-safe for a daemon that predates the wire.

import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import { deliverLift, liftIsFailure, liftOutcomeLabel, reverifyChangedTree } from '../src/components/deliverLiftModel.js';
import { gateVerdict, shortId } from '../src/components/gateVerdictModel.js';
import { runBase, runBaseLine, runBaseOf } from '../src/components/runBaseModel.js';
import { G4_EVENTS, G5_EVENTS, G6_EVENTS, GATE_RUN, TREE_BEFORE } from './fixtures/gateEvidence.js';
import {
  BASE_AFTER,
  BASE_BEFORE,
  DELIVER_CHANGED_TREE_TAIL,
  DELIVER_CONFLICT_TAIL,
  DELIVER_FAILED_TAIL,
  DELIVER_LIFTED_TAIL,
  DELIVER_REVERIFY_FAILED_TAIL,
  DELIVER_SKIPPED_TAIL,
  DELIVER_UNCHANGED_TAIL,
  DELIVER_WRONG_HEAD_TAIL,
  DISPATCH_5,
  G4_SAME_SEAT_EVENTS,
  G5R_EVENTS,
  G5R_UNPINNED_EVENTS,
  G5_RESTORE_FAILED_EVENTS,
  LIFT_CONFLICT,
  REFUSAL_CONFLICT,
  REFUSAL_WRONG_HEAD,
  RESTORE_FAILED_ERROR,
  RUN_BASE_AT_TIP,
  RUN_BASE_FETCH_FAILED,
  RUN_BASE_LIFTED,
  RUN_BASE_LOCAL_KEPT,
  RUN_BASE_NO_REMOTE,
  SUGGESTION_REF,
} from './fixtures/wire433.js';

describe('gateVerdict — the judge seat (F-3R2-007)', () => {
  it('reads judgeCli / judgeDistinct off gateEvaluated', () => {
    const v = gateVerdict(G5R_EVENTS, 4)!;
    expect(v.judgeCli).toBe('codex');
    expect(v.judgeDistinct).toBe(true);
    const same = gateVerdict(G4_SAME_SEAT_EVENTS, 4)!;
    expect(same.ord).toBe(3);
    expect(same.judgeCli).toBe('claude');
    expect(same.judgeDistinct).toBe(false);
  });

  it('a frame without the fields (a pre-0.33.0 daemon) or with explicit nulls (no judge ran) yields null — never a guessed seat', () => {
    expect(gateVerdict(G4_EVENTS, 4)!.judgeCli).toBeNull();
    expect(gateVerdict(G4_EVENTS, 4)!.judgeDistinct).toBeNull();
    const v = gateVerdict(G5_RESTORE_FAILED_EVENTS, 4)!;
    expect(v.judgeCli).toBeNull();
    expect(v.judgeDistinct).toBeNull();
    // A non-boolean distinct flag is unknown, not false. A bag on purpose: 0.33.0 declares the field
    // `boolean | null`, and this probes a frame that violates the declaration.
    const odd: CoreEvent[] = [{ type: 'gateEvaluated', session: GATE_RUN, ord: 1, combined: true, judgeCli: 'pi', judgeDistinct: 'yes' } as unknown as CoreEvent];
    expect(gateVerdict(odd, 1)!.judgeDistinct).toBeNull();
    expect(gateVerdict(odd, 1)!.judgeCli).toBe('pi');
  });
});

describe('gateVerdict — the restore state (F-3R2-010)', () => {
  it('G5 on the #431 engine: restored:true on the mutation, the worktreeRestored record attached with its discarded paths and the pinned ref', () => {
    const v = gateVerdict(G5R_EVENTS, 4)!;
    expect(v.outcome).toBe('fail');
    expect(v.denial!.source).toBe('worktree_guard');
    expect(v.mutation).toMatchObject({ cli: 'pi', phase: 'verify', restored: true, restoreError: null, changed: [{ path: 'src/App.tsx', status: 'M' }] });
    expect(v.restore).toEqual({ tree: TREE_BEFORE, head: null, discarded: [{ path: 'src/App.tsx', status: 'M' }], suggestionRef: SUGGESTION_REF });
  });

  it('a failed pin keeps the record with suggestionRef null', () => {
    expect(gateVerdict(G5R_UNPINNED_EVENTS, 4)!.restore!.suggestionRef).toBeNull();
  });

  it('a failed restore: restored:false + restoreError, no restore record', () => {
    const v = gateVerdict(G5_RESTORE_FAILED_EVENTS, 4)!;
    expect(v.mutation!.restored).toBe(false);
    expect(v.mutation!.restoreError).toBe(RESTORE_FAILED_ERROR);
    expect(v.restore).toBeNull();
  });

  it('the recorded pre-0.33.0 fold (no restored field, no worktreeRestored) reads restored:null and restore:null', () => {
    const v = gateVerdict(G5_EVENTS, 4)!;
    expect(v.mutation!.restored).toBeNull();
    expect(v.mutation!.restoreError).toBeNull();
    expect(v.restore).toBeNull();
  });

  it('the restore record belongs to ONE fold: the retry\'s PASS (G6) inherits neither the mutation nor the restore', () => {
    const retried = [...G5R_EVENTS, ...G6_EVENTS.slice(G5_EVENTS.length)];
    const v = gateVerdict(retried, 5)!;
    expect(v.outcome).toBe('pass');
    expect(v.mutation).toBeNull();
    expect(v.restore).toBeNull();
  });
});

describe('deliverLift — the deliver ord\'s newest-attempt story (F-3R2-013)', () => {
  const tail = (t: CoreEvent[]): CoreEvent[] => [...G6_EVENTS, ...t];

  it('unchanged: the base was already the tip; no re-verify, no failure', () => {
    const v = deliverLift(tail(DELIVER_UNCHANGED_TAIL), 5)!;
    expect(v).toMatchObject({ ord: 5, attempt: 0, outcome: 'unchanged', baseRef: 'origin/main', baseBefore: BASE_BEFORE, baseAfter: BASE_BEFORE, conflicts: [], note: null, reverify: null, failure: null });
    expect(liftIsFailure(v)).toBe(false);
  });

  it('lifted: the re-verify (the deliver ord\'s repoChecksEvaluated) rides the view, forced-install source and all', () => {
    const v = deliverLift(tail(DELIVER_LIFTED_TAIL), 5)!;
    expect(v.outcome).toBe('lifted');
    expect(v.baseAfter).toBe(BASE_AFTER);
    expect(v.reverify!.passed).toBe(true);
    expect(v.reverify!.checks.map((c) => c.name)).toEqual(['install', 'typecheck', 'lint', 'test']);
    expect(v.reverify!.checks[0]!.source).toBe('package-lock.json (forced: lockfile drift)');
    expect(v.failure).toBeNull();
    expect(liftIsFailure(v)).toBe(false);
  });

  it('conflict: the files, and the engine\'s LIFT-CONFLICT refusal verbatim as the failure', () => {
    const v = deliverLift(tail(DELIVER_CONFLICT_TAIL), 5)!;
    expect(v.outcome).toBe('conflict');
    expect(v.conflicts).toEqual(['testid-inventory.json']);
    expect(v.treeAfter).toBeNull();
    expect(v.failure).toBe(REFUSAL_CONFLICT);
    expect(liftIsFailure(v)).toBe(true);
  });

  it('skipped / failed carry the engine\'s note', () => {
    expect(deliverLift(tail(DELIVER_SKIPPED_TAIL), 5)).toMatchObject({ outcome: 'skipped', baseRef: null, note: expect.stringContaining('no remote default branch') });
    const failed = deliverLift(tail(DELIVER_FAILED_TAIL), 5)!;
    expect(failed.outcome).toBe('failed');
    expect(failed.failure).toContain('could not be applied cleanly');
    expect(liftIsFailure(failed)).toBe(true);
  });

  it('the addendum: a deliver unit refused for a wrong HEAD ref has NO lift frame — the view is the deliver: failure alone (outcome null)', () => {
    const v = deliverLift(tail(DELIVER_WRONG_HEAD_TAIL), 5)!;
    expect(v.outcome).toBeNull();
    expect(v.failure).toBe(REFUSAL_WRONG_HEAD);
    expect(v.reverify).toBeNull();
    expect(liftIsFailure(v)).toBe(true);
    expect(liftOutcomeLabel(v.outcome)).toBe('refused before the lift');
  });

  it('a failed re-verify and a failed post-check proof both read passed:false — the proof case is recognisable (every check exit 0)', () => {
    const red = deliverLift(tail(DELIVER_REVERIFY_FAILED_TAIL), 5)!;
    expect(red.reverify!.passed).toBe(false);
    expect(red.reverify!.skipped).toEqual(['test']);
    expect(reverifyChangedTree(red.reverify!)).toBe(false);
    expect(red.failure).toContain("the repository's own checks FAILED on it");
    const moved = deliverLift(tail(DELIVER_CHANGED_TREE_TAIL), 5)!;
    expect(moved.reverify!.passed).toBe(false);
    expect(moved.reverify!.checks.every((c) => c.exitCode === 0)).toBe(true);
    expect(reverifyChangedTree(moved.reverify!)).toBe(true);
    expect(moved.failure).toContain('CHANGED the worktree while running');
  });

  it('a retry starts a fresh story: the new attempt\'s unitDispatched drops the previous conflict; its own lift then stands', () => {
    const retry: CoreEvent = { type: 'unitDispatched', session: GATE_RUN, ord: 5, seq: 330, ts: 1, attempt: 1 };
    expect(deliverLift(tail([...DELIVER_CONFLICT_TAIL, retry]), 5)).toBeNull();
    const lifted: CoreEvent = { ...LIFT_CONFLICT, seq: 331, attempt: 1, outcome: 'unchanged', baseAfter: BASE_BEFORE, conflicts: [] };
    const v = deliverLift(tail([...DELIVER_CONFLICT_TAIL, retry, lifted]), 5)!;
    expect(v.attempt).toBe(1);
    expect(v.outcome).toBe('unchanged');
    expect(v.failure).toBeNull();
  });

  it('scoping: a non-deliver ord sees nothing (its repoChecksEvaluated is the verify floor, not a re-verify); unscoped, only a lift frame starts a story', () => {
    const log = tail(DELIVER_LIFTED_TAIL);
    expect(deliverLift(log, 4)).toBeNull(); // ord 4's repoChecksEvaluated is the verify floor — no lift frame precedes it
    const unscoped = deliverLift(log)!;
    expect(unscoped.ord).toBe(5);
    expect(unscoped.reverify!.checks).toHaveLength(4);
    expect(deliverLift(G6_EVENTS)).toBeNull();
    // A stepFailed on the deliver ord that is NOT a deliver: refusal (a worker stack trace) does not
    // start a story on its own — that is the failure banner's business.
    const worker: CoreEvent = { type: 'stepFailed', session: GATE_RUN, ord: 5, seq: 311, ts: 1, attempt: 0, detail: 'worker exited 1\nTraceback…' };
    expect(deliverLift([...G6_EVENTS, ...DISPATCH_5, worker], 5)).toBeNull();
  });

  it('no deliver frames at all (the pre-run deliver gate, or an older daemon) ⇒ null', () => {
    expect(deliverLift(G6_EVENTS, 5)).toBeNull();
    expect(deliverLift([], 5)).toBeNull();
  });

  it('liftOutcomeLabel: every engine token has a word; a newer engine\'s passes through', () => {
    expect(['unchanged', 'lifted', 'conflict', 'skipped', 'failed'].map(liftOutcomeLabel)).toEqual([
      'base unchanged', 'lifted onto the current tip', 'LIFT-CONFLICT', 'lift skipped', 'lift failed',
    ]);
    expect(liftOutcomeLabel('rebased_by_operator')).toBe('rebased_by_operator');
  });
});

describe('runBase — how the run\'s base was chosen (F-3R2-013)', () => {
  it('the last runBaseResolved in the log, narrowed', () => {
    expect(runBase([RUN_BASE_LIFTED, ...G4_EVENTS])).toEqual({
      baseRef: 'origin/main', baseCommit: BASE_AFTER, localHead: BASE_BEFORE, behind: 5, fetched: true, lifted: true, note: null,
    });
    expect(runBase(G4_EVENTS)).toBeNull();
    expect(runBaseOf({ type: 'runBaseResolved', session: GATE_RUN })).toBeNull(); // no commit ⇒ no view
    expect(runBaseOf({ type: 'runBaseResolved', session: GATE_RUN, baseCommit: BASE_AFTER, behind: -3 })!.behind).toBe(0);
  });

  it('runBaseLine: the one-line note per posture', () => {
    expect(runBaseLine(runBaseOf(RUN_BASE_LIFTED)!)).toBe(`origin/main @ ${shortId(BASE_AFTER, 7)} · 5 behind · lifted to the tip`);
    expect(runBaseLine(runBaseOf(RUN_BASE_AT_TIP)!)).toBe(`origin/main @ ${shortId(BASE_BEFORE, 7)} · at the tip`);
    expect(runBaseLine(runBaseOf(RUN_BASE_LOCAL_KEPT)!)).toBe(`origin/main @ ${shortId(BASE_BEFORE, 7)} · local HEAD kept`);
    expect(runBaseLine(runBaseOf(RUN_BASE_NO_REMOTE)!)).toBe(`local HEAD @ ${shortId(BASE_BEFORE, 7)} · no remote default branch resolved`);
    expect(runBaseLine(runBaseOf(RUN_BASE_FETCH_FAILED)!)).toBe(`origin/main @ ${shortId(BASE_BEFORE, 7)} · local HEAD kept · fetch failed — cached refs`);
  });

  it('shortId: trees to 10, commits to 7, short ids whole', () => {
    expect(shortId(TREE_BEFORE)).toBe(TREE_BEFORE.slice(0, 10));
    expect(shortId(BASE_AFTER, 7)).toBe(BASE_AFTER.slice(0, 7));
    expect(shortId('abc', 7)).toBe('abc');
  });
});
