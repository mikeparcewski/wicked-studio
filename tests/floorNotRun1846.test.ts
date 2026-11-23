// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { WorkUnit } from '../src/api/types.js';
import type { OpenGate } from '../src/store/gates.js';
import { plainGateQuestion } from '../src/board/deskWords.js';
import { sessionGateChoices } from '../src/board/gateRowModel.js';
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
// A floor whose checks ran and failed keeps its own words.
const RED_PROMPT = 'Unit 4 failed its deterministic floor (repo_checks): repo checks failed: test (1 failing, head-only) — confirm to retry the phase, or reject to cancel the run';

const RUN = 'r-1846';
const NOW = 1_700_000_000_000;
const UNITS: WorkUnit[] = [
  makeUnit({ id: `${RUN}:fix`, session_id: RUN, ord: 3, stage: 'build', role: 'creator', status: 'done', assigned_cli: 'claude' }),
  makeUnit({ id: `${RUN}:verify`, session_id: RUN, ord: 4, stage: 'test', role: 'evaluator', status: 'rejected', assigned_cli: 'codex' }),
];

describe('a floor whose checks did not run (wicked-core#1846)', () => {
  it('is told apart from a failed check, in the engine’s words old and new', () => {
    expect(isFloorNotRun(NEW_PROMPT)).toBe(true);
    expect(isFloorNotRun(OLD_PROMPT)).toBe(true);
    expect(isFloorNotRun(RED_PROMPT)).toBe(false);
    expect(isFloorNotRun(undefined)).toBe(false);
  });

  it('headlines that the checks did not run and to free disk space, then retry', () => {
    for (const p of [NEW_PROMPT, OLD_PROMPT]) {
      expect(plainGateQuestion(p, 'escalation')).toBe('The checks did not run: this computer is low on disk space. Free some space, then retry?');
    }
    expect(plainGateQuestion(RED_PROMPT, 'escalation')).toBe('A required check failed — how should the step go on?');
  });

  it('is a refusal no other seat fixes: its retry card offers Retry and Stop, never Reassign', () => {
    for (const prompt of [NEW_PROMPT, OLD_PROMPT]) {
      expect(isLaunchRefusal(prompt, [], 4)).toBe(true);
      const gate: OpenGate = { runId: RUN, ord: 4, prompt, lifecycle: 'open', receivedAt: NOW };
      const model = sessionGateChoices({ runId: RUN, gate, units: UNITS, events: [], pool: ['codex', 'claude', 'pi'], roster: null });
      expect(model).not.toBeNull();
      expect(model!.reason).toBe('retry');
      const keys = [...model!.choices, ...model!.overflow].map((c) => c.key);
      expect(keys.filter((k) => k.startsWith('reassign:'))).toEqual([]);
      expect(keys).toContain('retry');
      expect(keys).toContain('stop');
    }
    expect(isLaunchRefusal(RED_PROMPT, [], 4)).toBe(false);
  });
});
