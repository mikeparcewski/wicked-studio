// wicked-studio#250 / F-3R2-006 — the pure half of the gate card's evaluator verdict, pinned on
// the recorded Phase 3 re-run frames (tests/fixtures/gateEvidence.ts): which `gateEvaluated` is
// THE verdict for a gate, what evidence rides with it, and the never-overclaim classification.

import { describe, expect, it } from 'vitest';
import type { CoreEvent } from '../src/api/types.js';
import {
  checkOutcome,
  denialSourceLabel,
  formatDuration,
  gateVerdict,
  phaseLabel,
  splitBackticks,
} from '../src/components/gateVerdictModel.js';
import {
  G4_EVENTS,
  G5_EVENTS,
  G6_EVENTS,
  GATE_RUN,
  GATE_UNITS,
  REPO_CHECKS_FAIL,
  TREE_AFTER,
  TREE_BEFORE,
  WORKTREE_GUARD_REASON,
} from './fixtures/gateEvidence.js';

describe('gateVerdict — which evaluation answers the gate', () => {
  it('G4 (pre-run gate before unit #4): the verdict is the fix phase (ord 3) — a PASS with its floor and judge', () => {
    const v = gateVerdict(G4_EVENTS, 4);
    expect(v).not.toBeNull();
    expect(v!.ord).toBe(3);
    expect(v!.outcome).toBe('pass');
    expect(v!.criterion).toBe('the run left a change in its worktree (done is re-derived from the diff, never asserted)');
    expect(v!.hasDeterministicFloor).toBe(true);
    expect(v!.deterministicPass).toBe(true);
    expect(v!.agentVerdict).toBe('pass');
    expect(v!.agentReasoning).toContain('the run left a change in its worktree');
    expect(v!.denial).toBeNull();
    expect(v!.floor).toBeNull(); // no repoChecksEvaluated preceded the ord-3 evaluation
    expect(v!.mutation).toBeNull();
  });

  it('G5 (escalated gate on unit #4): the worktree-guard denial, structured, with the mutation record attached', () => {
    const v = gateVerdict(G5_EVENTS, 4);
    expect(v).not.toBeNull();
    expect(v!.ord).toBe(4);
    expect(v!.outcome).toBe('fail');
    expect(v!.denial).toEqual({
      source: 'worktree_guard',
      reason: WORKTREE_GUARD_REASON,
      claimId: null,
      ruleIds: [],
      deniedTool: null,
      phase: 'unit-4',
    });
    expect(v!.mutation).toEqual({
      cli: 'pi',
      phase: 'verify',
      beforeTree: TREE_BEFORE,
      afterTree: TREE_AFTER,
      headMoved: false,
      changed: [{ path: 'src/App.tsx', status: 'M' }],
    });
    // The judge itself said PASS — the denial is the guard's, and the view keeps both facts.
    expect(v!.agentVerdict).toBe('pass');
  });

  it('G6 (pre-run gate before unit #5 deliver): the verify retry PASSED on the repo-checks floor — per-check results attached', () => {
    const v = gateVerdict(G6_EVENTS, 5);
    expect(v).not.toBeNull();
    expect(v!.ord).toBe(4);
    expect(v!.outcome).toBe('pass');
    expect(v!.denial).toBeNull();
    // Evidence belongs to ONE fold: attempt 0's mutation record sits before the ord-4 DENY, which
    // is the boundary — the retry's PASS must not inherit it (a PASS beside "worktree changed by
    // pi" would be the stale story dressed as the current one).
    expect(v!.mutation).toBeNull();
    expect(v!.floor).not.toBeNull();
    expect(v!.floor!.passed).toBe(true);
    expect(v!.floor!.attempt).toBe(1);
    expect(v!.floor!.skipped).toEqual([]);
    expect(v!.floor!.checks.map((c) => [c.name, c.exitCode, c.durationMs])).toEqual([
      ['typecheck', 0, 6893],
      ['lint', 0, 6118],
      ['test', 0, 79191],
    ]);
    expect(v!.floor!.checks[0]!.source).toBe('package.json scripts.typecheck');
  });

  it('the ord bound: a later unit\'s evaluation can never answer an earlier gate', () => {
    // G6 holds ord-4 evaluations after the ord-3 one; a gate on ord 3 must still see ord ≤ 3.
    const v = gateVerdict(G6_EVENTS, 3);
    expect(v!.ord).toBe(3);
    expect(v!.outcome).toBe('pass');
  });

  it('no gateEvaluated yet (the very first gate) ⇒ null — the card renders no block', () => {
    const firstGate = G4_EVENTS.slice(0, 1); // just the ord-1 awaitingHuman
    expect(gateVerdict(firstGate, 1)).toBeNull();
    expect(gateVerdict([], 1)).toBeNull();
  });

  it('an UNGATED phase (no floor, no judge, no policy) classifies as ungated, never pass (FINDING-025)', () => {
    // The gate before unit #2: the ord-1 triage evaluation is a default-allow.
    const v = gateVerdict(G4_EVENTS.slice(0, 4), 2);
    expect(v!.ord).toBe(1);
    expect(v!.outcome).toBe('ungated');
    expect(v!.criterion).toBeNull();
    expect(v!.evaluatorPolicies).toEqual([]);
  });

  it('an older engine that sends only `denialReason` prose still yields a denial view (source null)', () => {
    const legacy: CoreEvent[] = [
      {
        type: 'gateEvaluated', session: GATE_RUN, ord: 2, criterion: 'c', hasDeterministicFloor: true,
        deterministicPass: false, agentVerdict: null, agentReasoning: null, evaluatorPass: null,
        denialReason: 'pinned validator failed: exit 1', combined: false,
      },
    ];
    const v = gateVerdict(legacy, 2);
    expect(v!.outcome).toBe('fail');
    expect(v!.denial).toEqual({
      source: null, reason: 'pinned validator failed: exit 1', claimId: null, ruleIds: [], deniedTool: null, phase: null,
    });
  });

  it('malformed evidence frames are narrowed, never trusted: a check without a name is dropped, a non-array `changed` reads as none', () => {
    const events: CoreEvent[] = [
      { type: 'evaluatorMutatedWorktree', session: GATE_RUN, ord: 1, cli: 'pi', phase: 'verify', changed: 'nope' },
      { ...REPO_CHECKS_FAIL, ord: 1, checks: [{ name: 'lint', exitCode: 1, durationMs: 10 }, { exitCode: 0 }] },
      { type: 'gateEvaluated', session: GATE_RUN, ord: 1, combined: false, denialReason: 'x' },
    ];
    const v = gateVerdict(events, 1)!;
    expect(v.mutation!.changed).toEqual([]);
    expect(v.floor!.checks.map((c) => c.name)).toEqual(['lint']);
    expect(v.floor!.checks[0]!.argv).toEqual([]);
  });
});

describe('gateVerdict helpers', () => {
  it('phaseLabel: the unit-key suffix for workflow units, `unit N` when unknown', () => {
    expect(phaseLabel(GATE_RUN, GATE_UNITS, 3)).toBe('fix');
    expect(phaseLabel(GATE_RUN, GATE_UNITS, 4)).toBe('verify');
    expect(phaseLabel(GATE_RUN, GATE_UNITS, 9)).toBe('unit 9');
    expect(phaseLabel(GATE_RUN, [], null)).toBe('unknown phase');
  });

  it('denialSourceLabel: a person\'s name per wicked-core source token; unknown tokens pass through', () => {
    expect(denialSourceLabel('worktree_guard')).toBe('worktree guard (evaluator ≠ creator)');
    expect(denialSourceLabel('repo_checks')).toBe('repository checks');
    expect(denialSourceLabel(null)).toBe('the gate');
    expect(denialSourceLabel('some_future_layer')).toBe('some_future_layer');
  });

  it('checkOutcome: exit code, timeout and spawn error in that priority', () => {
    const base = { name: 'test', argv: [], source: '', exitCode: 0, timedOut: false, spawnError: null, durationMs: 1 };
    expect(checkOutcome(base)).toEqual({ word: 'exit 0', ok: true });
    expect(checkOutcome({ ...base, exitCode: 1 })).toEqual({ word: 'exit 1', ok: false });
    expect(checkOutcome({ ...base, exitCode: null, timedOut: true })).toEqual({ word: 'timed out', ok: false });
    expect(checkOutcome({ ...base, exitCode: null, spawnError: 'ENOENT' })).toEqual({ word: 'could not start: ENOENT', ok: false });
    expect(checkOutcome({ ...base, exitCode: null })).toEqual({ word: 'no exit code', ok: false });
  });

  it('formatDuration: ms under a second, one decimal under a minute, m/s above', () => {
    expect(formatDuration(420)).toBe('420ms');
    expect(formatDuration(6893)).toBe('6.9s');
    expect(formatDuration(79191)).toBe('1m 19s');
    expect(formatDuration(120000)).toBe('2m');
  });

  it('formatDuration: rounds to the unit BEFORE choosing the format — never sixty of a smaller unit (Copilot on #252)', () => {
    expect(formatDuration(59_999)).toBe('1m'); // not "60.0s"
    expect(formatDuration(59_949)).toBe('59.9s');
    expect(formatDuration(119_500)).toBe('2m'); // not "1m 60s"
    expect(formatDuration(119_499)).toBe('1m 59s');
    expect(formatDuration(999.6)).toBe('1.0s'); // not "1000ms"
    expect(formatDuration(999.4)).toBe('999ms');
    expect(formatDuration(-5)).toBe('0ms');
  });

  it('splitBackticks: odd indices are the quoted commands', () => {
    const parts = splitBackticks(WORKTREE_GUARD_REASON);
    expect(parts.filter((_, i) => i % 2 === 1)).toEqual([
      'verify',
      'executes_code: false',
      `git read-tree --reset -u ${TREE_BEFORE}`,
      'executes_code: true',
    ]);
  });
});
