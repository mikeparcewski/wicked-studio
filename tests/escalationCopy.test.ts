// fixall L8-8E(i) — the (condition × denialSource) escalation copy table (crew #559 / F-RC1-047 =
// F-RC2-061; DES-L8 r2 §5 PR-8E), the gate model's classification render (D3) and the narrator /
// timeline readers that share the table. Pins every pair wicked-core emits today, incl. the two the
// review added: `boundary_deny × ""` (the hook-veto arm whose source identity the engine folded away)
// and `verdict_not_pass × worker_failure` (a worker exit → UnitDenial("worker_failure") → the `_` arm).

import { describe, expect, it } from 'vitest';
import { escalationCopy } from '../src/components/denialCopy.js';
import { checkOutcome, denialSourceLabel, floorOf } from '../src/components/gateVerdictModel.js';
import { narrate } from '../src/components/narrator.js';
import type { CoreEvent } from '../src/api/types.js';

const ctx = { phaseOf: (ord: number | null | undefined) => (ord == null ? '?' : `phase-${ord}`) };
const ev = (fields: Record<string, unknown>): CoreEvent => ({ session: 'r', ...fields }) as CoreEvent;

describe('escalationCopy — every (condition, denialSource) pair the engine emits has a sentence', () => {
  it('boundary_deny × input_governance: a refused command, never "tried to write outside its workspace"', () => {
    const c = escalationCopy('boundary_deny', 'input_governance', { ord: 3, deniedCommand: 'ls -la /' });
    expect(c.known).toBe(true);
    expect(c.headline).toBe('Unit #3: a command was refused by governance: `ls -la /`');
    expect(c.headline).not.toMatch(/write outside/);
  });

  it('boundary_deny × "" (the hook-veto arm, source folded away) reads the SAME governance sentence', () => {
    const c = escalationCopy('boundary_deny', '', { ord: 2 });
    expect(c.known).toBe(true);
    expect(c.headline).toBe('Unit #2: a command was refused by governance');
    // absent denialSource (an older frame) rides the same row
    expect(escalationCopy('boundary_deny', undefined, { ord: 2 }).headline).toBe('Unit #2: a command was refused by governance');
  });

  it('a boundary-read-deny claim marks the refusal as a read outside the workspace', () => {
    const c = escalationCopy('boundary_deny', 'input_governance', { ord: 1, deniedCommand: 'cat', claimId: 'boundary-read-deny:unit-1' });
    expect(c.headline).toBe('Unit #1: a command was refused by governance: `cat` (a read outside the workspace)');
  });

  it('evaluator_mutated_worktree branches on restored: restored (+ paths, + pin) / NOT restored / unknown', () => {
    expect(
      escalationCopy('evaluator_mutated_worktree', 'worktree_guard', { ord: 4, restored: true, discardedCount: 2, suggestionRef: 'refs/wicked/suggestions/r/4/0' }).headline,
    ).toBe("Unit #4: the reviewer changed files it was only meant to check — the creator's tree was restored (2 paths discarded) · the discarded edit is pinned at refs/wicked/suggestions/r/4/0");
    expect(escalationCopy('evaluator_mutated_worktree', 'worktree_guard', { ord: 4, restored: false }).headline).toBe(
      'Unit #4: the reviewer changed files it was only meant to check — the tree could NOT be restored; inspect the worktree',
    );
    expect(escalationCopy('evaluator_mutated_worktree', 'worktree_guard', { ord: 4 }).headline).toMatch(/restore state unknown$/);
    expect(escalationCopy('evaluator_mutated_worktree', 'worktree_guard', { ord: 4, restored: true, discardedCount: 1 }).headline).toMatch(/\(1 path discarded\)$/);
  });

  it('dead_seat names the seat', () => {
    expect(escalationCopy('dead_seat', 'dead_seat', { ord: 1, cli: 'codex' }).headline).toBe(
      'Unit #1: seat codex is unusable (signed out / not installed) — no eligible seat remains',
    );
  });

  it.each([
    ['repo_checks', 'repository checks failed'],
    ['repo_checks_timeout', 'repository checks timed out'],
    ['pinned_validator', 'the pinned validator failed'],
    ['substance', 'no reviewable substance was produced'],
    ['deliverables', 'declared deliverables are missing'],
  ])('floor_failed × %s', (source, sentence) => {
    const c = escalationCopy('floor_failed', source, { ord: 5, verdictSummary: 'test exit 1\nmore lines' });
    expect(c.known).toBe(true);
    expect(c.headline).toBe(`Unit #5: ${sentence} — test exit 1`); // first line of the summary only
  });

  it('verdict_not_pass × agent_validator / worker_failure / evaluator_verdict', () => {
    expect(escalationCopy('verdict_not_pass', 'agent_validator', { ord: 6, verdictSummary: 'missing tests' }).headline).toBe('Unit #6: the review did not pass — missing tests');
    expect(escalationCopy('verdict_not_pass', 'worker_failure', { ord: 6, verdictSummary: 'exit 137' }).headline).toBe('Unit #6: the worker exited before finishing — exit 137');
    expect(escalationCopy('verdict_not_pass', 'evaluator_verdict', { ord: 6, verdictSummary: 'VERDICT: FAIL' }).headline).toBe("Unit #6: the evaluator's VERDICT was not PASS — VERDICT: FAIL");
  });

  it('defGate / outputCaptured become footnotes; an unknown pair answers known:false with the condition kept', () => {
    const c = escalationCopy('boundary_deny', 'input_governance', { ord: 1, defGate: true, outputCaptured: true });
    expect(c.notes).toEqual(['declared by the workflow', 'output captured — view transcript']);
    const u = escalationCopy('some_future_condition', 'some_layer', { ord: 9, verdictSummary: 'x' });
    expect(u.known).toBe(false);
    expect(u.headline).toBe('Unit #9: some_future_condition escalated to you — x');
    // a known condition with a source the table does not know is NOT guessed either
    expect(escalationCopy('verdict_not_pass', 'mystery', { ord: 9 }).known).toBe(false);
  });
});

describe('denialSourceLabel — the three tokens the review added', () => {
  it('names repo_checks_timeout, dead_seat and evaluator_verdict; unknown tokens still pass through', () => {
    expect(denialSourceLabel('repo_checks_timeout')).toBe('repository checks (timed out)');
    expect(denialSourceLabel('dead_seat')).toBe('seat unusable');
    expect(denialSourceLabel('evaluator_verdict')).toBe('evaluator verdict line');
    expect(denialSourceLabel('later_layer')).toBe('later_layer');
  });
});

describe('repo-check classification (D3) — floorOf folds the 0.38.0 fields, checkOutcome words them', () => {
  const frame = ev({
    type: 'repoChecksEvaluated',
    ord: 4,
    passed: false,
    criterion: 'checks',
    checks: [
      { name: 'test', argv: ['npm', 'test'], source: 'repo', exitCode: 1, timedOut: false, spawnError: null, durationMs: 10, classification: 'regression', preExisting: [], regressions: ['auth.spec'] },
      { name: 'lint', argv: ['npm', 'run', 'lint'], source: 'repo', exitCode: 1, timedOut: false, spawnError: null, durationMs: 10, classification: 'pre_existing_in_sandbox', preExisting: ['a', 'b'], regressions: [] },
      { name: 'legacy', argv: ['x'], source: 'repo', exitCode: 1, timedOut: false, spawnError: null, durationMs: 10, classification: 'floor_env_mismatch' },
      { name: 'old-engine', argv: ['y'], source: 'repo', exitCode: 1, timedOut: false, spawnError: null, durationMs: 10 },
    ],
    skipped: [],
  });

  it('folds classification / preExisting / regressions (absent ⇒ null / [])', () => {
    const floor = floorOf(frame);
    expect(floor.checks.map((c) => [c.name, c.classification, c.preExisting, c.regressions])).toEqual([
      ['test', 'regression', [], ['auth.spec']],
      ['lint', 'pre_existing_in_sandbox', ['a', 'b'], []],
      ['legacy', 'floor_env_mismatch', [], []],
      ['old-engine', null, [], []],
    ]);
  });

  it('words a regression red, a pre-existing failure NOT red, and an unclassified failure as before', () => {
    const [test, lint, legacy, old] = floorOf(frame).checks;
    expect(checkOutcome(test!)).toEqual({ word: 'regression — 1 new failure', ok: false });
    expect(checkOutcome(lint!)).toEqual({ word: 'failed on head AND base — pre-existing, not this change', ok: true });
    expect(checkOutcome(legacy!)).toEqual({ word: 'failed on head AND base — pre-existing, not this change', ok: true });
    expect(checkOutcome(old!)).toEqual({ word: 'exit 1', ok: false });
    expect(checkOutcome({ ...test!, regressions: [] })).toEqual({ word: 'regression — fails on head, not on base', ok: false });
  });
});

describe('narrator — the feed reads the same table, and the watchdog frames', () => {
  it('gateEscalated boundary_deny × input_governance / × "" render the governance sentence; an unknown condition keeps its token', () => {
    const governed = narrate(ev({ type: 'gateEscalated', ord: 2, condition: 'boundary_deny', denialSource: 'input_governance' }), ctx);
    expect(governed?.text).toBe('Gate approaching — Unit #2: a command was refused by governance');
    const veto = narrate(ev({ type: 'gateEscalated', ord: 2, condition: 'boundary_deny', denialSource: '' }), ctx);
    expect(veto?.text).toBe('Gate approaching — Unit #2: a command was refused by governance');
    const worker = narrate(ev({ type: 'gateEscalated', ord: 7, condition: 'verdict_not_pass', denialSource: 'worker_failure', verdictSummary: 'exit 1' }), ctx);
    expect(worker?.text).toBe('Gate approaching — Unit #7: the worker exited before finishing — exit 1');
    const legacy = narrate(ev({ type: 'gateEscalated', ord: 3, condition: 'coverage >= 80%' }), ctx);
    expect(legacy?.text).toBe('Gate approaching — coverage >= 80%');
    expect(legacy?.tone).toBe('gate');
  });

  it('workerStalled reads quietForMs when stalledSecs is absent (the daemon watchdog frame)', () => {
    expect(narrate(ev({ type: 'workerStalled', ord: 2, stalledSecs: 120 }), ctx)?.text).toMatch(/^Worker quiet for 120s/);
    expect(narrate(ev({ type: 'workerStalled', ord: 2, quietForMs: 90_000 }), ctx)?.text).toMatch(/^Worker quiet for 90s/);
    expect(narrate(ev({ type: 'workerStalled', ord: 2 }), ctx)?.text).toMatch(/^Worker quiet for \?s/);
  });

  it('workerStallEscalated: the needs-you line names the silence, what the watchdog did and how it ended', () => {
    const exhausted = narrate(ev({ type: 'workerStallEscalated', ord: 5, quietForMs: 30.3 * 60_000, action: 'reassign', outcome: 'exhausted', needsYou: true }), ctx);
    expect(exhausted?.text).toBe('Needs you — worker silent 30 min — automatic recoveries spent — a human must intervene');
    expect(exhausted?.tone).toBe('gate');
    const ok = narrate(ev({ type: 'workerStallEscalated', ord: 5, quietForMs: 5 * 60_000, action: 'reassign', outcome: 'ok', needsYou: false, previousCli: 'bash', cli: 'claude' }), ctx);
    expect(ok?.text).toBe('worker silent 5 min — reassigned (bash → claude)');
    expect(ok?.tone).toBe('info');
    const notify = narrate(ev({ type: 'workerStallEscalated', ord: 5, quietForMs: 60_000, action: 'notify', outcome: 'ok', needsYou: true }), ctx);
    expect(notify?.text).toBe('Needs you — worker silent 1 min — surfaced for you — the run was not touched');
  });
});
