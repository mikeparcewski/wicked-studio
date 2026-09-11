import type { CoreEvent, WorkUnit } from '../../src/api/types.js';
import { makeUnit } from '../factories.js';

/**
 * Recorded gate-evidence frames from the Phase 3 re-run of the acceptance program
 * (wicked-studio#250 — findings F-3R2-006 / F-3R2-018): a governed `bug` run on a fresh
 * wicked-crew 0.7.28 / core-ts 0.7.18 rig, captured off `GET /runs/:id/events` at three gates:
 *
 *  - G4 — the pre-run gate BEFORE unit #4 (`verify`): the operator is really answering the
 *    `fix` phase's verdict, which the wire carried as the ord-3 `gateEvaluated`
 *    (`hasDeterministicFloor: true`, `agentVerdict: "pass"`) and the card never rendered.
 *  - G5 — the ESCALATED gate on unit #4: the `verify` phase (`executes_code: false`) changed the
 *    worktree it was reviewing, so wicked-core's worktree guard (F-036) denied it —
 *    `evaluatorMutatedWorktree` + a `gateEvaluated` whose `denial.source` is `worktree_guard`,
 *    then `gateEscalated` / `awaitingHuman` ("verdict is NOT PASS"). The card said only the
 *    prompt; the reason, the changed path and the restore command were in the thread.
 *  - G6 — the pre-run gate BEFORE unit #5 (`deliver`) after the retry: the engine ran the repo's
 *    own checks (F-039, `repoChecksEvaluated`: typecheck / lint / test, exit codes + durations)
 *    and the ord-4 `gateEvaluated` passed on that floor.
 *
 * The gate-relevant subset of the recording (`g4-events.json` / `g5-events.json` /
 * `g6-events.json`): every `awaitingHuman`, `gateEvaluated`, `gateDecided`, `gateEscalated`,
 * `unitDenied`, `unitDone`, `resumed`, `unitDispatched`, `unitExecuting`, `unitReworkAmended`,
 * `evaluatorMutatedWorktree` and `repoChecksEvaluated` frame between the first gate and G6, with
 * the recording's `seq` and `ts`; the high-volume frames between them (`unitOutputDelta`,
 * `governanceHookFired`, council frames, `dataUsed`, `unitOutputCaptured`, …) are omitted. Every
 * field the surfaces read is the wire's byte for byte — criterion, reasoning, verdicts, denial
 * prose, check names / exit codes / durations / sources. Scrubbed: the run id, the operator's
 * intent text (prompts, the retry amendment's re-stated description), the rig's worktree paths and
 * the test-runner tails (replaced by short generic stand-ins), and the two git tree ids (synthetic
 * hex of the same width — the denial prose and the amendment that quote them keep their exact
 * wording). Only `REPO_CHECKS_FAIL` is synthetic, and says so.
 */

export const GATE_RUN = 'run-3r2';

/** Synthetic stand-ins for the two tree ids the worktree guard compared (same width as git's). */
export const TREE_BEFORE = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
export const TREE_AFTER = 'f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1';

const INTENT = 'fix the reported issue';

/** The five def-driven units of the `bug` workflow as the run's snapshot names them. */
export const GATE_UNITS: WorkUnit[] = [
  makeUnit({ id: `${GATE_RUN}:triage`, session_id: GATE_RUN, ord: 1, stage: 'recon', status: 'done' }),
  makeUnit({ id: `${GATE_RUN}:reproduce`, session_id: GATE_RUN, ord: 2, stage: 'recon', status: 'done' }),
  makeUnit({ id: `${GATE_RUN}:fix`, session_id: GATE_RUN, ord: 3, stage: 'build', status: 'done' }),
  makeUnit({ id: `${GATE_RUN}:verify`, session_id: GATE_RUN, ord: 4, stage: 'test', status: 'pending' }),
  makeUnit({
    id: `${GATE_RUN}:deliver`,
    session_id: GATE_RUN,
    ord: 5,
    stage: 'build',
    status: 'pending',
    tool_cmd: ['bash', '-lc', 'gh pr create --fill'],
  }),
];

/** An UNGATED phase's evaluation (triage / reproduce): no floor, no judge, default-allow. */
function ungated(ord: number, seq: number, ts: number): CoreEvent {
  return {
    type: 'gateEvaluated',
    session: GATE_RUN,
    ord,
    seq,
    ts,
    criterion: null,
    hasDeterministicFloor: false,
    deterministicPass: true,
    agentVerdict: null,
    agentReasoning: null,
    evaluatorPass: true,
    evaluatorPolicies: [],
    denialReason: null,
    denial: null,
    combined: true,
  };
}

/** The run up to and including the G4 gate — the pre-run gate before unit #4 (`verify`). */
export const G4_EVENTS: CoreEvent[] = [
  { type: 'awaitingHuman', session: GATE_RUN, ord: 1, seq: 33, ts: 1789079797015, prompt: `Approve unit 1 before it runs: triage — ${INTENT}`, reviewingOrd: null },
  ungated(1, 43, 1789080137649),
  { type: 'gateDecided', session: GATE_RUN, ord: 1, seq: 44, ts: 1789080137649, allow: true },
  { type: 'awaitingHuman', session: GATE_RUN, ord: 2, seq: 46, ts: 1789080137651, prompt: `Approve unit 2 before it runs: reproduce — ${INTENT}`, reviewingOrd: null },
  ungated(2, 102, 1789080347132),
  { type: 'gateDecided', session: GATE_RUN, ord: 2, seq: 103, ts: 1789080347132, allow: true },
  { type: 'awaitingHuman', session: GATE_RUN, ord: 3, seq: 105, ts: 1789080347133, prompt: `Approve unit 3 before it runs: fix — ${INTENT}`, reviewingOrd: null },
  {
    type: 'gateEvaluated',
    session: GATE_RUN,
    ord: 3,
    seq: 197,
    ts: 1789080925251,
    criterion: 'the run left a change in its worktree (done is re-derived from the diff, never asserted)',
    hasDeterministicFloor: true,
    deterministicPass: true,
    agentVerdict: 'pass',
    agentReasoning:
      'PASS — The worktree evidence shows multiple modified files and one new untracked test file, so the run left a change in its worktree. PASS',
    evaluatorPass: true,
    evaluatorPolicies: [],
    denialReason: null,
    denial: null,
    combined: true,
  },
  { type: 'gateDecided', session: GATE_RUN, ord: 3, seq: 198, ts: 1789080925251, allow: true },
  { type: 'unitDone', session: GATE_RUN, ord: 3, seq: 199, ts: 1789080925251 },
  { type: 'awaitingHuman', session: GATE_RUN, ord: 4, seq: 200, ts: 1789080925252, prompt: `Approve unit 4 before it runs: verify — ${INTENT}`, reviewingOrd: null },
];

/** The G4 gate as the gate store holds it. */
export const G4_GATE = { ord: 4, prompt: `Approve unit 4 before it runs: verify — ${INTENT}` };

/** The worktree guard's denial prose — the engine's exact sentence, tree ids substituted. */
export const WORKTREE_GUARD_REASON =
  'evaluator≠creator: phase `verify` declares `executes_code: false` but changed the worktree it was reviewing — ' +
  `1 path(s): M src/App.tsx (tree ${TREE_BEFORE.slice(0, 10)} → ${TREE_AFTER.slice(0, 10)}). ` +
  "The change under review is no longer the creator's, so this phase's verdict cannot certify it. " +
  `Restore the creator's tree in the worktree with \`git read-tree --reset -u ${TREE_BEFORE}\`, or reject the run; ` +
  'a phase that must change code declares `executes_code: true` in the workflow def.';

/** The run up to and including the G5 gate — unit #4 (`verify`) denied by the worktree guard. */
export const G5_EVENTS: CoreEvent[] = [
  ...G4_EVENTS,
  { type: 'resumed', session: GATE_RUN, ord: 4, seq: 201, ts: 1789081094441 },
  { type: 'unitDispatched', session: GATE_RUN, ord: 4, seq: 202, ts: 1789081095027, attempt: 0 },
  { type: 'unitExecuting', session: GATE_RUN, ord: 4, seq: 203, ts: 1789081095027 },
  {
    type: 'evaluatorMutatedWorktree',
    session: GATE_RUN,
    ord: 4,
    seq: 245,
    ts: 1789081439093,
    attempt: 0,
    cli: 'pi',
    phase: 'verify',
    beforeTree: TREE_BEFORE,
    afterTree: TREE_AFTER,
    headMoved: false,
    changed: [{ path: 'src/App.tsx', status: 'M' }],
  },
  {
    type: 'gateEvaluated',
    session: GATE_RUN,
    ord: 4,
    seq: 246,
    ts: 1789081439237,
    criterion: 'the run left a change in its worktree (done is re-derived from the diff, never asserted)',
    hasDeterministicFloor: true,
    deterministicPass: true,
    agentVerdict: 'pass',
    agentReasoning:
      'PASS — The worktree evidence shows multiple modified tracked files and one new untracked test file, directly satisfying the criterion that the run left a change in its worktree. PASS',
    evaluatorPass: true,
    evaluatorPolicies: [],
    denialReason: WORKTREE_GUARD_REASON,
    denial: {
      source: 'worktree_guard',
      reason: WORKTREE_GUARD_REASON,
      claimId: null,
      ruleIds: [],
      deniedTool: null,
      phase: 'unit-4',
    },
    combined: false,
  },
  { type: 'gateDecided', session: GATE_RUN, ord: 4, seq: 247, ts: 1789081439237, allow: false },
  { type: 'unitDenied', session: GATE_RUN, ord: 4, seq: 248, ts: 1789081439237 },
  {
    type: 'gateEscalated',
    session: GATE_RUN,
    ord: 4,
    seq: 249,
    ts: 1789081439237,
    condition: 'verdict_not_pass',
    verdictSummary: WORKTREE_GUARD_REASON,
  },
  {
    type: 'awaitingHuman',
    session: GATE_RUN,
    ord: 4,
    seq: 250,
    ts: 1789081439238,
    prompt: 'Unit 4 verdict is NOT PASS — confirm to retry the phase, or reject to cancel the run',
    reviewingOrd: 4,
  },
];

/** The G5 gate as the gate store holds it. */
export const G5_GATE = {
  ord: 4,
  prompt: 'Unit 4 verdict is NOT PASS — confirm to retry the phase, or reject to cancel the run',
};

/** The repo-checks floor (F-039) as recorded on the retry — every detected check exited 0. */
export const REPO_CHECKS_PASS: CoreEvent = {
  type: 'repoChecksEvaluated',
  session: GATE_RUN,
  ord: 4,
  seq: 302,
  ts: 1789081879655,
  attempt: 1,
  passed: true,
  criterion:
    "the repository's own checks pass in the run's worktree (every detected check exits 0 — done is re-derived by running them, never asserted)",
  checks: [
    {
      name: 'typecheck',
      argv: ['npm', 'run', 'typecheck'],
      source: 'package.json scripts.typecheck',
      exitCode: 0,
      timedOut: false,
      spawnError: null,
      durationMs: 6893,
      stdoutTail: '\n> typecheck\n> tsc --noEmit\n\n',
      stderrTail: '',
    },
    {
      name: 'lint',
      argv: ['npm', 'run', 'lint'],
      source: 'package.json scripts.lint',
      exitCode: 0,
      timedOut: false,
      spawnError: null,
      durationMs: 6118,
      stdoutTail: '\n> lint\n> eslint src tests\n\n',
      stderrTail: '',
    },
    {
      name: 'test',
      argv: ['npm', 'run', 'test'],
      source: 'package.json scripts.test',
      exitCode: 0,
      timedOut: false,
      spawnError: null,
      durationMs: 79191,
      stdoutTail: ' Test Files  249 passed (249)\n      Tests  2675 passed (2675)\n',
      stderrTail: '',
    },
  ],
  skipped: [],
};

/**
 * The run up to and including the G6 gate — the pre-run gate before unit #5 (`deliver`) after
 * the operator approved the retry: the floor ran the repo's checks and the ord-4 verdict passed.
 */
export const G6_EVENTS: CoreEvent[] = [
  ...G5_EVENTS,
  {
    // The operator approved the retry WITH a steer note (the recorded amendment, tree id
    // substituted; the re-stated description is the scrubbed intent).
    type: 'unitReworkAmended',
    session: GATE_RUN,
    ord: 4,
    seq: 251,
    ts: 1789081594674,
    amendment:
      `Operator restored the creator's tree (git read-tree --reset -u ${TREE_BEFORE.slice(0, 10)}...) before this retry. ` +
      'Evaluator: you are READ-ONLY — do not edit, write, or format any file, and do not run npm run build (it writes dist/). ' +
      'Run typecheck, lint and the test suite; review the diff against the acceptance criteria; report findings such as the stale comment at App.tsx:147 in your verdict text only — never fix them.',
    updatedDescription: `verify — ${INTENT}`,
  },
  { type: 'resumed', session: GATE_RUN, ord: 4, seq: 252, ts: 1789081594676 },
  { type: 'unitDispatched', session: GATE_RUN, ord: 4, seq: 253, ts: 1789081595299, attempt: 1 },
  REPO_CHECKS_PASS,
  {
    // Recorded: the floor's criterion is JOINED onto the phase's own with `; `.
    type: 'gateEvaluated',
    session: GATE_RUN,
    ord: 4,
    seq: 303,
    ts: 1789081879672,
    criterion:
      'the run left a change in its worktree (done is re-derived from the diff, never asserted); ' +
      "the repository's own checks pass in the run's worktree (every detected check exits 0 — done is re-derived by running them, never asserted)",
    hasDeterministicFloor: true,
    deterministicPass: true,
    agentVerdict: 'pass',
    agentReasoning:
      'PASS — The worktree evidence shows multiple modified files and one added test file, satisfying the criterion that the run left a change in its worktree. PASS',
    evaluatorPass: true,
    evaluatorPolicies: [],
    denialReason: null,
    denial: null,
    combined: true,
  },
  { type: 'gateDecided', session: GATE_RUN, ord: 4, seq: 304, ts: 1789081879672, allow: true },
  { type: 'unitDone', session: GATE_RUN, ord: 4, seq: 305, ts: 1789081879672 },
  { type: 'awaitingHuman', session: GATE_RUN, ord: 5, seq: 306, ts: 1789081879673, prompt: `Approve unit 5 before it runs: deliver — ${INTENT}`, reviewingOrd: null },
];

/** The G6 gate as the gate store holds it. */
export const G6_GATE = { ord: 5, prompt: `Approve unit 5 before it runs: deliver — ${INTENT}` };

/**
 * SYNTHETIC (not recorded): the same floor with `lint` failing and `test` skipped — the shape the
 * wire declares for a failed floor (`passed: false`, `skipped` names the detected check not run
 * because an earlier one failed), so the fail rendering is pinned without waiting for a red run.
 */
export const REPO_CHECKS_FAIL: CoreEvent = {
  ...REPO_CHECKS_PASS,
  seq: 402,
  passed: false,
  checks: [
    (REPO_CHECKS_PASS.checks as Array<Record<string, unknown>>)[0]!,
    {
      ...(REPO_CHECKS_PASS.checks as Array<Record<string, unknown>>)[1]!,
      exitCode: 1,
      durationMs: 5402,
      stdoutTail: '',
      stderrTail: 'src/App.tsx\n  12:7  error  Unexpected any  @typescript-eslint/no-explicit-any\n',
    },
  ],
  skipped: ['test'],
};
