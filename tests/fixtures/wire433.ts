import type {
  AcpFallbackEvent,
  CoreEvent,
  DeliverLiftEvaluatedEvent,
  EvaluatorMutatedWorktreeEvent,
  EvaluatorToolCallDeniedEvent,
  GateEvaluatedEvent,
  RepoChecksEvaluatedEvent,
  RunBaseResolvedEvent,
  StepFailedEvent,
  WorktreeRestoredEvent,
} from '../../src/api/types.js';
import { G4_EVENTS, GATE_RUN, TREE_AFTER, TREE_BEFORE } from './gateEvidence.js';

/**
 * wicked-core#431's wire (api-types 0.33.0 — the shapes wicked-crew#527's wire-contract test pins),
 * as SYNTHETIC frames in the exact `event_to_json` spelling: camelCase, every key present, `null`
 * never absent. Not a recording: the #431 engine (core-ts 0.7.19) had not been through a governed
 * run on a rig when this was written, so every literal mirrors wicked-core's own `to_json` tests and
 * crew's `wire-contract.test.ts` — the same run id, ords, seat keys, paths and tree ids as the
 * recorded Phase 3 frames in `gateEvidence.ts`, so the two corpora compose (`G4_EVENTS` + these).
 * Privacy-scrubbed by construction: no operator text, no host paths, synthetic hex.
 *
 * Denial prose and refusal texts are the engine's own format strings (`worktree_guard.rs`
 * `denial_reason`, `deliver_lift.rs`, `actor.rs`'s mutation-gate prompt) with the placeholders
 * filled — byte-for-byte the sentences a 0.7.19 engine emits for these inputs.
 */

/** A frame as the daemon relays it: the engine's `event_to_json` shape plus the `seq` / `ts` envelope
 *  crew stamps on every CoreEvent. Every #431 frame below is declared `satisfies` its 0.33.0 named
 *  type, so a drifted key, a wrong nullability or a token outside the declared union fails `tsc` —
 *  the fixtures ARE the declared shapes, not a studio-side guess (`tests/wire433.shapes.test.ts`
 *  re-derives the same diff at run time against the installed `index.d.ts`). */
export type Wire<T> = T & { seq: number; ts: number };

const T10 = (id: string): string => id.slice(0, 10);
const T7 = (id: string): string => id.slice(0, 7);

/** Synthetic commit ids (git's 40-hex width) for the deliver lift and the run base. */
export const BASE_BEFORE = '1432c96e0f1a2b3c4d5e6f708192a3b4c5d6e7f8';
export const BASE_AFTER = 'f57069d1e2f3a4b5c6d7e8f90a1b2c3d4e5f6a7b';
export const TREE_LIFTED = '9f8e7d6c5b4a39281706f5e4d3c2b1a0f9e8d7c6';
export const SUGGESTION_REF = `refs/wicked/suggestions/${GATE_RUN}/4/0`;
export const RUN_BRANCH = `wicked/${GATE_RUN}`;

// ── (1)+(2) the gate: a named judge, a restored creator tree ─────────────────────────────────────

/** `worktree_guard::denial_reason` with `restored: true` — the engine already ran the remedy. */
export const RESTORED_GUARD_REASON =
  'evaluator≠creator: phase `verify` declares `executes_code: false` but changed the worktree it was reviewing — ' +
  `1 path(s): M src/App.tsx (tree ${T10(TREE_BEFORE)} → ${T10(TREE_AFTER)}). ` +
  "The change under review is no longer the creator's, so this phase's verdict cannot certify it. " +
  `The evaluator's edit was DISCARDED: the engine restored the creator's tree (${T10(TREE_BEFORE)}) in the worktree, ` +
  'so approving this gate retries the phase against the verified tree. ' +
  'A phase that must change code declares `executes_code: true` in the workflow def.';

/** `worktree_guard::denial_reason` with `restored: false` + `restore_error` — the manual remedy stands. */
export const RESTORE_FAILED_ERROR = 'git read-tree exited 128: index.lock exists';
export const RESTORE_FAILED_GUARD_REASON =
  'evaluator≠creator: phase `verify` declares `executes_code: false` but changed the worktree it was reviewing — ' +
  `1 path(s): M src/App.tsx (tree ${T10(TREE_BEFORE)} → ${T10(TREE_AFTER)}). ` +
  "The change under review is no longer the creator's, so this phase's verdict cannot certify it. " +
  `Restore the creator's tree in the worktree with \`git read-tree --reset -u ${TREE_BEFORE}\` ` +
  `(the engine's own restore failed: ${RESTORE_FAILED_ERROR}), or reject the run; ` +
  'a phase that must change code declares `executes_code: true` in the workflow def.';

/** `actor.rs`: the mutation-gate prompt once the tree was restored (the pre-0.33.0 prompt was
 *  "… confirm to retry the phase, or reject to cancel the run"). */
export const RESTORED_PROMPT =
  'Unit 4 verdict is NOT PASS — the evaluator changed the tree under review; its edit was discarded and ' +
  "the creator's verified tree restored. Approve to retry the phase against the restored tree, or reject to cancel the run";
export const LEGACY_PROMPT = 'Unit 4 verdict is NOT PASS — confirm to retry the phase, or reject to cancel the run';

export const MUTATION_RESTORED = {
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
  restored: true,
  restoreError: null,
} satisfies Wire<EvaluatorMutatedWorktreeEvent>;

export const WORKTREE_RESTORED = {
  type: 'worktreeRestored',
  session: GATE_RUN,
  ord: 4,
  seq: 246,
  ts: 1789081439150,
  attempt: 0,
  cli: 'pi',
  phase: 'verify',
  tree: TREE_BEFORE,
  head: null,
  discarded: [{ path: 'src/App.tsx', status: 'M' }],
  suggestionRef: SUGGESTION_REF,
} satisfies Wire<WorktreeRestoredEvent>;

/** The worktree-guard denial with the judge NAMED (a distinct seat) and the restored prose. */
export const GATE_DENY_RESTORED = {
  type: 'gateEvaluated',
  session: GATE_RUN,
  ord: 4,
  seq: 247,
  ts: 1789081439237,
  criterion: 'the run left a change in its worktree (done is re-derived from the diff, never asserted)',
  hasDeterministicFloor: true,
  deterministicPass: true,
  agentVerdict: 'pass',
  agentReasoning: 'PASS — The worktree evidence shows modified tracked files, satisfying the criterion. PASS',
  evaluatorPass: true,
  evaluatorPolicies: [],
  denialReason: RESTORED_GUARD_REASON,
  denial: { source: 'worktree_guard', reason: RESTORED_GUARD_REASON, claimId: null, ruleIds: [], deniedTool: null, phase: 'unit-4' },
  combined: false,
  judgeCli: 'codex',
  judgeDistinct: true,
} satisfies Wire<GateEvaluatedEvent>;

function escalation(seq: number, prompt: string): CoreEvent[] {
  return [
    { type: 'gateDecided', session: GATE_RUN, ord: 4, seq, ts: 1789081439237, allow: false },
    { type: 'unitDenied', session: GATE_RUN, ord: 4, seq: seq + 1, ts: 1789081439237 },
    { type: 'gateEscalated', session: GATE_RUN, ord: 4, seq: seq + 2, ts: 1789081439237, condition: 'verdict_not_pass', verdictSummary: RESTORED_GUARD_REASON },
    { type: 'awaitingHuman', session: GATE_RUN, ord: 4, seq: seq + 3, ts: 1789081439238, prompt, reviewingOrd: 4 },
  ];
}

const DISPATCH_4: CoreEvent[] = [
  { type: 'resumed', session: GATE_RUN, ord: 4, seq: 201, ts: 1789081094441 },
  { type: 'unitDispatched', session: GATE_RUN, ord: 4, seq: 202, ts: 1789081095027, attempt: 0 },
  { type: 'unitExecuting', session: GATE_RUN, ord: 4, seq: 203, ts: 1789081095027 },
];

/** G5 on the #431 engine: the mutation, the restore, the named-judge denial, the NEW prompt. */
export const G5R_EVENTS: CoreEvent[] = [
  ...G4_EVENTS,
  ...DISPATCH_4,
  MUTATION_RESTORED,
  WORKTREE_RESTORED,
  GATE_DENY_RESTORED,
  ...escalation(248, RESTORED_PROMPT),
];
export const G5R_GATE = { ord: 4, prompt: RESTORED_PROMPT };

/** The same fold with the pin FAILED — `suggestionRef: null` (the discarded tree is only gc-prunable). */
export const G5R_UNPINNED_EVENTS: CoreEvent[] = [
  ...G4_EVENTS,
  ...DISPATCH_4,
  MUTATION_RESTORED,
  { ...WORKTREE_RESTORED, suggestionRef: null },
  GATE_DENY_RESTORED,
  ...escalation(248, RESTORED_PROMPT),
];

/** The restore itself FAILED: `restored: false` + `restoreError`, no `worktreeRestored`, the legacy
 *  prompt and the manual `git read-tree` remedy in the prose. */
export const G5_RESTORE_FAILED_EVENTS: CoreEvent[] = [
  ...G4_EVENTS,
  ...DISPATCH_4,
  { ...MUTATION_RESTORED, restored: false, restoreError: RESTORE_FAILED_ERROR },
  {
    ...GATE_DENY_RESTORED,
    seq: 246,
    denialReason: RESTORE_FAILED_GUARD_REASON,
    denial: { source: 'worktree_guard', reason: RESTORE_FAILED_GUARD_REASON, claimId: null, ruleIds: [], deniedTool: null, phase: 'unit-4' },
    judgeCli: null,
    judgeDistinct: null,
  },
  ...escalation(247, LEGACY_PROMPT),
];

/** G4 with the fix phase's judge named and NOT distinct — the single default runner judged its own
 *  seat's work (prompt-only independence). */
export const G4_SAME_SEAT_EVENTS: CoreEvent[] = G4_EVENTS.map((e) =>
  e.type === 'gateEvaluated' && e.ord === 3 ? { ...e, judgeCli: 'claude', judgeDistinct: false } : e,
);

// ── (3) the deliver ord (5): the lift, the re-verify, the engine's refusals ──────────────────────

const REPO_CHECKS_CRITERION =
  "the repository's own checks pass in the run's worktree (every detected check exits 0 — done is re-derived by running them, never asserted)";

function lift(seq: number, over: Partial<DeliverLiftEvaluatedEvent>): Wire<DeliverLiftEvaluatedEvent> {
  const unchanged = {
    type: 'deliverLiftEvaluated',
    session: GATE_RUN,
    ord: 5,
    seq,
    ts: 1789082000000 + seq,
    attempt: 0,
    outcome: 'unchanged',
    baseRef: 'origin/main',
    baseBefore: BASE_BEFORE,
    baseAfter: BASE_BEFORE,
    treeBefore: TREE_BEFORE,
    treeAfter: TREE_BEFORE,
    conflicts: [],
    note: null,
  } satisfies Wire<DeliverLiftEvaluatedEvent>;
  return { ...unchanged, ...over };
}

export const DISPATCH_5: CoreEvent[] = [
  { type: 'resumed', session: GATE_RUN, ord: 5, seq: 307, ts: 1789082000000 },
  { type: 'unitDispatched', session: GATE_RUN, ord: 5, seq: 308, ts: 1789082000308, attempt: 0 },
];

export const LIFT_UNCHANGED = lift(310, {});
export const LIFT_LIFTED = lift(310, { outcome: 'lifted', baseAfter: BASE_AFTER, treeAfter: TREE_LIFTED });
export const LIFT_CONFLICT = lift(310, {
  outcome: 'conflict', baseAfter: BASE_AFTER, treeAfter: null, conflicts: ['testid-inventory.json'],
});
export const LIFT_SKIPPED = lift(310, {
  outcome: 'skipped', baseRef: null, baseBefore: BASE_BEFORE, baseAfter: null, treeBefore: null, treeAfter: null,
  note: 'no remote default branch resolved (origin/HEAD is unset and origin/main does not exist)',
});
export const LIFT_FAILED = lift(310, {
  outcome: 'failed', baseAfter: BASE_AFTER, treeAfter: null,
  note: 'git read-tree -m -u exited 128 after the merge-tree succeeded',
});

/** A lifted tree's re-verify — the deliver ord's `repoChecksEvaluated`; the lockfile moved with the
 *  base, so a frozen `--ignore-scripts` install ran first and says so in its `source`. */
export const DELIVER_REVERIFY_PASS = {
  type: 'repoChecksEvaluated',
  session: GATE_RUN,
  ord: 5,
  seq: 320,
  ts: 1789082090000,
  attempt: 0,
  passed: true,
  criterion: REPO_CHECKS_CRITERION,
  checks: [
    { name: 'install', argv: ['npm', 'ci', '--ignore-scripts'], source: 'package-lock.json (forced: lockfile drift)', exitCode: 0, timedOut: false, spawnError: null, durationMs: 21400, stdoutTail: '', stderrTail: '' },
    { name: 'typecheck', argv: ['npm', 'run', 'typecheck'], source: 'package.json scripts.typecheck', exitCode: 0, timedOut: false, spawnError: null, durationMs: 6893, stdoutTail: '', stderrTail: '' },
    { name: 'lint', argv: ['npm', 'run', 'lint'], source: 'package.json scripts.lint', exitCode: 0, timedOut: false, spawnError: null, durationMs: 6118, stdoutTail: '', stderrTail: '' },
    { name: 'test', argv: ['npm', 'run', 'test'], source: 'package.json scripts.test', exitCode: 0, timedOut: false, spawnError: null, durationMs: 79191, stdoutTail: '', stderrTail: '' },
  ],
  skipped: [],
} satisfies Wire<RepoChecksEvaluatedEvent>;

/** The deliver unit's own `gateEvaluated` after a passing re-verify: the floor is the repo checks. */
export const GATE_DELIVER_PASS = {
  type: 'gateEvaluated',
  session: GATE_RUN,
  ord: 5,
  seq: 321,
  ts: 1789082090010,
  criterion: REPO_CHECKS_CRITERION,
  hasDeterministicFloor: true,
  deterministicPass: true,
  agentVerdict: null,
  agentReasoning: null,
  evaluatorPass: true,
  evaluatorPolicies: [],
  denialReason: null,
  denial: null,
  combined: true,
  judgeCli: null,
  judgeDistinct: null,
} satisfies Wire<GateEvaluatedEvent>;

/** A FAILED re-verify: lint exited 1 on the lifted tree, test skipped. */
export const DELIVER_REVERIFY_FAIL = {
  ...DELIVER_REVERIFY_PASS,
  passed: false,
  checks: [
    DELIVER_REVERIFY_PASS.checks[0]!,
    DELIVER_REVERIFY_PASS.checks[1]!,
    { ...DELIVER_REVERIFY_PASS.checks[2]!, exitCode: 1, durationMs: 5402 },
  ],
  skipped: ['test'],
} satisfies Wire<RepoChecksEvaluatedEvent>;

/** A failed POST-CHECK PROOF: every check exited 0 but the tree moved while they ran — `passed:
 *  false` with three green rows (wicked-core F-433-002). */
export const DELIVER_REVERIFY_CHANGED_TREE = {
  ...DELIVER_REVERIFY_PASS,
  passed: false,
  checks: DELIVER_REVERIFY_PASS.checks.slice(1),
} satisfies Wire<RepoChecksEvaluatedEvent>;

/** The deliver unit's failure frame. Every `deliver:` refusal reaches the operator by the
 *  unrecognized-failure route (`actor.rs`: `StepFailed` fires at once, then failure triage
 *  escalates), which stamps `failureKind: "workerError"` — the engine's token for "the unit's
 *  process ended non-zero", not a judgement on the seat. Declared `string` on the wire; the
 *  engine's three tokens are `workerError` / `environmentRefused` / `substanceRejected`. */
function stepFailed(seq: number, detail: string) {
  return {
    type: 'stepFailed', session: GATE_RUN, ord: 5, seq, ts: 1789082100000 + seq, attempt: 0, detail, failureKind: 'workerError',
  } satisfies Wire<StepFailedEvent>;
}

/** `deliver_lift.rs` — the engine's refusals, format strings filled. */
export const REFUSAL_CONFLICT =
  `deliver: LIFT-CONFLICT — lifting the run's work onto origin/main (${T7(BASE_AFTER)}) would conflict in: testid-inventory.json. ` +
  `The worktree was left exactly as verified (base ${T7(BASE_BEFORE)}); nothing was rebased and nothing was pushed. ` +
  "Resolve on the branch (rebase onto origin/main, regenerate any generated files, re-run the repository's checks) and approve to retry the deliver phase.";
export const REFUSAL_APPLY_FAILED =
  `deliver: the lift onto origin/main (${T7(BASE_AFTER)}) could not be applied cleanly — git read-tree -m -u exited 128 after the merge-tree succeeded. ` +
  'Nothing was pushed — the deliver gate never pushes a tree that was not verified. ' +
  'Inspect the worktree (it may hold a partial checkout), restore or fix it, and approve to retry the deliver phase.';
export const REFUSAL_WRONG_HEAD =
  `deliver: the worktree's HEAD is attached to \`refs/heads/main\`, not the run branch \`${RUN_BRANCH}\` — nothing was lifted, reset or pushed; ` +
  `the deliver script only pushes the run branch. Switch the worktree back to \`${RUN_BRANCH}\` and approve to retry.`;
export const REFUSAL_REVERIFY_FAILED =
  `deliver: the tree that would ship is the run's work lifted onto origin/main (${T7(BASE_AFTER)}), not the tree the run verified, ` +
  "and the repository's own checks FAILED on it: lint exited 1 (test skipped). " +
  'Lockfile drift between the old base and the tip (package-lock.json): dependencies were re-installed (frozen lockfile, --ignore-scripts) before the checks. ' +
  'Nothing was pushed — the deliver gate never pushes a tree that was not verified. ' +
  'Fix the worktree (or reject the run) and approve to retry; the checks run again until the tree passes.';
export const REFUSAL_CHANGED_TREE =
  `deliver: the repository's checks passed but CHANGED the worktree while running (tree ${T10(TREE_LIFTED)} → 0a1b2c3d4e, ` +
  `HEAD ${T10(BASE_AFTER)} → ${T10(BASE_AFTER)}, HEAD ref Some("refs/heads/${RUN_BRANCH}") → Some("refs/heads/${RUN_BRANCH}")) — ` +
  'a check script that edits tracked files, moves HEAD or switches the branch leaves a tree nobody verified. ' +
  "Nothing was pushed. Inspect the worktree, fix or ignore the check's writes, and approve to retry.";

export const STEP_FAILED_CONFLICT = stepFailed(311, REFUSAL_CONFLICT);
export const STEP_FAILED_APPLY = stepFailed(311, REFUSAL_APPLY_FAILED);
export const STEP_FAILED_WRONG_HEAD = stepFailed(311, REFUSAL_WRONG_HEAD);
export const STEP_FAILED_REVERIFY = stepFailed(322, REFUSAL_REVERIFY_FAILED);
export const STEP_FAILED_CHANGED_TREE = stepFailed(322, REFUSAL_CHANGED_TREE);

/** The retry gate the engine opens on the refused deliver unit (failure triage → escalate). */
export const DELIVER_RETRY_PROMPT = 'Unit 5 failed — approve to retry the deliver phase, or reject to cancel the run';
export const DELIVER_RETRY_GATE = { ord: 5, prompt: DELIVER_RETRY_PROMPT };
function deliverRetry(seq: number): CoreEvent[] {
  return [
    { type: 'failureTriaged', session: GATE_RUN, ord: 5, seq, ts: 1789082200000, decision: 'escalate', analysis: 'the engine refused the deliver: a git state, not a worker error' },
    { type: 'awaitingHuman', session: GATE_RUN, ord: 5, seq: seq + 1, ts: 1789082200001, prompt: DELIVER_RETRY_PROMPT, reviewingOrd: 5 },
  ];
}

/** Deliver stories, each `G6_EVENTS`-shaped tails for ord 5 — append to `G6_EVENTS` (the gate before
 *  unit #5) so the run's earlier folds stay in the log. */
export const DELIVER_UNCHANGED_TAIL: CoreEvent[] = [...DISPATCH_5, LIFT_UNCHANGED];
export const DELIVER_LIFTED_TAIL: CoreEvent[] = [...DISPATCH_5, LIFT_LIFTED, DELIVER_REVERIFY_PASS, GATE_DELIVER_PASS];
export const DELIVER_CONFLICT_TAIL: CoreEvent[] = [...DISPATCH_5, LIFT_CONFLICT, STEP_FAILED_CONFLICT, ...deliverRetry(312)];
export const DELIVER_SKIPPED_TAIL: CoreEvent[] = [...DISPATCH_5, LIFT_SKIPPED];
export const DELIVER_FAILED_TAIL: CoreEvent[] = [...DISPATCH_5, LIFT_FAILED, STEP_FAILED_APPLY, ...deliverRetry(312)];
/** The addendum: refused for a wrong HEAD ref — NO `deliverLiftEvaluated` precedes the failure. */
export const DELIVER_WRONG_HEAD_TAIL: CoreEvent[] = [...DISPATCH_5, STEP_FAILED_WRONG_HEAD, ...deliverRetry(312)];
export const DELIVER_REVERIFY_FAILED_TAIL: CoreEvent[] = [...DISPATCH_5, LIFT_LIFTED, DELIVER_REVERIFY_FAIL, STEP_FAILED_REVERIFY, ...deliverRetry(323)];
export const DELIVER_CHANGED_TREE_TAIL: CoreEvent[] = [...DISPATCH_5, LIFT_LIFTED, DELIVER_REVERIFY_CHANGED_TREE, STEP_FAILED_CHANGED_TREE, ...deliverRetry(323)];

// ── (4) the run base ─────────────────────────────────────────────────────────────────────────────

export const RUN_BASE_LIFTED = {
  type: 'runBaseResolved',
  session: GATE_RUN,
  seq: 2,
  ts: 1789079790000,
  baseRef: 'origin/main',
  baseCommit: BASE_AFTER,
  localHead: BASE_BEFORE,
  behind: 5,
  fetched: true,
  lifted: true,
  note: null,
} satisfies Wire<RunBaseResolvedEvent>;
export const RUN_BASE_AT_TIP = { ...RUN_BASE_LIFTED, baseCommit: BASE_BEFORE, behind: 0, lifted: false } satisfies Wire<RunBaseResolvedEvent>;
export const RUN_BASE_LOCAL_KEPT = {
  ...RUN_BASE_LIFTED, baseCommit: BASE_BEFORE, behind: 0, lifted: false,
  note: "the registered clone's HEAD is ahead of origin/main by 2 commit(s) (local unpushed work) — kept as the base",
} satisfies Wire<RunBaseResolvedEvent>;
export const RUN_BASE_NO_REMOTE = {
  ...RUN_BASE_LIFTED, baseRef: null, baseCommit: BASE_BEFORE, behind: 0, lifted: false,
  note: 'no remote default branch resolved (origin/HEAD is unset)',
} satisfies Wire<RunBaseResolvedEvent>;
export const RUN_BASE_FETCH_FAILED = {
  ...RUN_BASE_LIFTED, baseCommit: BASE_BEFORE, behind: 0, fetched: false, lifted: false,
  note: 'git fetch origin failed (exit 128: could not resolve host) — cached refs used',
} satisfies Wire<RunBaseResolvedEvent>;

// ── (5) the feed: a refused write, a deliberate reroute ──────────────────────────────────────────

export const TOOL_DENIED = {
  type: 'evaluatorToolCallDenied',
  session: GATE_RUN,
  ord: 4,
  seq: 230,
  ts: 1789081300000,
  attempt: 0,
  cli: 'claude',
  carrier: 'acp',
  tool: 'edit',
  kind: 'edit',
  path: 'src/App.tsx',
  reason: 'write-class tool call from an executes_code:false phase',
} satisfies Wire<EvaluatorToolCallDeniedEvent>;
/** `kind: null` / `path: null` — the 0.33.0 spelling for a denied call the adapter could not classify
 *  (`CoreEvent.kind` is `string | null` since that pin, so this is a plain literal — no cast). */
export const TOOL_DENIED_KINDLESS = { ...TOOL_DENIED, kind: null, path: null } satisfies Wire<EvaluatorToolCallDeniedEvent>;

export const READ_ONLY_REROUTE = {
  type: 'acpFallback',
  session: GATE_RUN,
  seq: 204,
  ts: 1789081095100,
  cliKey: 'pi',
  reason: 'executes_code:false unit on an ACP seat not admitted to input governance',
  fallbackKind: 'read_only_requires_wrapped',
} satisfies Wire<AcpFallbackEvent>;
