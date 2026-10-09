import { describe, expect, it } from 'vitest';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { FLOOR_FIX_LABEL, FLOOR_FIX_TITLE, isToolUnitGate, sessionGateChoices } from '../src/board/gateRowModel.js';
import { classifyRowGate } from '../src/board/questionRow.js';
import { recommendGateMove } from '../src/components/gateMoveModel.js';
import { gateVerdictFor, isFloorFixGate } from '../src/components/gateVerdictModel.js';
import { narrate } from '../src/components/narrator.js';
import { GATE_RUN, GATE_UNITS } from './fixtures/gateEvidence.js';
import { G5R_EVENTS, G5R_UNPINNED_EVENTS, RESTORED_PROMPT } from './fixtures/wire433.js';
import { makeUnit } from './factories.js';

const NOW = 1_700_000_000_000;

/** The wire433 run with its roles said: `fix` (ord 3) the creator on claude, `verify` (ord 4) the evaluator on pi. */
const ROLE_UNITS: WorkUnit[] = GATE_UNITS.map((u) =>
  u.ord === 3 ? { ...u, role: 'creator', assigned_cli: 'claude' }
    : u.ord === 4 ? { ...u, role: 'evaluator', assigned_cli: 'pi', status: 'rejected' }
      : u);

function gateOf(over: Partial<OpenGate>): OpenGate {
  return { runId: GATE_RUN, ord: 4, prompt: RESTORED_PROMPT, lifecycle: 'open', receivedAt: NOW, ...over };
}

// ── studio#600: the restored-tree gate is a retry, not an escalation ───────────────────────────

describe('studio#600 — the engine\'s restored-tree gate reads as a retry', () => {
  for (const gateKind of [undefined, 'escalation'] as const) {
    it(`classifies as retry (gateKind ${gateKind ?? 'absent'}), with no Send back and Retry first`, () => {
      const gate = gateOf(gateKind === undefined ? {} : { gateKind });
      expect(classifyRowGate({ runId: GATE_RUN, gate, units: ROLE_UNITS, events: G5R_EVENTS })).toEqual({ kind: 'card', reason: 'retry' });
      const model = sessionGateChoices({ runId: GATE_RUN, gate, units: ROLE_UNITS, events: G5R_UNPINNED_EVENTS, pool: ['claude', 'pi'], roster: null })!;
      expect(model.reason).toBe('retry');
      const keys = [...model.choices, ...model.overflow].map((c) => c.key);
      expect(keys).not.toContain('send-back');
      expect(keys).not.toContain('steer');
      expect(model.choices[0]).toMatchObject({ key: 'retry', decision: { approve: true } });
      expect(model.choices[model.choices.length - 1]!.key).toBe('stop');
      expect(model.recommended).toBe(0);
    });
  }

  it('keeps the adopt-the-edit arm when the engine pinned the evaluator\'s edit', () => {
    const model = sessionGateChoices({ runId: GATE_RUN, gate: gateOf({ gateKind: 'escalation' }), units: ROLE_UNITS, events: G5R_EVENTS, pool: [], roster: null })!;
    expect(model.reason).toBe('retry');
    expect(model.choices.map((c) => c.key)).toEqual(['retry', 'offer:accept_suggestion', 'stop']);
    expect(model.choices[1]!.decision).toMatchObject({ approve: true, action: 'accept_suggestion' });
  });

  it('still reads as an escalation before the log is read (the Desk opens the card either way)', () => {
    expect(classifyRowGate({ runId: GATE_RUN, gate: gateOf({}), units: ROLE_UNITS, events: null })).toEqual({ kind: 'card', reason: 'escalation' });
  });
});

// ── studio#601: a judge refusing a passing review does not suggest Send back ───────────────────

const JUDGE_RUN = 'r-judge';
const JUDGE_PROMPT = 'Unit 2 verdict is NOT PASS — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run';
const JUDGE_UNITS: WorkUnit[] = [
  makeUnit({ id: `${JUDGE_RUN}:build`, session_id: JUDGE_RUN, ord: 1, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: `${JUDGE_RUN}:walkthrough_plan`, session_id: JUDGE_RUN, ord: 2, stage: 'review', role: 'evaluator', status: 'rejected', assigned_cli: 'pi' }),
];
function judgeEvents(evaluatorVerdict: string | null): CoreEvent[] {
  return [
    { type: 'unitDispatched', session: JUDGE_RUN, ord: 2, attempt: 0, ts: NOW - 5000, seq: 1 },
    { type: 'gateEvaluated', session: JUDGE_RUN, ord: 2, ts: NOW - 1000, seq: 2,
      criterion: 'the walkthrough plan covers the intent', hasDeterministicFloor: true, deterministicPass: true,
      agentVerdict: 'reject', agentReasoning: '- the plan skips the error path\n- no step covers the empty cart',
      evaluatorPass: true, evaluatorPolicies: [], evaluatorVerdict,
      denialReason: 'the judge refused: the plan skips the error path',
      denial: { source: 'agent_validator', reason: 'the judge refused: the plan skips the error path', claimId: null, ruleIds: [], deniedTool: null, phase: 'walkthrough_plan' },
      combined: false, judgeCli: 'codex', judgeDistinct: true },
    { type: 'gateEscalated', session: JUDGE_RUN, ord: 2, ts: NOW - 900, seq: 3, attempt: 0, condition: 'verdict_not_pass', denialSource: 'agent_validator' },
    { type: 'awaitingHuman', session: JUDGE_RUN, ord: 2, ts: NOW - 800, seq: 4, prompt: JUDGE_PROMPT, reviewingOrd: 2, gateKind: 'escalation' },
  ] as unknown as CoreEvent[];
}

describe('studio#601 — the preselected Send back follows the denial source', () => {
  const gate: OpenGate = { runId: JUDGE_RUN, ord: 2, prompt: JUDGE_PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };

  it('an agent judge refusing a review the evaluator PASSED suggests nothing', () => {
    const events = judgeEvents('PASS');
    const model = sessionGateChoices({ runId: JUDGE_RUN, gate, units: JUDGE_UNITS, events, pool: [], roster: null })!;
    expect(model.reason).toBe('escalation');
    expect(model.recommended).toBeNull();
    expect(model.consequence).toBeNull();
    const move = recommendGateMove({
      runId: JUDGE_RUN, ord: 2, units: JUDGE_UNITS, verdict: gateVerdictFor(events, 2, JUDGE_PROMPT), verdictSummary: null,
      escalationGate: true, hasLift: false, restoredRetry: false, isPlanGate: false, planView: null, diffstat: null,
    });
    expect(move).toBeNull();
  });

  it('the same judge refusal over an evaluator FAIL still suggests Send back', () => {
    const model = sessionGateChoices({ runId: JUDGE_RUN, gate, units: JUDGE_UNITS, events: judgeEvents('FAIL'), pool: [], roster: null })!;
    expect(model.recommended).not.toBeNull();
    expect(model.choices[model.recommended!]!.key).toBe('send-back');
  });
});

// ── studio#612: the floor fix at a read-only phase's floor gate ────────────────────────────────

const FLOOR_RUN = 'r-floor';
const FLOOR_FIX_PROMPT = 'Unit 2 failed its deterministic floor (repo_checks): lint failed (exit 1) — confirm to retry the phase, approve with a note to have a seat other than this read-only phase\'s make that fix in the worktree and re-run only the floor, or reject to cancel the run';
const FLOOR_PLAIN_PROMPT = 'Unit 2 failed its deterministic floor (repo_checks): lint failed (exit 1) — confirm to retry the phase, or reject to cancel the run';
function floorUnits(readOnly: boolean): WorkUnit[] {
  return [
    makeUnit({ id: `${FLOOR_RUN}:build`, session_id: FLOOR_RUN, ord: 1, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
    { ...makeUnit({ id: `${FLOOR_RUN}:verify`, session_id: FLOOR_RUN, ord: 2, stage: 'test', role: 'evaluator', status: 'rejected', assigned_cli: 'codex' }),
      ...(readOnly ? { worktree_guarded: true, repo_checks_floor: true } : {}) } as WorkUnit,
  ];
}
const FLOOR_EVENTS = [
  { type: 'unitDispatched', session: FLOOR_RUN, ord: 2, attempt: 0, ts: NOW - 5000, seq: 1 },
  { type: 'repoChecksEvaluated', session: FLOOR_RUN, ord: 2, attempt: 0, ts: NOW - 2000, seq: 2, passed: false,
    criterion: 'repository checks pass on the head', skipped: [],
    checks: [{ name: 'lint', argv: ['npm', 'run', 'lint'], source: 'declared', exitCode: 1, timedOut: false, spawnError: null, durationMs: 4000, stdoutTail: null, stderrTail: 'src/a.ts 3:1 error no-unused-vars', classification: null, preExisting: [], regressions: [] }] },
  { type: 'gateEvaluated', session: FLOOR_RUN, ord: 2, ts: NOW - 1000, seq: 3,
    criterion: 'repository checks pass on the head', hasDeterministicFloor: true, deterministicPass: false,
    agentVerdict: null, agentReasoning: null, evaluatorPass: null, evaluatorPolicies: [],
    floorNote: 'a seat distinct from this read-only phase made the operator\'s fix after its verdict; the verdict was given on the pre-fix tree',
    denialReason: 'lint failed (exit 1)',
    denial: { source: 'repo_checks', reason: 'lint failed (exit 1)', claimId: null, ruleIds: [], deniedTool: null, phase: 'verify' },
    combined: false, judgeCli: null, judgeDistinct: null },
  { type: 'gateEscalated', session: FLOOR_RUN, ord: 2, ts: NOW - 900, seq: 4, attempt: 0, condition: 'floor_failed', denialSource: 'repo_checks' },
] as unknown as CoreEvent[];

describe('studio#612 — "Fix with a note" on a read-only phase\'s floor gate', () => {
  it('relabels the approve-with-note arm when the engine\'s prompt names the floor fix', () => {
    const gate: OpenGate = { runId: FLOOR_RUN, ord: 2, prompt: FLOOR_FIX_PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };
    const model = sessionGateChoices({ runId: FLOOR_RUN, gate, units: floorUnits(false), events: FLOOR_EVENTS, pool: [], roster: null })!;
    const fix = [...model.choices, ...model.overflow].find((c) => c.key === 'steer')!;
    expect(fix).toMatchObject({ label: FLOOR_FIX_LABEL, title: FLOOR_FIX_TITLE, needsNote: true, decision: { approve: true } });
    // The suggested move is that fix, and its consequence says what happens — never "reruns with".
    expect(model.choices[model.recommended!]!.key).toBe('steer');
    expect(model.consequence).toMatch(/A seat other than this phase makes the fix .*only the floor re-runs/);
    expect(model.consequence).not.toMatch(/reruns with/);
    // The floor note's disclosure rides the ⋯ details.
    expect(model.detailItems.some((d) => d.startsWith('Floor note: ') && d.includes('pre-fix tree'))).toBe(true);
  });

  it('reads the unit\'s plan-time flags when the prompt does not name the arm', () => {
    const gate: OpenGate = { runId: FLOOR_RUN, ord: 2, prompt: FLOOR_PLAIN_PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };
    const verdict = gateVerdictFor(FLOOR_EVENTS, 2, FLOOR_PLAIN_PROMPT);
    expect(isFloorFixGate(FLOOR_PLAIN_PROMPT, verdict, floorUnits(true), 2)).toBe(true);
    expect(isFloorFixGate(FLOOR_PLAIN_PROMPT, verdict, floorUnits(false), 2)).toBe(false);
    const model = sessionGateChoices({ runId: FLOOR_RUN, gate, units: floorUnits(true), events: FLOOR_EVENTS, pool: [], roster: null })!;
    expect([...model.choices, ...model.overflow].find((c) => c.key === 'steer')!.label).toBe(FLOOR_FIX_LABEL);
  });

  it('keeps "Approve and steer" on a floor gate that is not a read-only phase\'s', () => {
    const gate: OpenGate = { runId: FLOOR_RUN, ord: 2, prompt: FLOOR_PLAIN_PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };
    const model = sessionGateChoices({ runId: FLOOR_RUN, gate, units: floorUnits(false), events: FLOOR_EVENTS, pool: [], roster: null })!;
    const steer = [...model.choices, ...model.overflow].find((c) => c.key === 'steer')!;
    expect(steer.label).toBe('Approve and steer');
    expect(model.consequence ?? '').not.toMatch(/A seat other than/);
  });

  it('narrates the floor_fix rework scope as a fix by another seat, not a re-dispatch', () => {
    const ev = { type: 'unitReworkAmended', session: FLOOR_RUN, ord: 2, ts: NOW, seq: 9, amendment: 'drop the unused import', updatedDescription: 'verify', scope: 'floor_fix' } as unknown as CoreEvent;
    const text = narrate(ev, { phaseOf: () => 'verify' })?.text ?? '';
    expect(text).toMatch(/another seat makes it, then only the floor re-runs/);
    expect(text).not.toMatch(/re-dispatching/);
  });
});

// ── studio#606 (5): no Reassign on a Tool unit's gate ──────────────────────────────────────────

describe('studio#606 — a Tool unit is never offered to another seat', () => {
  const TOOL_RUN = 'r-tool';
  const units: WorkUnit[] = [
    makeUnit({ id: `${TOOL_RUN}:install`, session_id: TOOL_RUN, ord: 1, stage: 'build', status: 'rejected', assigned_cli: 'claude', tool_cmd: ['bash', '-lc', 'npm install'] }),
  ];
  const prompt = 'Unit 1 failed and triage escalated: npm install exited 1 — confirm to retry the phase, or reject to cancel the run';
  const events = [
    { type: 'unitDispatched', session: TOOL_RUN, ord: 1, attempt: 0, ts: NOW - 5000, seq: 1 },
    { type: 'stepFailed', session: TOOL_RUN, ord: 1, ts: NOW - 1000, seq: 2, detail: 'npm install exited 1' },
    { type: 'awaitingHuman', session: TOOL_RUN, ord: 1, ts: NOW - 800, seq: 3, prompt, gateKind: 'escalation' },
  ] as unknown as CoreEvent[];

  it('offers no Reassign inline or under ⋯', () => {
    expect(isToolUnitGate(units, 1)).toBe(true);
    const gate: OpenGate = { runId: TOOL_RUN, ord: 1, prompt, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };
    const model = sessionGateChoices({ runId: TOOL_RUN, gate, units, events, pool: ['claude', 'pi', 'opencode'], roster: null })!;
    expect(model.reason).toBe('escalation');
    expect([...model.choices, ...model.overflow].some((c) => c.key.startsWith('reassign:'))).toBe(false);
  });
});
