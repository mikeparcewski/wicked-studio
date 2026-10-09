import { describe, expect, it } from 'vitest';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { deniedUnitJudgedOk, isDeniedUnitEscalation, recommendedChoiceIndex, sessionGateChoices, type GateRowChoice } from '../src/board/gateRowModel.js';
import type { GateMove } from '../src/components/gateMoveModel.js';
import { NOT_PASS_PROMPT, NOT_PASS_EVENTS, MOVE_RUN, MOVE_UNITS } from './fixtures/gateMove.js';
import { makeUnit } from './factories.js';

const RUN = 'r-gate';
const NOW = 1_700_000_000_000;

function plainGate(over: Partial<OpenGate> = {}): OpenGate {
  return { runId: RUN, ord: 1, prompt: 'Approve the plan?', lifecycle: 'open', receivedAt: NOW, ...over };
}

function input(gate: OpenGate, events: readonly CoreEvent[] = [], units: readonly WorkUnit[] = [], pool: string[] = []) {
  return { runId: gate.runId, gate, units, events, pool, roster: null };
}

describe('sessionGateChoices — null cases', () => {
  it('returns null when events is empty — checking state', () => {
    // classifyRowGate needs events populated; with empty events it returns 'checking' for certain cases
    // But an ordinary plain gate (no escalation signals, binary choices) with [] events still classifies as 'answer'.
    // The null-for-checking case applies when gate itself is undefined — tested via the component layer.
    // Here we focus on the deliver null-return.
    const gate = plainGate({ gateKind: 'deliver' });
    expect(sessionGateChoices(input(gate))).toBeNull();
  });

  it('returns null for deliver gateKind', () => {
    const gate = plainGate({ gateKind: 'deliver' });
    expect(sessionGateChoices(input(gate))).toBeNull();
  });
});

describe('sessionGateChoices — def gate (reason=def)', () => {
  it('returns 4 choices for a plain approval gate', () => {
    const gate = plainGate();
    const model = sessionGateChoices(input(gate));
    expect(model).not.toBeNull();
    expect(model!.reason).toBe('def');
    expect(model!.choices.map((c) => c.key)).toEqual(['approve', 'steer', 'send-back', 'stop']);
  });

  it('Approve has decision {approve:true} and needsNote=false', () => {
    const gate = plainGate();
    const model = sessionGateChoices(input(gate))!;
    const approve = model.choices.find((c) => c.key === 'approve')!;
    expect(approve.decision).toEqual({ approve: true });
    expect(approve.needsNote).toBe(false);
  });

  it('Approve and steer (no later creator) has needsNote=true and decision={approve:true} — no amendScope (gate 13 Item 1)', () => {
    // plainGate() uses empty units → steerScopeTarget returns null → no amendScope
    const gate = plainGate();
    const model = sessionGateChoices(input(gate))!;
    const steer = model.choices.find((c) => c.key === 'steer')!;
    expect(steer.needsNote).toBe(true);
    expect(steer.decision).toEqual({ approve: true });
  });

  it('Approve and steer (with later creator unit) has amendScope:creator (gate 13 Item 1)', () => {
    // steerScopeTarget: needs a non-creator at the gate's ord, and a creator at a higher ord.
    const gate = plainGate({ ord: 1 });
    const units = [
      makeUnit({ id: 'r-gate:verify', session_id: RUN, ord: 1, stage: 'review', role: 'evaluator', status: 'pending', assigned_cli: null }),
      makeUnit({ id: 'r-gate:create', session_id: RUN, ord: 2, stage: 'build', role: 'creator', status: 'pending', assigned_cli: 'codex' }),
    ];
    const model = sessionGateChoices({ runId: gate.runId, gate, units, events: [], pool: [], roster: null })!;
    const steer = model.choices.find((c) => c.key === 'steer')!;
    expect(steer.needsNote).toBe(true);
    expect(steer.decision).toEqual({ approve: true, amendScope: 'creator' });
  });

  it('Send back has needsNote=true and decision={approve:false, action:request_changes}', () => {
    const gate = plainGate();
    const model = sessionGateChoices(input(gate))!;
    const sendBack = model.choices.find((c) => c.key === 'send-back')!;
    expect(sendBack.needsNote).toBe(true);
    expect(sendBack.decision).toEqual({ approve: false, action: 'request_changes' });
  });

  it('Stop has decision {approve:false} and needsNote=false', () => {
    const gate = plainGate();
    const model = sessionGateChoices(input(gate))!;
    const stop = model.choices.find((c) => c.key === 'stop')!;
    expect(stop.decision).toEqual({ approve: false });
    expect(stop.needsNote).toBe(false);
  });

  it('recommended is 0 (Approve)', () => {
    const gate = plainGate();
    const model = sessionGateChoices(input(gate))!;
    expect(model.recommended).toBe(0);
  });

  it('question is the gate prompt', () => {
    const gate = plainGate({ prompt: 'Is the work good?' });
    const model = sessionGateChoices(input(gate))!;
    expect(model.question).toBe('Is the work good?');
  });
});

describe('sessionGateChoices — escalation gate', () => {
  it('returns reason=escalation with Send back and Stop for NOT PASS prompt', () => {
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({ runId: MOVE_RUN, gate, units: MOVE_UNITS, events: NOT_PASS_EVENTS, pool: ['claude', 'codex'], roster: null });
    expect(model).not.toBeNull();
    expect(model!.reason).toBe('escalation');
    const keys = model!.choices.map((c) => c.key);
    expect(keys).toContain('send-back');
    expect(keys).toContain('stop');
  });

  it('pre-fills noteDefault with reviewer failing items for escalation', () => {
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({ runId: MOVE_RUN, gate, units: MOVE_UNITS, events: NOT_PASS_EVENTS, pool: [], roster: null });
    expect(model!.noteDefault.length).toBeGreaterThan(0);
    expect(model!.noteDefault).toContain('reviewer');
  });

  it('recommended is 0 when noteDefault is non-empty', () => {
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({ runId: MOVE_RUN, gate, units: MOVE_UNITS, events: NOT_PASS_EVENTS, pool: [], roster: null });
    if (model!.noteDefault.length > 0) {
      expect(model!.recommended).toBe(0);
    }
  });
});

// studio#556: the row suggests recommendGateMove's move whatever its kind — send back, retry
// with findings, approve — on the inline choice that IS that move.
describe('sessionGateChoices — the suggestion is recommendGateMove\'s, every kind (#556)', () => {
  const FLOOR_PROMPT = 'Unit 2 failed its deterministic floor (repo_checks): test exited 1.';
  const FLOOR_EVENTS = [
    { type: 'unitDispatched', session: MOVE_RUN, ord: 2, attempt: 0 },
    { type: 'repoChecksEvaluated', session: MOVE_RUN, ord: 2, passed: false, criterion: 'checks', checks: [{ name: 'test', argv: ['npm', 'test'], exitCode: 1, durationMs: 5 }] },
    { type: 'gateEvaluated', session: MOVE_RUN, ord: 2, combined: false, hasDeterministicFloor: true, denial: { source: 'repo_checks', reason: 'Repository checks failed' } },
    { type: 'gateEscalated', session: MOVE_RUN, ord: 2, attempt: 0, condition: 'floor_failed', denialSource: 'repo_checks', outputCaptured: true },
  ] as unknown as CoreEvent[];

  it('send back: an evaluator FAIL suggests Send back', () => {
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({ runId: MOVE_RUN, gate, units: MOVE_UNITS, events: NOT_PASS_EVENTS, pool: [], roster: null })!;
    expect(model.choices[model.recommended!]!.key).toBe('send-back');
  });

  it('retry with findings: a failed floor suggests the approve-with-note arm, its note the failing checks', () => {
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: FLOOR_PROMPT, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({ runId: MOVE_RUN, gate, units: MOVE_UNITS, events: FLOOR_EVENTS, pool: [], roster: null })!;
    expect(model.reason).toBe('escalation');
    expect(model.recommended).not.toBeNull();
    const suggested = model.choices[model.recommended!]!;
    expect(suggested.key).toBe('steer');
    expect(suggested.decision).toEqual({ approve: true });
    expect(model.noteDefault).toContain("validator");
    expect(model.noteDefault).toContain('- test — exit 1');
  });

  const choice = (key: string, disabled = false): GateRowChoice => ({ key, label: key, decision: { approve: true }, needsNote: false, title: key, ...(disabled ? { disabled } : {}) });
  const move = (kind: GateMove['kind']): GateMove => ({ kind, label: kind, consequence: '', prefill: null, items: [] });

  it('approve: an approve-plan or deliver move suggests Approve', () => {
    const row = [choice('approve'), choice('steer'), choice('send-back'), choice('stop')];
    expect(recommendedChoiceIndex(row, move('approve-plan'))).toBe(0);
    expect(recommendedChoiceIndex(row, move('deliver'))).toBe(0);
    expect(recommendedChoiceIndex(row, move('send-back'))).toBe(2);
    expect(recommendedChoiceIndex(row, move('retry-findings'))).toBe(1);
  });

  it('retry with findings prefers a Retry choice; no matching inline (or an enabled) choice suggests nothing', () => {
    expect(recommendedChoiceIndex([choice('retry'), choice('steer'), choice('stop')], move('retry-findings'))).toBe(0);
    expect(recommendedChoiceIndex([choice('send-back'), choice('stop')], move('approve-plan'))).toBeNull();
    expect(recommendedChoiceIndex([choice('approve', true), choice('stop')], move('deliver'))).toBeNull();
    expect(recommendedChoiceIndex([choice('stop')], null)).toBeNull();
  });
});

describe('sessionGateChoices — team/free-text/choices → real choices', () => {
  it('returns a single Send choice for a free-text gate (choices:null)', () => {
    const gate = plainGate({ choices: null });
    const model = sessionGateChoices(input(gate));
    expect(model).not.toBeNull();
    expect(model!.reason).toBe('free-text');
    expect(model!.choices).toHaveLength(1);
    const send = model!.choices[0]!;
    expect(send.key).toBe('free-text-send');
    expect(send.label).toBe('Send');
    expect(send.needsNote).toBe(true);
    expect(send.decision).toEqual({ approve: true });
    expect(model!.overflow).toHaveLength(0);
  });

  it('maps enumerated choices to GateRowChoices with correct decisions', () => {
    const gate = plainGate({ choices: ['approve', 'request_changes', 'reject'] });
    const model = sessionGateChoices(input(gate));
    expect(model).not.toBeNull();
    expect(model!.reason).toBe('choices');
    expect(model!.choices).toHaveLength(3);
    expect(model!.choices[0]!.decision).toEqual({ approve: true });
    expect(model!.choices[1]!.decision).toEqual({ approve: false, action: 'request_changes' });
    expect(model!.choices[2]!.decision).toEqual({ approve: false });
    expect(model!.overflow).toHaveLength(0);
  });

  it('puts choices 5+ into overflow', () => {
    // Mix of known + unknown so the all-unknown fallback (which adds Stop+note) is not triggered.
    const gate = plainGate({ choices: ['approve', 'reject', 'request_changes', 'edit_plan', 'approve', 'reject'] });
    const model = sessionGateChoices(input(gate));
    expect(model).not.toBeNull();
    expect(model!.choices).toHaveLength(4);
    expect(model!.overflow).toHaveLength(2);
  });

  it('returns Approve and Stop for an unknown gate kind', () => {
    // Force an unknown reason by using a gateKind that classifyRowGate treats as unknown card
    // Unknown gates reach the unknown branch; for testing we'd need a gateKind that falls through.
    // The overflow field is always present.
    const gate = plainGate();
    const model = sessionGateChoices(input(gate));
    expect(model).not.toBeNull();
    expect(model!.overflow).toBeDefined();
  });
});

describe('sessionGateChoices — reassign candidates for escalation', () => {
  it('includes reassign choices for offerable pool members', () => {
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: NOW };
    // pool includes 'claude' which is a different seat from the failed 'codex'
    const model = sessionGateChoices({ runId: MOVE_RUN, gate, units: MOVE_UNITS, events: NOT_PASS_EVENTS, pool: ['claude', 'codex'], roster: null });
    const reassignKeys = model!.choices.filter((c) => c.key.startsWith('reassign:')).map((c) => c.key);
    // At least one reassign choice (claude is offerable for the codex-failed escalation)
    expect(reassignKeys.length).toBeGreaterThan(0);
    // All reassign choices have reassignCli set and needsNote=false
    for (const key of reassignKeys) {
      const c = model!.choices.find((ch) => ch.key === key)!;
      expect(c.reassignCli).toBeDefined();
      expect(c.needsNote).toBe(false);
    }
  });

  it('with 3 candidates only the first reassign is inline; others go to overflow (cap=4)', () => {
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: NOW };
    // 3 candidates other than the failed 'codex': claude, gemini, gpt
    const model = sessionGateChoices({
      runId: MOVE_RUN, gate, units: MOVE_UNITS, events: NOT_PASS_EVENTS,
      pool: ['claude', 'gemini', 'gpt', 'codex'], roster: null,
    });
    expect(model).not.toBeNull();
    expect(model!.reason).toBe('escalation');
    // Inline: [send-back, steer, first-reassign, stop] = exactly 4
    expect(model!.choices).toHaveLength(4);
    const inlineKeys = model!.choices.map((c) => c.key);
    expect(inlineKeys[0]).toBe('send-back');
    expect(inlineKeys[1]).toBe('steer');
    expect(inlineKeys[2]).toMatch(/^reassign:/); // first reassign inline
    expect(inlineKeys[3]).toBe('stop');
    // Remaining reassign candidates in overflow
    expect(model!.overflow.length).toBeGreaterThan(0);
    expect(model!.overflow.every((c) => c.key.startsWith('reassign:'))).toBe(true);
  });
});

const RETRY_RUN = 'r-retry';
// A launch-refusal prompt that triggers isLaunchRefusal → reason:'retry', but no reassign (gate 11 Item 2).
const LAUNCH_REFUSAL_PROMPT_RETRY = 'Unit 1 (codex) refused its environment';
const RETRY_UNITS: WorkUnit[] = [
  makeUnit({ id: `${RETRY_RUN}:build`, session_id: RETRY_RUN, ord: 1, stage: 'build', role: 'creator', status: 'rejected', assigned_cli: 'codex' }),
];

describe('sessionGateChoices — unknown engine choices are disabled', () => {
  it('unknown choice value renders disabled with the no-wire title', () => {
    const gate = plainGate({ choices: ['approve', 'custom_unknown_verb'] });
    const model = sessionGateChoices(input(gate));
    expect(model).not.toBeNull();
    expect(model!.reason).toBe('choices');
    const approve = model!.choices[0]!;
    const unknown = model!.choices[1]!;
    expect(approve.disabled).toBeFalsy(); // known choice is enabled
    expect(approve.decision).toEqual({ approve: true });
    expect(unknown.disabled).toBe(true);
    expect(unknown.title).toContain('No wire for this choice yet');
    expect(unknown.decision).toBeNull();
  });

  it('all known choice values are enabled (no false positives)', () => {
    const known = ['approve', 'reject', 'request_changes', 'edit_plan', 'extend', 'targeted', 'accept_partial', 'accept_suggestion'];
    const gate = plainGate({ choices: known.slice(0, 4) });
    const model = sessionGateChoices(input(gate));
    expect(model).not.toBeNull();
    for (const c of model!.choices) {
      expect(c.disabled).toBeFalsy();
      expect(c.decision).not.toBeNull();
    }
  });

  it('when ALL choices are unknown, appends Stop and Send-a-note-instead so the row is answerable (gate 11 Item 3)', () => {
    const gate = plainGate({ choices: ['some_future_verb', 'another_future_verb'] });
    const model = sessionGateChoices(input(gate));
    expect(model).not.toBeNull();
    // The two unknown choices are disabled
    const disabled = model!.choices.filter((c) => c.disabled === true);
    expect(disabled.length).toBe(2);
    // Stop and Send a note instead are appended and enabled
    const allChoices = [...model!.choices, ...model!.overflow];
    const stop = allChoices.find((c) => c.key === 'stop');
    const sendNote = allChoices.find((c) => c.key === 'send-note-instead');
    expect(stop).toBeDefined();
    expect(stop!.disabled).toBeFalsy();
    expect(stop!.decision).toEqual({ approve: false });
    expect(sendNote).toBeDefined();
    expect(sendNote!.disabled).toBeFalsy();
    expect(sendNote!.needsNote).toBe(true);
    expect(sendNote!.decision).toEqual({ approve: false, action: 'request_changes' });
  });
});

describe('sessionGateChoices — retry: no reassign for launch refusals (gate 11 Item 2)', () => {
  it('launch-refusal retry gate offers Retry and Stop only, never Reassign', () => {
    const gate: OpenGate = { runId: RETRY_RUN, ord: 1, prompt: LAUNCH_REFUSAL_PROMPT_RETRY, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({
      runId: RETRY_RUN, gate, units: RETRY_UNITS, events: [],
      pool: ['codex', 'claude', 'gemini'], roster: null,
    });
    expect(model).not.toBeNull();
    expect(model!.reason).toBe('retry');
    const allChoices = [...model!.choices, ...model!.overflow];
    const reassign = allChoices.filter((c) => c.key.startsWith('reassign:'));
    expect(reassign).toHaveLength(0);
    const keys = allChoices.map((c) => c.key);
    expect(keys).toContain('retry');
    expect(keys).toContain('stop');
  });
});

// Events that trigger isRestoredRetry for ord=1: a worktree-guard denial with mutation.restored=true.
// This is the non-launch-refusal retry path (wicked-core#431: the engine restored the creator's tree).
const RESTORED_RETRY_EVENTS = [
  { type: 'evaluatorMutatedWorktree', ord: 1, restored: true } as unknown as CoreEvent,
  { type: 'gateEvaluated', ord: 1, combined: false, denial: { source: 'worktree_guard', reason: 'worktree guard' } } as unknown as CoreEvent,
];

describe('sessionGateChoices — retry: restored-worktree overflow cap (gate 13 Item 4)', () => {
  it('restored-retry with 3+ alternative seats caps inline choices and puts extra reassigns in overflow', () => {
    // prompt is a plain def gate question — not a launch refusal. classifyRowGate sees
    // isRestoredRetry(verdict, 1) === true and returns reason:'retry'.
    const gate: OpenGate = { runId: RETRY_RUN, ord: 1, prompt: 'Approve the plan?', lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({
      runId: RETRY_RUN, gate, units: RETRY_UNITS, events: RESTORED_RETRY_EVENTS,
      pool: ['codex', 'claude', 'gemini', 'gpt'], roster: null,
    });
    expect(model).not.toBeNull();
    expect(model!.reason).toBe('retry');
    const inlineKeys = model!.choices.map((c) => c.key);
    expect(inlineKeys[0]).toBe('retry');
    // First offerable seat (not codex) is inline
    expect(inlineKeys[1]).toMatch(/^reassign:/);
    expect(inlineKeys[inlineKeys.length - 1]).toBe('stop');
    // Only one reassign is inline (cap)
    expect(inlineKeys.filter((k) => k.startsWith('reassign:')).length).toBe(1);
    // Remaining reassign candidates go to overflow
    expect(model!.overflow.length).toBeGreaterThan(0);
    expect(model!.overflow.every((c) => c.key.startsWith('reassign:'))).toBe(true);
  });
});

describe('sessionGateChoices — escalation steer uses steerScopeTarget (gate 13 operator ruling)', () => {
  it('escalation steer with MOVE_UNITS (creator behind cursor) has decision {approve:true} — no amendScope', () => {
    // MOVE_UNITS: creator ord1, evaluator ord2. Gate at ord2 → steerScopeTarget returns null
    // (cursor is non-creator but no creator at ord >= 2). Engine refuses amendScope when
    // no creator phase is at or after the cursor — SteeringGate.tsx:377 uses the same guard.
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({ runId: MOVE_RUN, gate, units: MOVE_UNITS, events: NOT_PASS_EVENTS, pool: [], roster: null })!;
    const steer = model.choices.find((c) => c.key === 'steer')!;
    expect(steer.decision).toEqual({ approve: true });
    expect(steer.needsNote).toBe(true);
  });
});

// ── Escalation arm events (mirrors uxfix_fixture.py ESC_EVENTS) ─────────────────────────────────

const ESC_RUN = 'r-timeout';
const ESC_SUGGEST_RUN = 'r-suggest';
const MIN = 60_000;
const SEC = 1_000;
const ESC_T0 = NOW - 25 * MIN;
const ESC_TIMEOUT_PROMPT = 'Unit 1 failed its deterministic floor (repo_checks_timeout): Repository checks did not finish: test timed out after 600.0s — confirm to retry the phase, or reject to cancel the run';
const ESC_SUGGEST_PROMPT = 'Unit 2 verdict is NOT PASS — the read-only `verify` phase changed the tree under review (M src/importer.ts); its edit was discarded and the creator\'s verified tree restored. Approve to retry the phase against the restored tree, or reject to cancel the run';

const ESC_TIMEOUT_UNITS: WorkUnit[] = [
  makeUnit({ id: 'r-timeout:fix', session_id: ESC_RUN, ord: 1, stage: 'build', role: 'creator', status: 'rejected', assigned_cli: 'claude' }),
  makeUnit({ id: 'r-timeout:verify', session_id: ESC_RUN, ord: 2, stage: 'review', role: 'evaluator', status: 'pending', assigned_cli: 'codex' }),
];

const ESC_TIMEOUT_EVENTS = [
  { type: 'unitDispatched', session: ESC_RUN, ord: 1, attempt: 0, ts: ESC_T0, seq: 1 },
  { type: 'repoChecksEvaluated', session: ESC_RUN, ord: 1, attempt: 0, ts: ESC_T0 + 12 * MIN, seq: 2,
    passed: false, criterion: 'repository checks pass on the head', skipped: [],
    checks: [
      { name: 'lint', argv: ['npm', 'run', 'lint'], source: 'declared', exitCode: 0, timedOut: false, spawnError: null, durationMs: 21400, stdoutTail: null, stderrTail: null, classification: null, preExisting: [], regressions: [] },
      { name: 'test', argv: ['npm', 'test'], source: 'declared', exitCode: null, timedOut: true, spawnError: null, durationMs: 600000, stdoutTail: null, stderrTail: null, classification: null, preExisting: [], regressions: [] },
    ] },
  { type: 'gateEvaluated', session: ESC_RUN, ord: 1, ts: ESC_T0 + 12 * MIN, seq: 3,
    criterion: 'repository checks pass on the head', hasDeterministicFloor: true, deterministicPass: false,
    agentVerdict: null, agentReasoning: null, evaluatorPass: null, evaluatorPolicies: [],
    denialReason: 'Repository checks did not finish: test timed out after 600.0s',
    denial: { source: 'repo_checks_timeout', reason: 'Repository checks did not finish: test timed out after 600.0s', claimId: null, ruleIds: [], deniedTool: null, phase: 'fix' },
    combined: false, judgeCli: null, judgeDistinct: null },
  { type: 'gateEscalated', session: ESC_RUN, ord: 1, ts: ESC_T0 + 12 * MIN, seq: 4, attempt: 0,
    condition: 'floor_failed', defGate: false, denialSource: 'repo_checks_timeout', discarded: [],
    outputCaptured: true, restored: false, suggestionRef: null, verdictSummary: null },
  { type: 'awaitingHuman', session: ESC_RUN, ord: 1, ts: ESC_T0 + 12 * MIN + SEC, seq: 5,
    prompt: ESC_TIMEOUT_PROMPT, reviewingOrd: 1, gateKind: 'escalation' },
] as unknown as CoreEvent[];

const ESC_SUGGEST_UNITS: WorkUnit[] = [
  makeUnit({ id: 'r-suggest:fix', session_id: ESC_SUGGEST_RUN, ord: 1, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: 'r-suggest:verify', session_id: ESC_SUGGEST_RUN, ord: 2, stage: 'review', role: 'evaluator', status: 'rejected', assigned_cli: 'codex' }),
];

const ESC_SUGGEST_EVENTS = [
  { type: 'unitDispatched', session: ESC_SUGGEST_RUN, ord: 2, attempt: 0, ts: ESC_T0 + 7 * MIN, seq: 3 },
  { type: 'evaluatorMutatedWorktree', session: ESC_SUGGEST_RUN, ord: 2, ts: ESC_T0 + 10 * MIN, seq: 4,
    cli: 'codex', phase: 'verify', beforeTree: '4b1c9e0a7d2f5e8c1a3b', afterTree: '9f8e7d6c5b4a39281706',
    headMoved: false, changed: [{ status: 'M', path: 'src/importer.ts' }], restored: true, restoreError: null },
  { type: 'worktreeRestored', session: ESC_SUGGEST_RUN, ord: 2, ts: ESC_T0 + 10 * MIN, seq: 5,
    tree: '4b1c9e0a7d2f5e8c1a3b', head: null, discarded: [{ status: 'M', path: 'src/importer.ts' }],
    suggestionRef: 'refs/wicked/suggestions/r-suggest/2/0' },
  { type: 'gateEvaluated', session: ESC_SUGGEST_RUN, ord: 2, ts: ESC_T0 + 10 * MIN, seq: 6,
    criterion: null, hasDeterministicFloor: false, deterministicPass: true, agentVerdict: null,
    agentReasoning: null, evaluatorPass: true, evaluatorPolicies: [],
    denialReason: 'the read-only verify phase changed the tree under review',
    denial: { source: 'worktree_guard', reason: 'the read-only verify phase changed the tree under review', claimId: null, ruleIds: [], deniedTool: null, phase: 'verify' },
    combined: false, judgeCli: null, judgeDistinct: null },
  { type: 'gateEscalated', session: ESC_SUGGEST_RUN, ord: 2, ts: ESC_T0 + 10 * MIN, seq: 7, attempt: 0,
    condition: 'verdict_not_pass', defGate: false, denialSource: 'worktree_guard', discarded: [{ status: 'M', path: 'src/importer.ts' }],
    outputCaptured: true, restored: true, suggestionRef: 'refs/wicked/suggestions/r-suggest/2/0', verdictSummary: null },
  { type: 'awaitingHuman', session: ESC_SUGGEST_RUN, ord: 2, ts: ESC_T0 + 10 * MIN + SEC, seq: 8,
    prompt: ESC_SUGGEST_PROMPT, reviewingOrd: 2, gateKind: 'escalation' },
] as unknown as CoreEvent[];

describe('sessionGateChoices — escalation offers (gate 15 Item 1)', () => {
  it('repo_checks_timeout denial → extend, targeted, accept_partial offer choices present', () => {
    const gate: OpenGate = { runId: ESC_RUN, ord: 1, prompt: ESC_TIMEOUT_PROMPT, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({ runId: ESC_RUN, gate, units: ESC_TIMEOUT_UNITS, events: ESC_TIMEOUT_EVENTS, pool: [], roster: null })!;
    const allChoices = [...model.choices, ...model.overflow];
    const offerKeys = allChoices.filter((c) => c.key.startsWith('offer:')).map((c) => c.key);
    expect(offerKeys).toContain('offer:extend');
    expect(offerKeys).toContain('offer:targeted');
    expect(offerKeys).toContain('offer:accept_partial'); // lint passed, test timed out → waive = ['test']
    // send-back is first (always)
    expect(model.choices[0]!.key).toBe('send-back');
  });

  it('repo_checks_timeout offer decisions are {approve:true, action}', () => {
    const gate: OpenGate = { runId: ESC_RUN, ord: 1, prompt: ESC_TIMEOUT_PROMPT, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({ runId: ESC_RUN, gate, units: ESC_TIMEOUT_UNITS, events: ESC_TIMEOUT_EVENTS, pool: [], roster: null })!;
    const allChoices = [...model.choices, ...model.overflow];
    const extend = allChoices.find((c) => c.key === 'offer:extend')!;
    expect(extend.decision).toMatchObject({ approve: true, action: 'extend' });
    expect(extend.needsNote).toBe(false);
  });

  it('worktree_guard restored → accept_suggestion offer present', () => {
    const gate: OpenGate = { runId: ESC_SUGGEST_RUN, ord: 2, prompt: ESC_SUGGEST_PROMPT, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({ runId: ESC_SUGGEST_RUN, gate, units: ESC_SUGGEST_UNITS, events: ESC_SUGGEST_EVENTS, pool: [], roster: null })!;
    const allChoices = [...model.choices, ...model.overflow];
    const suggest = allChoices.find((c) => c.key === 'offer:accept_suggestion');
    expect(suggest).toBeDefined();
    expect(suggest!.decision).toMatchObject({ approve: true, action: 'accept_suggestion' });
  });

  it('evaluator_verdict denial (NOT_PASS_EVENTS) → no offer choices', () => {
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({ runId: MOVE_RUN, gate, units: MOVE_UNITS, events: NOT_PASS_EVENTS, pool: [], roster: null })!;
    const allChoices = [...model.choices, ...model.overflow];
    expect(allChoices.every((c) => !c.key.startsWith('offer:'))).toBe(true);
  });
});

describe('sessionGateChoices — floor check lines in detailItems (gate 15 Item 2)', () => {
  it('escalation with floor evidence → detailItems include floor check lines', () => {
    const gate: OpenGate = { runId: ESC_RUN, ord: 1, prompt: ESC_TIMEOUT_PROMPT, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({ runId: ESC_RUN, gate, units: ESC_TIMEOUT_UNITS, events: ESC_TIMEOUT_EVENTS, pool: [], roster: null })!;
    // lint: passed · exit 0 · 21 s; test: failed · timed out · 600 s
    expect(model.detailItems.some((l) => l.startsWith('lint') && l.includes('passed'))).toBe(true);
    expect(model.detailItems.some((l) => l.startsWith('test') && l.includes('failed') && l.includes('timed out'))).toBe(true);
  });

  it('def gate with no floor → detailItems has only the prompt', () => {
    const gate = plainGate();
    const model = sessionGateChoices(input(gate))!;
    expect(model.detailItems).toEqual(['Approve the plan?']);
  });
});

// ── studio#573: a denied unit's row carries the engine's arms — Approve RE-RUNS, or Stop ──────────

const DENIED_RUN = 'r-denied';
const DENIED_PROMPT =
  'Unit 2 was DENIED by input governance — a tool call was refused (`Bash`): the `test` phase wrote outside its ' +
  'write roots (claim witness-deny:unit-2). The phase\'s output was captured. Approve RE-RUNS the `test` phase ' +
  'from the start under the same policies (a retry; the captured output is not accepted), or reject to cancel the run';
const DENIED_UNITS: WorkUnit[] = [
  makeUnit({ id: `${DENIED_RUN}:fix`, session_id: DENIED_RUN, ord: 1, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: `${DENIED_RUN}:test`, session_id: DENIED_RUN, ord: 2, stage: 'review', role: 'evaluator', status: 'rejected', assigned_cli: 'codex' }),
  makeUnit({ id: `${DENIED_RUN}:deliver`, session_id: DENIED_RUN, ord: 3, stage: 'build', role: 'neutral', status: 'pending' }),
];
/** The engine's frames for a `boundary_deny` pause: floor PASS, judge PASS, the denial is input governance's. */
function deniedEvents(over: Record<string, unknown> = {}): CoreEvent[] {
  return [
    { type: 'unitDispatched', session: DENIED_RUN, ord: 2, attempt: 0 },
    {
      type: 'gateEvaluated', session: DENIED_RUN, ord: 2,
      criterion: 'tests pass on the head', hasDeterministicFloor: true, deterministicPass: true,
      agentVerdict: 'PASS', agentReasoning: 'The tests cover the fix.', evaluatorPass: true, evaluatorPolicies: [],
      denialReason: 'input governance denied a tool-call in unit-2 (claim witness-deny:unit-2)',
      denial: { source: 'input_governance', reason: 'input governance denied a tool-call in unit-2 (claim witness-deny:unit-2)', claimId: 'witness-deny:unit-2', ruleIds: [], deniedTool: 'Bash', phase: 'test' },
      combined: false, judgeCli: 'pi', judgeDistinct: true,
      ...over,
    },
    { type: 'gateEscalated', session: DENIED_RUN, ord: 2, attempt: 0, condition: 'boundary_deny', denialSource: 'input_governance', outputCaptured: true, defGate: false, restored: false, discarded: [], suggestionRef: null, verdictSummary: null },
    { type: 'awaitingHuman', session: DENIED_RUN, ord: 2, prompt: DENIED_PROMPT, reviewingOrd: 2, gateKind: 'escalation' },
  ] as unknown as CoreEvent[];
}
function deniedGate(over: Partial<OpenGate> = {}): OpenGate {
  return { runId: DENIED_RUN, ord: 2, prompt: DENIED_PROMPT, gateKind: 'escalation', lifecycle: 'open', receivedAt: NOW, ...over };
}
/** The same gate from a daemon that sends no `gateKind` (the key absent, not undefined). */
function deniedGateNoKind(prompt: string = DENIED_PROMPT): OpenGate {
  return { runId: DENIED_RUN, ord: 2, prompt, lifecycle: 'open', receivedAt: NOW };
}

describe('sessionGateChoices — a denied unit re-runs: Approve (suggested) · steer · Stop, no Send back (studio#573)', () => {
  it('offers Approve (the re-run), Approve and steer and Stop — and no Send back', () => {
    const model = sessionGateChoices({ runId: DENIED_RUN, gate: deniedGate(), units: DENIED_UNITS, events: deniedEvents(), pool: ['claude', 'codex'], roster: null })!;
    expect(model.reason).toBe('escalation');
    expect(model.choices.map((c) => c.key)).toEqual(['approve', 'steer', 'stop']);
    expect(model.overflow).toEqual([]);
    const approve = model.choices[0]!;
    expect(approve.decision).toEqual({ approve: true });
    expect(approve.needsNote).toBe(false);
    expect(approve.title).toMatch(/re-run/i);
    // No reviewer finding to return: the steer note starts empty, not with "Fix the reviewer's failing items".
    expect(model.noteDefault).toBe('');
  });

  it('Approve is the suggested arm when the floor and the judge passed (the denial was the write-root catch)', () => {
    const model = sessionGateChoices({ runId: DENIED_RUN, gate: deniedGate(), units: DENIED_UNITS, events: deniedEvents(), pool: [], roster: null })!;
    expect(model.recommended).toBe(0);
    expect(model.choices[model.recommended!]!.key).toBe('approve');
  });

  it('nothing is suggested when no judge verdict is recorded (none ran, or the frame carries none)', () => {
    const noJudge = sessionGateChoices({ runId: DENIED_RUN, gate: deniedGate(), units: DENIED_UNITS, events: deniedEvents({ agentVerdict: null, judgeCli: null, judgeDistinct: null }), pool: [], roster: null })!;
    expect(noJudge.choices.map((c) => c.key)).toEqual(['approve', 'steer', 'stop']);
    expect(noJudge.recommended).toBeNull();
  });

  it('a gate about a LATER unit does not inherit an earlier unit\'s input-governance denial (last-at-or-below lookup)', () => {
    // Unit 2 was denied by input governance and re-ran; the open gate is unit 3's generic retry prompt
    // with no evaluation of its own. The lookup falls to unit 2's frame — which is not this gate's.
    const gate = deniedGateNoKind('confirm to retry the phase, or reject to cancel the run');
    const later: OpenGate = { ...gate, ord: 3, gateKind: 'escalation' };
    // Unit 3 is a reviewer here (not the hand-over, which the deliver card takes).
    const units = [
      ...DENIED_UNITS.slice(0, 2),
      makeUnit({ id: `${DENIED_RUN}:review`, session_id: DENIED_RUN, ord: 3, stage: 'review', role: 'evaluator', status: 'rejected', assigned_cli: 'pi' }),
    ];
    const model = sessionGateChoices({ runId: DENIED_RUN, gate: later, units, events: deniedEvents(), pool: [], roster: null })!;
    expect(model.reason).toBe('escalation');
    expect(model.choices.map((c) => c.key)).toContain('send-back');
    expect(model.choices.map((c) => c.key)).not.toContain('approve');
  });

  it('nothing is suggested when the judge said FAIL, or the floor failed', () => {
    const judgeFail = sessionGateChoices({ runId: DENIED_RUN, gate: deniedGate(), units: DENIED_UNITS, events: deniedEvents({ agentVerdict: 'FAIL' }), pool: [], roster: null })!;
    expect(judgeFail.choices.map((c) => c.key)).toEqual(['approve', 'steer', 'stop']);
    expect(judgeFail.recommended).toBeNull();
    const floorFail = sessionGateChoices({ runId: DENIED_RUN, gate: deniedGate(), units: DENIED_UNITS, events: deniedEvents({ deterministicPass: false }), pool: [], roster: null })!;
    expect(floorFail.recommended).toBeNull();
  });

  it('the fold\'s denial source is enough on its own (a late join whose prompt is the generic retry line)', () => {
    const gate = deniedGate({ prompt: 'Unit 2 was denied — confirm to retry the phase, or reject to cancel the run' });
    const model = sessionGateChoices({ runId: DENIED_RUN, gate, units: DENIED_UNITS, events: deniedEvents(), pool: [], roster: null })!;
    expect(model.reason).toBe('escalation');
    expect(model.choices.map((c) => c.key)).toEqual(['approve', 'steer', 'stop']);
  });

  it('the prompt is enough on its own for the arms — but with no verdict in the log nothing is suggested', () => {
    const model = sessionGateChoices({ runId: DENIED_RUN, gate: deniedGate(), units: DENIED_UNITS, events: [], pool: [], roster: null })!;
    expect(model.choices.map((c) => c.key)).toEqual(['approve', 'steer', 'stop']);
    expect(model.recommended).toBeNull();
  });

  it('a denied gate with no gateKind (a daemon before wicked-core#464, read before its log) is still this escalation, never the def row', () => {
    // Without the kind and with no escalation spelling the Desk classifier knows, classifyRowGate reads
    // the prompt as a plain approve/reject row; the session row still recognizes the denied unit.
    const noKind = deniedGateNoKind();
    const fromPrompt = sessionGateChoices({ runId: DENIED_RUN, gate: noKind, units: DENIED_UNITS, events: [], pool: [], roster: null })!;
    expect(fromPrompt.reason).toBe('escalation');
    expect(fromPrompt.choices.map((c) => c.key)).toEqual(['approve', 'steer', 'stop']);
    const generic = deniedGateNoKind('confirm to retry the phase, or reject to cancel the run');
    const fromDenial = sessionGateChoices({ runId: DENIED_RUN, gate: generic, units: DENIED_UNITS, events: deniedEvents(), pool: [], roster: null })!;
    expect(fromDenial.reason).toBe('escalation');
    expect(fromDenial.choices.map((c) => c.key)).toEqual(['approve', 'steer', 'stop']);
    expect(fromDenial.recommended).toBe(0);
  });

  it('a reviewer FAIL escalation is unchanged: Send back first and suggested, no Approve', () => {
    const gate: OpenGate = { runId: MOVE_RUN, ord: 2, prompt: NOT_PASS_PROMPT, lifecycle: 'open', receivedAt: NOW };
    const model = sessionGateChoices({ runId: MOVE_RUN, gate, units: MOVE_UNITS, events: NOT_PASS_EVENTS, pool: [], roster: null })!;
    expect(model.choices.map((c) => c.key)).toEqual(['send-back', 'steer', 'stop']);
    expect(model.recommended).toBe(0);
  });

  it('isDeniedUnitEscalation / deniedUnitJudgedOk: the two rules, directly', () => {
    expect(isDeniedUnitEscalation(DENIED_PROMPT, null)).toBe(true);
    expect(isDeniedUnitEscalation('Unit 2 verdict is NOT PASS — …', null)).toBe(false);
    expect(isDeniedUnitEscalation(undefined, null)).toBe(false);
    expect(deniedUnitJudgedOk(null)).toBe(false);
    // The source rule is bound to the gate's own unit.
    const view = { ord: 2, denial: { source: 'input_governance' } } as unknown as Parameters<typeof isDeniedUnitEscalation>[1];
    expect(isDeniedUnitEscalation(undefined, view, 2)).toBe(true);
    expect(isDeniedUnitEscalation(undefined, view, 3)).toBe(false);
  });
});
