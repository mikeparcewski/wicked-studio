import { describe, expect, it } from 'vitest';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { approveRetriesPhase, FLOOR_FIX_LABEL, FLOOR_FIX_TITLE, isToolUnitGate, RETRY_NOTE_LABEL, RETRY_NOTE_TITLE, sessionGateChoices } from '../src/board/gateRowModel.js';
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

describe('studio#832 — a verify FAIL escalation\'s approve-with-note re-runs the step, and says so', () => {
  const gate: OpenGate = { runId: JUDGE_RUN, ord: 2, prompt: 'Unit 2 verdict is NOT PASS (the evaluator\'s verdict is FAIL) — confirm to retry the phase, request changes to send the review back to the creator phase, or reject to cancel the run', lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };

  it('labels the steer arm "Retry this step with a note", never an approve that moves on', () => {
    const model = sessionGateChoices({ runId: JUDGE_RUN, gate, units: JUDGE_UNITS, events: judgeEvents('FAIL'), pool: [], roster: null })!;
    const steer = [...model.choices, ...model.overflow].find((c) => c.key === 'steer')!;
    expect(steer).toMatchObject({ label: RETRY_NOTE_LABEL, title: RETRY_NOTE_TITLE, needsNote: true, decision: { approve: true } });
    expect(steer.title).not.toMatch(/next step/);
    expect(model.choices.map((c) => c.label)).toEqual(['Send back', RETRY_NOTE_LABEL, 'Stop']);
  });

  it('knows the engine\'s retry prompts and nothing else', () => {
    expect(approveRetriesPhase(gate.prompt)).toBe(true);
    expect(approveRetriesPhase('Unit 2 verdict is NOT PASS — … Approve to retry the phase against the restored tree, or reject to cancel the run')).toBe(true);
    expect(approveRetriesPhase('Unit 3 escalated: the reviewer disagreed — approve to continue, or reject to cancel the run')).toBe(false);
  });
});

// PRODUCT-WORKS J6 (run 9bd0f728, unit 8): the same-seat-evaluator escalation's prompt says "…and approve to
// retry, or reject…", which the phrase test missed, so the arm read "Approve with a note for the next step". The
// engine amended unit 8 itself and re-ran it (13 min) — the note never reached a next step.
const J6_RUN = 'r-j6';
const J6_PROMPT = 'Unit 8 (codex) reviewed work built on its own seat: unit 8 checks work built on `codex` and ran on that same seat; the run requires a distinct evaluator (distinct_evaluator) — reassign it to a distinct signed-in seat and approve to re-run, or relaunch with reduced assurance. Reassign the unit to a distinct seat (sign one in first if needed) and approve to retry, or reject to stop the run';
const J6_UNITS: WorkUnit[] = [
  makeUnit({ id: `${J6_RUN}:build`, session_id: J6_RUN, ord: 6, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: `${J6_RUN}:architecture`, session_id: J6_RUN, ord: 7, stage: 'recon', role: 'neutral', status: 'done', assigned_cli: 'codex' }),
  makeUnit({ id: `${J6_RUN}:test`, session_id: J6_RUN, ord: 8, stage: 'test', role: 'evaluator', status: 'rejected', assigned_cli: 'codex' }),
];
const J6_EVENTS = [
  { type: 'unitDispatched', session: J6_RUN, ord: 8, attempt: 0, ts: NOW - 5000, seq: 1 },
  { type: 'gateEscalated', session: J6_RUN, ord: 8, ts: NOW - 900, seq: 2, attempt: 0, condition: 'dead_seat', denialSource: 'same_seat_evaluator', defGate: true, outputCaptured: true, verdictSummary: 'unit 8 checks work built on `codex` and ran on that same seat' },
  { type: 'awaitingHuman', session: J6_RUN, ord: 8, ts: NOW - 800, seq: 3, prompt: J6_PROMPT, reviewingOrd: 8, gateKind: 'escalation' },
] as unknown as CoreEvent[];

describe('PRODUCT-WORKS J6 — an escalation\'s note goes to the step that re-runs, and the card says so', () => {
  const gate: OpenGate = { runId: J6_RUN, ord: 8, prompt: J6_PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };

  it('labels the note arm "Retry this step with a note" whatever the prompt\'s wording', () => {
    expect(approveRetriesPhase(J6_PROMPT)).toBe(false); // the phrase test alone missed it
    const model = sessionGateChoices({ runId: J6_RUN, gate, units: J6_UNITS, events: J6_EVENTS, pool: ['claude', 'codex'], roster: null })!;
    const steer = [...model.choices, ...model.overflow].find((c) => c.key === 'steer')!;
    expect(steer).toMatchObject({ label: RETRY_NOTE_LABEL, title: RETRY_NOTE_TITLE, needsNote: true, decision: { approve: true } });
    // The amendment lands on the cursor unit (no amendScope), which is the step that re-runs.
    expect(steer.decision).not.toHaveProperty('amendScope');
    for (const c of [...model.choices, ...model.overflow]) expect(`${c.label} ${c.title}`).not.toMatch(/next step/);
  });

  it('keeps "Approve and steer" at a gate whose approve moves the run on (a def gate)', () => {
    const def: OpenGate = { runId: J6_RUN, ord: 8, prompt: 'Approve the output of unit 7 (architecture)', lifecycle: 'open', receivedAt: NOW, gateKind: 'def' };
    const model = sessionGateChoices({ runId: J6_RUN, gate: def, units: J6_UNITS.map((u) => (u.ord === 8 ? { ...u, status: 'pending' } : u)), events: [], pool: [], roster: null })!;
    expect([...model.choices, ...model.overflow].find((c) => c.key === 'steer')!.label).toBe('Approve and steer');
  });
});

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

  it('a floor gate that is not a read-only phase\'s offers the plain retry with a note (studio#832: its approve re-runs the phase)', () => {
    const gate: OpenGate = { runId: FLOOR_RUN, ord: 2, prompt: FLOOR_PLAIN_PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };
    const model = sessionGateChoices({ runId: FLOOR_RUN, gate, units: floorUnits(false), events: FLOOR_EVENTS, pool: [], roster: null })!;
    const steer = [...model.choices, ...model.overflow].find((c) => c.key === 'steer')!;
    expect(steer.label).toBe(RETRY_NOTE_LABEL);
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
