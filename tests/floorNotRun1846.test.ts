// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { CoreEvent, WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { plainGateQuestion } from '../src/board/deskWords.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
import { classifyRowGate } from '../src/board/questionRow.js';
import { isFloorNotRun, isLaunchRefusal } from '../src/components/gateVerdictModel.js';
import { makeUnit } from './factories.js';

/**
 * wicked-core#1846: a floor that never ran its checks because the computer was short of disk space. Both prompts are
 * the engine's own words, built from its writers:
 *  - the cause is `repo_checks.rs` `disk_guard` ("environment: the host has … no check ran. Free disk space, then
 *    retry the step — this is not a failure of the change"), behind `denial_reason` ("repo checks floor could not
 *    run: …");
 *  - OLD_PROMPT is the floor-fix arm of `actor.rs` `denial_gate_prompt_body` before core#1846 (cert t12r2-j4-retry):
 *    the reason cut at 240 characters (`reason_head`), the floor fix and the operator-judgment offer;
 *  - NEW_PROMPT is its core#1846 arm: "Unit N's checks did not run: <cause>. Approve to retry the step …".
 */
const CAUSE = "the host has 3.2 GiB free on the check cache's volume, under the floor's minimum of 15 GiB (WICKED_FLOOR_MIN_FREE_GB); no check ran. Free disk space, then retry the step — this is not a failure of the change";
const OLD_PROMPT = "Unit 4 failed its deterministic floor (repo_checks): repo checks floor could not run: environment: the host has 3.2 GiB free on the check cache's volume, under the floor's minimum of 15 GiB (WICKED_FLOOR_MIN_FREE_GB); no check ran. Free disk space, then retry the step — this is not a failure … — confirm to retry the phase, approve with a note to have a seat other than this read-only phase's make that fix in the worktree and re-run only the floor, judge it yourself with a written rationale when the evidence shows the failures are not the work's (action `operator_judgment`: it overrides the failed floor, labelled \"floor overridden by operator\" on the run and the delivery; every other layer still denies and QE acceptance is still required), or reject to cancel the run";
const NEW_PROMPT = `Unit 4's checks did not run: ${CAUSE}. Approve to retry the step once that is fixed (its checks run again), or reject to cancel the run`;
// The disk stopped the floor part way (a check ran and passed first): core says "did not finish".
const PART_PROMPT = "Unit 4's checks did not finish: the disk was nearly full during `test` (1.0 GiB free, under the stop line of 5 GiB); the check was stopped. Free disk space, then retry; not a failure of the change. Approve to retry the step once that is fixed (its checks run again), or reject to cancel the run";
// A floor whose checks ran and failed keeps its own words.
const RED_PROMPT = 'Unit 4 failed its deterministic floor (repo_checks): repo checks failed: test (1 failing, head-only) — confirm to retry the phase, or reject to cancel the run';

const RUN = 'r-1846';
const NOW = 1_700_000_000_000;
// The frames the engine sends for that gate (shapes as `e2e/uxfix_fixture.py` GATE_MOVE_EVENTS): the floor's denial,
// the escalation, and the pause carrying its kind.
const DENIAL_REASON = "repo checks floor could not run: environment: " + CAUSE;
const EVENTS = (prompt: string): CoreEvent[] => [
  { type: 'gateEvaluated', session: RUN, ord: 4, ts: NOW, seq: 1, combined: false, hasDeterministicFloor: true, deterministicPass: false,
    denial: { claimId: null, deniedTool: null, phase: 'unit-4', reason: DENIAL_REASON, ruleIds: [], source: 'repo_checks' }, denialReason: DENIAL_REASON },
  { type: 'gateEscalated', session: RUN, ord: 4, ts: NOW, seq: 2, attempt: 0, condition: 'floor_failed', defGate: false, denialSource: 'repo_checks',
    discarded: [], outputCaptured: true, restored: false, suggestionRef: null, verdictSummary: DENIAL_REASON },
  { type: 'awaitingHuman', session: RUN, ord: 4, ts: NOW + 1, seq: 3, prompt, gateKind: 'escalation' },
] as unknown as CoreEvent[];
const UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 3, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: `${RUN}:verify`, session_id: RUN, ord: 4, stage: 'test', role: 'evaluator', status: 'rejected', assigned_cli: 'codex' }),
];

describe('a floor whose checks did not run (wicked-core#1846)', () => {
  it('is told apart from a failed check, in the engine’s words old and new', () => {
    expect(isFloorNotRun(NEW_PROMPT)).toBe(true);
    expect(isFloorNotRun(PART_PROMPT)).toBe(true);
    expect(isFloorNotRun(OLD_PROMPT)).toBe(true);
    expect(isFloorNotRun(RED_PROMPT)).toBe(false);
    expect(isFloorNotRun(undefined)).toBe(false);
  });

  it('headlines that the checks did not run and to free disk space, then retry', () => {
    for (const p of [NEW_PROMPT, OLD_PROMPT, PART_PROMPT]) {
      expect(plainGateQuestion(p, 'escalation')).toBe('The checks did not run: this computer is low on disk space. Free some space, then retry?');
    }
    // A cause that is not the disk keeps the plain words and points at the gate's own text.
    expect(plainGateQuestion("Unit 4's checks did not run: the check cache's volume is read-only. Approve to retry the step once that is fixed (its checks run again), or reject to cancel the run", 'escalation'))
      .toBe('The checks did not run on this computer. Fix what the gate names, then retry?');
    expect(plainGateQuestion(RED_PROMPT, 'escalation')).toBe('A required check failed — how should the step go on?');
  });

  it('is a refusal no other seat fixes: its retry card offers Retry and Stop, never Reassign', () => {
    for (const prompt of [NEW_PROMPT, OLD_PROMPT, PART_PROMPT]) {
      expect(isLaunchRefusal(prompt, [], 4)).toBe(true);
      // As the engine sends it: the escalation kind on the gate and on its pause frame, with the floor's denial in the log
      // (xreview r1: the kind used to route it to the escalation card, which offered Reassign and Send back).
      for (const [gateKind, events] of [[undefined, []], ['escalation', EVENTS(prompt)], [undefined, EVENTS(prompt)]] as const) {
        const gate: OpenGate = { runId: RUN, ord: 4, prompt, lifecycle: 'open', receivedAt: NOW, ...(gateKind !== undefined ? { gateKind } : {}) };
        expect(classifyRowGate({ runId: RUN, gate, units: UNITS, events })).toEqual({ kind: 'card', reason: 'retry' });
        const model = sessionGateChoices({ runId: RUN, gate, units: UNITS, events, pool: ['codex', 'claude', 'pi'], roster: null });
        expect(model).not.toBeNull();
        expect(model!.reason).toBe('retry');
        expect([...model!.choices, ...model!.overflow].map((c) => c.key)).toEqual(['retry', 'stop']);
      }
    }
    expect(isLaunchRefusal(RED_PROMPT, [], 4)).toBe(false);
    const red: OpenGate = { runId: RUN, ord: 4, prompt: RED_PROMPT, lifecycle: 'open', receivedAt: NOW, gateKind: 'escalation' };
    expect(classifyRowGate({ runId: RUN, gate: red, units: UNITS, events: [] })).toEqual({ kind: 'card', reason: 'escalation' });
  });
});
