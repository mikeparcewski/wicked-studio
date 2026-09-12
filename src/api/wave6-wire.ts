/**
 * MIRROR of the wicked-crew-api-types 0.36.0 wave-6 additions (the governed testing journey —
 * crew#536, the wave-6 crew PR; `skills.stale-rules` from crew#535) — replace with imports from the
 * published package at release.
 *
 * Studio pins `wicked-crew-api-types` exactly (0.36.0). Every declaration below that is a contract
 * shape is a region copied VERBATIM from the package's `index.d.ts` between `>>> VERBATIM` /
 * `<<< VERBATIM` markers, labelled with the version and the 1-based line range it was cut from.
 * Nothing inside a marked region is studio's wording, and nothing may be edited there:
 * `tests/wave6Wire.test.ts` pins each region byte-for-byte against the INSTALLED package at the
 * labelled range, so a hand edit here or a pin bump without a re-vendor fails the suite. The same
 * shapes also reach studio through `./types.js` (`export type * from 'wicked-crew-api-types'`);
 * this module is the pinned EVIDENCE of the wave-6 wire plus the null-safe readers every surface
 * shares, one spelling per field.
 *
 * What the wave adds, region by region:
 *  - `POST /testing/author` — {@link TestingAuthorBody} / {@link TestingAuthorResponse} (+ the
 *    {@link WorkflowPlan} the intake gate renders, {@link TestingAuthorRun}) and the registered
 *    {@link TestSet} the daemon serves as `CampaignsListResponse.test_sets`. {@link TestingReconBody}
 *    is vendored beside them as evidence that the recon body carries NO `workflow` key (see the wire
 *    gaps below).
 *  - `GET /runs/:id/diff` — {@link RunDiff}`.source` (`worktree` | `branch`), `branch`, `base`.
 *  - `gateEvaluated` — {@link GateEvaluatedEvent}`.ungated` / `ungatedReason` / `floorNote` /
 *    `judgeSkippedReason`.
 *  - `repoChecksEvaluated` — {@link RepoChecksEvaluatedEvent}`.sandboxLevel` / `sandboxError` /
 *    `detectError`.
 *  - `unitDistributed` — {@link UnitDistributedEvent} spelled camelCase as the engine emits it
 *    (`routingMethod`, `agreementPct`, `seated`, `degradedReason`, `seatConstraint`); the snake_case
 *    names are `@deprecated` aliases the engine never emitted, and the readers below no longer read
 *    them. {@link BenchedSeat} rides with it.
 *  - `workerToolCallDenied` — {@link WorkerToolCallDeniedEvent} incl. `carrier`, `role`, `tool`.
 *  - `acpFallback` — {@link AcpFallbackKind} grows the auth kinds `auth_failed` / `unauthenticated`.
 *  - `runBaseResolved` — {@link RunBaseResolvedEvent}`.runBranch`.
 *  - `GET /roster` — {@link RosterSeat}`.auth` / `auth_source` / `free_tier_source` /
 *    `council_eligible` / `council_bench` ({@link RosterSeatCouncilBench}, {@link SeatAuth}).
 *  - `POST /chats` / `GET /chats/:id` — {@link ChatSeatRefusal}`.source` ({@link ChatRefusalSource}),
 *    `refused[]` on {@link ChatOpenResponse} and {@link ChatDetailResponse}.
 *  - `GET /interactive/docs` — {@link InteractiveDocsListing} rows ({@link InteractiveDocIndexRow}).
 *  - `skills.stale-rules` + `SkillsManifestResponse.current.rules` / `current.drift` live in the
 *    SKILLS block and are vendored by `./skills-wire.ts` (its own byte-pinned regions), not here.
 *
 * WIRE GAPS — none. Two shapes the 0.5.7 cut coded against provisionally are gone (studio 0.5.8):
 * (1) a row-level `Campaign.test_set` / `RunGroup.test_set` join was never declared — 0.36.0 serves
 * the produced sets as the top-level `CampaignsListResponse.test_sets: TestSet[]` (snake_case,
 * `run_id`-keyed, `label`-tagged), which {@link testSetsOf} reads null-safely and
 * `board/campaignStats.ts` joins onto the campaign / group cards by `run_id` (and by the
 * `qe-tests-<repo>` label the daemon files an authoring run under); (2) `TestingReconBody.workflow`
 * — the launch ladder's middle rung — was dead code: `qe-author-tests` and `POST /testing/author`
 * shipped together in wave 6, so no daemon lists the workflow without the route, and the ladder
 * falls from the route straight to the per-repo `POST /runs` fan. {@link TestingReconBody} stays
 * vendored as the evidence that the recon body carries NO `workflow` key — studio sends none.
 * `tests/wave6Wire.test.ts` guards both: a `test_set` row join or a `workflow` recon key appearing
 * in a later pin fails the suite and says "re-vendor".
 */

import type {
  Campaign,
  ChatScope,
  CoreEvent,
  PhaseRole,
  RepoCheckRun,
  RunGroup,
  SeatHealth,
  SessionStatus,
  StageKindPhase,
  UnitDenial,
} from './types.js';

// ── The QE authoring workflow — `POST /testing/author`, the plan, the registered test set ──────

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:2801-2941 (crew#536) — the governed test-authoring launch: QeAuthorTestsWorkflowId, TestingAuthorBody, WorkflowPlanPhase, WorkflowPlan, TestingAuthorRun, TestingAuthorResponse, TestSetFile, TestSet
// ── The governed test-authoring launch (wave 6; api-types 0.36.0) ──────────────────────────────

/**
 * The id of the governed test-authoring workflow the daemon serves (`GET /workflows` lists it, not
 * `is_system` — an operator-selectable work mode): recon (`wicked-garden-qe` plan) → author
 * (creator, evidence-floor pinned, `wicked-garden-qe` author) → verify (a TOOL phase that RUNS every
 * produced test under the repository's own harness — vitest/jest/pytest/Playwright — and FAILS the
 * unit when one fails or was never executed) → review (evaluator ≠ creator, `wicked-garden-qe`
 * review) → the ENGINE's deliver phase (appended per run; never a worker's `gh pr create`).
 * F-7R2-003/004/005/012/014/015 + acceptance R4-r2.
 */
export type QeAuthorTestsWorkflowId = 'qe-author-tests';

/**
 * Body of `POST /testing/author` — the Testing page's "New test". Same scope wire as
 * {@link TestingReconBody} (`repoRefs` and/or `projectId`, resolved server-side), but the scope
 * MUST resolve to ≥ 1 repo (a test-authoring run writes into a repository; an unscoped author is a
 * 400). One governed `qe-author-tests` run per resolved repo, each filed under the repo's
 * `qe-tests-<repo name>` label group (`RunGroup` on `GET /campaigns`).
 */
export interface TestingAuthorBody {
  /** The operator's intent — what to test — verbatim; the run's problem statement. */
  problem: string;
  /** The project to FILE the runs into. Alone: the scope is the project's `crew.repo` members. */
  projectId?: string;
  /**
   * The repos to author into (registry id or name). With `projectId`, THIS is the scope and the
   * project is the filing only (a NARROWED project scope — studio #263 F-4): the runs are filed
   * into the project without inheriting its other repo members, so a skin with repo chips names
   * the repos and the project once instead of fanning one `POST /runs` per repo (one deliver/PR
   * each). Unlike {@link TestingReconBody}, where both fields union. The 201 says which was used
   * (`scope`).
   */
  repoRefs?: string[];
  /** EXPLICITLY launch unattended (no intake gate). Default `false`: each run pauses at its intake
   *  gate (`before:1`) with the plan on the table before any unit runs. */
  ungated?: boolean;
  /** `pr` (default) — the ENGINE's deliver phase opens the PR; `none` — the tests stay on the run
   *  branch (`delivery: 'stranded'` on the wire, liftable via `POST /runs/:id/deliver`). */
  deliver?: 'pr' | 'none';
}

/** One planned phase as the intake gate shows it — derived from the workflow DEFINITION. */
export interface WorkflowPlanPhase {
  id: string;
  kind: StageKindPhase;
  role: PhaseRole;
  executor: 'agent' | 'tool';
  /** The garden skill the phase routes through (`wicked-garden-qe`), `null` for a tool phase. */
  skillRef: string | null;
  /** `auto` | `human` (unconditional confirm) | `human_if_not_pass` (a not-pass verdict escalates). */
  gate: 'auto' | 'human' | 'human_if_not_pass';
  executesCode: boolean;
  /** `true` for the phase the ENGINE appends and owns (the deliver phase) — not in the def. */
  engine?: boolean;
}

/** The plan the intake gate shows (F-7R2-008): the phases in order + the seats a council may
 *  pick from (the launcher's eligible roster — benched seats excluded). */
export interface WorkflowPlan {
  workflow: string;
  phases: WorkflowPlanPhase[];
  seats: string[];
}

/** One launched authoring run and the label group it was filed under. */
export interface TestingAuthorRun {
  runId: string;
  repoRef: string;
  /** `qe-tests-<repo name>` — the `RunGroup.label` on `GET /campaigns`. */
  label: string;
}

/**
 * The `POST /testing/author` 201 body. `runIds` is the source of truth (one per resolved repo in
 * the caller's order); `runId` is its first entry. `plan` is what the intake card renders before
 * approval; `gate` says whether the runs paused there. `campaignRegistered` is always `false`: an
 * author launch is filed as label groups, never an engine campaign (campaign nodes are
 * engine-launched and would not receive the daemon's deliver composition).
 */
export interface TestingAuthorResponse {
  runId: string;
  runIds: string[];
  workflow: QeAuthorTestsWorkflowId;
  runs: TestingAuthorRun[];
  gate: 'before:1' | 'none';
  deliver: 'pr' | 'none';
  plan: WorkflowPlan;
  /** How the repos were chosen: `repoRefs` — the named repos (a `projectId`, when given, was the
   *  filing only); `project` — the project's `crew.repo` members. Absent on a daemon predating it. */
  scope?: 'repoRefs' | 'project';
  campaignRegistered: false;
}

/** One produced test file as the verify phase judged it. */
export interface TestSetFile {
  path: string;
  /** `playwright` | `playwright-python` | `vitest` | `jest` | `pytest` | `python` | `unknown`. */
  harness: string;
  status: 'passed' | 'failed' | 'not-executed';
}

/**
 * A registered TEST SET (wave 6, F-7R2-014; api-types 0.36.0) — the produced tests of a terminal
 * `qe-author-tests` run, read back from its verify phase's `QE-VERIFY` report and recorded as a
 * durable `testing.testset.registered` audit entry the daemon hydrates at boot. Served as
 * `CampaignsListResponse.test_sets` — what the Test landing counts. Deny-dominates: a run whose
 * verify phase FAILED registers too (`verified: false`, counts intact) so a red set is shown, never
 * hidden; a run that never reached its verdict registers with zero counts and `plan: null`.
 */
export interface TestSet {
  /** `testset-<run id>` — one set per producing run. */
  id: string;
  run_id: string;
  workflow_id: QeAuthorTestsWorkflowId;
  /** The `RunGroup.label` the launch filed the run under, when it did. */
  label?: string;
  repo_ref: string | null;
  repo_name?: string;
  /** Unix millis. */
  registered_at: number;
  /** The producing run's terminal status. */
  run_status: SessionStatus | (string & {});
  /** The verify unit's status (`done` | `rejected` | …); `null` when the run never planned one. */
  verify_status: string | null;
  /** `true` ONLY when the verify phase passed: ≥ 1 produced test, every one executed and green,
   *  the repository checks green, the PLAN present. */
  verified: boolean;
  files: TestSetFile[];
  produced: number;
  executed: number;
  passed: number;
  failed: number;
  not_executed: number;
  /** The produced `tests/PLAN-*.md`, `null` when none was produced. */
  plan: string | null;
  /** The harnesses the produced tests ran under (unique, first-use order). */
  harnesses: string[];
  /** The delivered PR, when the engine's deliver phase opened one. */
  deliverUrl?: string;
}
// <<< VERBATIM

/** The recon body, vendored as EVIDENCE: no `workflow` key — studio's launch ladder sends none. */
// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:2745-2778 (crew#536) — TestingReconBody (no `workflow` key)
/**
 * The `POST /testing/recon` request body (api-types 0.15.0) — the Testing page's campaign-recon
 * trigger. `problem` is the recon brief, passed to every launched run VERBATIM (the client owns
 * the framing). The two optional fields are the multiscope wire, shared with
 * {@link LaunchCampaignBody}:
 *
 *  - `repoRefs` — explicit codebase attachments: registered repo refs (ids; a unique repo NAME
 *    also resolves), deduped; a ref that does not resolve fails the whole request with a 400
 *    naming it.
 *  - `projectId` — crew resolves the project's `crew.repo` members server-side (404 unknown
 *    project; 400 when the project has zero repo members and no `repoRefs` cover for it) AND
 *    files every launched run into the project (the `POST /runs` §2.2 semantics: atomic
 *    membership + project-graph binding).
 *
 * BOTH ⇒ the union (`repoRefs` order first). NEITHER ⇒ one unscoped recon run — the launch the
 * Testing page sent before this wire existed, unchanged.
 *
 * One engine run carries ONE repo, so a multi-repo recon FANS: one governed run per resolved
 * repo, all under one shared campaign label (`TestingReconResponse.campaign`) — and a real fan
 * (>= 2 repos) registers an ENGINE campaign under that same id, so `GET /campaigns` serves it
 * (api-types 0.17.0, crew#390).
 *
 * Every launched sibling pauses at its INTAKE GATE (`human_confirm: before:1` — the launch
 * banner's promise) by default; `ungated: true` is the EXPLICIT opt-out for an unattended fan
 * (api-types 0.17.0, crew#391). It is never the silent default, and it is audited.
 */
export interface TestingReconBody {
  problem: string;
  projectId?: string;
  repoRefs?: string[];
  /** EXPLICITLY launch the siblings unattended (no intake gate). Default `false`: each sibling
   *  pauses at its intake gate before any unit runs. */
  ungated?: boolean;
}
// <<< VERBATIM

/** The drop-in workflow id "New test" launches (wave 6). Read off `GET /workflows` — a daemon that
 *  does not list it has no governed test workflow, and the panel says so before launching. */
export const QE_AUTHOR_TESTS_WORKFLOW_ID = 'qe-author-tests' satisfies QeAuthorTestsWorkflowId;

// ── The campaigns surface — where the registered sets are served ──────────────────────────────

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:4396-4407 (crew#536) — CampaignsListResponse incl. test_sets
/**
 * `GET /campaigns` 200 body (api-types 0.19.0 — `groups` is ADDITIVE: a pre-0.19 daemon sends
 * only `campaigns`). One fetch answers the whole grouping surface: engine campaigns (each
 * carrying its own per-node rollup fields) plus the ad-hoc label groups.
 */
export interface CampaignsListResponse {
  campaigns: Campaign[];
  groups: RunGroup[];
  /** The registered test sets (wave 6, F-7R2-014; api-types 0.36.0 — ADDITIVE: a pre-0.36 daemon
   *  omits it). Newest first. See {@link TestSet}. */
  test_sets?: TestSet[];
}
// <<< VERBATIM

// ── The diff route once the worktree is gone ──────────────────────────────────────────────────

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:553-580 (crew#536) — RunDiff incl. source / branch / base
/**
 * Response of `GET /runs/:id/diff` / `GET /runs/:id/diff?path=<abs>` (DES-FEEDBACK-002 CREW-1) —
 * the run worktree's unified diff against HEAD (staged + unstaged), with untracked files appended
 * as all-addition `--no-index` hunks. `diff: ""` = clean tree (a real answer, not an error).
 * 404 unknown run; 409 when the run has no workdir or it no longer exists; with `path`, the same
 * 400/403 containment as `RunFileContent`.
 */
export interface RunDiff {
  /** Unified diff text (`git diff --no-color --no-ext-diff HEAD`), cut at 1 MB when `truncated`. */
  diff: string;
  /** The diff exceeded the 1 MB output cap and was cut. */
  truncated: boolean;
  /**
   * Where the diff was read from (wave 6, F-7R2-013; api-types 0.36.0): `worktree` — the live run
   * worktree (staged + unstaged + untracked; the pre-0.36 answer); `branch` — the run's retained
   * `wicked/<id>` branch in the REGISTERED repository, diffed against its base, served when the
   * engine has reaped the worktree (a completed run) so the files view never goes dark at
   * completion. A pre-0.36 daemon omits the field and answers 409 for a reaped worktree; 409 now
   * means "no worktree AND no run branch" (nothing was ever committed for the run).
   */
  source?: 'worktree' | 'branch';
  /** `source: 'branch'` — the run branch the diff was read from. */
  branch?: string;
  /** `source: 'branch'` — the base commit the branch was diffed against: the engine's recorded
   *  `AgentSession.base_commit` when it has one, else the branch's merge-base with the default
   *  branch; `?base=<ref>` overrides it with a plain in-repo ref. */
  base?: string;
}
// <<< VERBATIM

/** The two declared sources of a diff — studio's alias over {@link RunDiff}`.source`. */
export type RunDiffSource = NonNullable<RunDiff['source']>;

// ── Gate / floor / routing / fence / carrier / base events ────────────────────────────────────

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:1008-1059 (crew#536) — GateEvaluatedEvent incl. ungated / ungatedReason / floorNote / judgeSkippedReason
/** §3 B1 — the gate's decision depth, emitted alongside `gateDecided`. `denial` is the structured
 *  twin of `denialReason`: `null` when the gate approved, else the winning layer (deny-dominates) —
 *  `worktree_guard` and `repo_checks` are the two wicked-core F-036/F-039 layers. `judgeCli` /
 *  `judgeDistinct` (wicked-core#431 / F-3R2-007, api-types 0.33.0) name WHO rendered `agentVerdict`,
 *  so evaluator ≠ creator is auditable from the event stream alone (compare with the unit's
 *  `unitDistributed.cli`). Both keys are ALWAYS present: `null` when no judge ran (`agentVerdict`
 *  is `null` too) and on the bus-mediated evaluator path, where the seat is not reported back. */
export interface GateEvaluatedEvent {
  type: 'gateEvaluated';
  session: string;
  ord: number;
  criterion: string | null;
  hasDeterministicFloor: boolean;
  deterministicPass: boolean;
  agentVerdict: string | null;
  agentReasoning: string | null;
  evaluatorPass: boolean | null;
  /** Policy ids the evaluator≠creator pass applied (empty = vacuous default-allow, FINDING-025). */
  evaluatorPolicies: string[];
  denialReason: string | null;
  denial: UnitDenial | null;
  combined: boolean;
  /** The council seat key the layer-2 judge ran under (`codex`, `pi`, …) — WHO rendered
   *  `agentVerdict`. `null` when no judge ran, and on the bus-mediated path. */
  judgeCli: string | null;
  /** Whether that judge seat was IDENTITY-DISTINCT from the work's author: `true` for the rotation
   *  pick, `false` when the judge fell back to the single default runner (prompt-only independence).
   *  `null` when no judge ran or the seat is unknown. */
  judgeDistinct: boolean | null;
  /**
   * Wave 6 (F-7R2-005, api-types 0.36.0): `true` when NOTHING gated this unit — no deterministic
   * floor (no pinned validator, and the repo-checks floor did not apply), no agent judge, and an
   * EMPTY evaluator-policy selection — the exact default-allow shape run b86c14c1 passed seven times.
   * A consumer MUST render it as UNGATED, never as "pass", and a narrator must never say "checks
   * ran" without a `repoChecksEvaluated` for the same unit. Absent on an engine predating wave 6
   * (read `=== true`); `false` on a gated unit.
   */
  ungated?: boolean;
  /** WHY, when `ungated` — each absent layer and its cause (`"no judge: no eligible judge seat
   *  distinct from creator \`claude\` (roster: claude; benched: codex (signed out))"`). `null` when
   *  gated; absent on an older engine. */
  ungatedReason?: string | null;
  /** Wave 6 (wicked-core#449 @ 9e11685, api-types 0.36.0): WHY the deterministic layer is absent —
   *  set whenever `hasDeterministicFloor` is `false` on an agent unit, judge or not (`"no pinned
   *  validator; the repo-checks floor did not apply: the tree was not changed"`). `null` when a
   *  floor ran; absent on an older engine. */
  floorNote?: string | null;
  /** Wave 6: WHY no judge was convened for a unit that WANTED one (its tree changed and no pinned
   *  validator gated it) — `"no eligible judge seat distinct from creator \`claude\` (roster: …;
   *  benched: …)"`. `null` when a judge ran or none was wanted; absent on an older engine. */
  judgeSkippedReason?: string | null;
}
// <<< VERBATIM

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:1328-1385 (crew#536) — RepoChecksEvaluatedEvent incl. sandboxLevel / sandboxError / detectError
/** wicked-core F-039 — the engine ran the repository's OWN checks in the worktree for the def's
 *  code-verifying unit (`verified_evidence` with an `executes_code` creator upstream: `bug/verify`,
 *  `feature/test`, `migration/verify`) and folded them into the gate as a deterministic floor. Fires
 *  once per fold, just before `gateEvaluated` (whose `hasDeterministicFloor`/`criterion` include this
 *  floor). `checks` is what actually ran, in order (`package.json` `typecheck`/`lint`/`test` via the
 *  lockfile's package manager, an `install` first when `node_modules/` is absent; `Cargo.toml` →
 *  `cargo test`); `skipped` names detected checks not run because an earlier one failed. `passed:
 *  false` ⇒ the unit is denied (`denial.source` is `repo_checks`).
 *
 *  The checks are repo-controlled code and run ONLY inside an OS write boundary (macOS
 *  `sandbox-exec` / Linux `bwrap`: writes confined to the worktree, the curated secret directories
 *  unreadable, network open for installs) with an isolated `HOME`, `npm_config_cache`, `CARGO_HOME`,
 *  `CARGO_TARGET_DIR` and `XDG_*` under `<worktree>/tmp/wicked-checks/`, and with a MINIMAL
 *  environment — the daemon's env is cleared and only `PATH`, locale (`LANG`/`LC_*`), `TERM`,
 *  `USER`/`LOGNAME`, `RUSTUP_HOME`, the Windows shell essentials and those isolation overrides
 *  (`CI=1` included) reach a check: no token, API key or `WICKED_*` variable does; installs are always
 *  `--ignore-scripts` (`--no-package-lock` when the repo ships no lockfile). When NO boundary can be
 *  armed (no sandbox tool on the host — Windows) the checks do NOT run and the floor FAILS
 *  (`passed: false`, `checks: []`, the reason on the unit record) — repo-controlled scripts never
 *  run unsandboxed. Detection is fail-closed the same way: a `package.json` that cannot be read or
 *  parsed, or a symlinked manifest/lockfile/`node_modules` (every probe `lstat`s, opens `O_NOFOLLOW`
 *  and `fstat`s the opened descriptor before reading — links are never followed), FAILS the floor.
 *  Only a repo with NO DETECTABLE check is the disclosed vacuous pass (`checks: []`, `passed:
 *  true`): no manifest at all, or a readable `package.json` with no string `typecheck`/`lint`/`test`
 *  script and no `Cargo.toml`. A manifest that cannot be read or trusted still FAILS.
 *  "Done" for a verify phase is now the exit code the engine observed, not the seat's account of
 *  having run the suite.
 *
 *  wicked-core#431 (api-types 0.33.0): the frame ALSO arrives for the DELIVER ord — a Tool unit —
 *  whenever the worktree's tree is NOT the tree the run verified when the deliver phase is about to
 *  push: after a lift onto the remote tip ({@link DeliverLiftEvaluatedEvent} `outcome: 'lifted'`), on
 *  a retry after a failed re-verify, after an operator's by-hand rebase, or for a run that recorded
 *  no verified tree. The engine re-runs the repository's checks on the tree that would ship before
 *  allowing the push (a lockfile that moved with the base forces a frozen `--ignore-scripts` install
 *  first), and the deliver unit's `gateEvaluated` then carries `hasDeterministicFloor: true` with
 *  this floor's `criterion`. `passed: false` there fails the deliver unit closed — nothing is pushed.
 *  `type` alias on purpose — see {@link EvaluatorMutatedWorktreeEvent}. */
export type RepoChecksEvaluatedEvent = {
  type: 'repoChecksEvaluated';
  session: string;
  ord: number;
  attempt: number;
  passed: boolean;
  criterion: string;
  /** The checks that RAN. EMPTY means "0 checks detected" — a consumer must say so, never "checks
   *  ran"; since wave 6 the frame says WHY (`detectError`, `sandboxError`). */
  checks: RepoCheckRun[];
  skipped: string[];
  /** Wave 6 (wicked-core#449 @ 9e11685, api-types 0.36.0): the sandbox level the checks ran under
   *  (`bwrap`, `sandbox-exec`, `none`, …). Absent on an older engine. */
  sandboxLevel?: string;
  /** Wave 6: why the sandbox could not be armed, when it could not (`null` when it was). */
  sandboxError?: string | null;
  /** Wave 6: why check DETECTION failed (an unreadable `package.json`, a manifest with no
   *  `typecheck`/`lint`/`test` script, …) — the reason an empty `checks` is empty; `null` when
   *  detection succeeded. */
  detectError?: string | null;
};
// <<< VERBATIM

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:1645-1703 (crew#536) — UnitDistributedEvent (camelCase) + BenchedSeat
/**
 * Foundation wave: a unit was distributed with full routing detail.
 *
 * WIRE SPELLING (api-types 0.36.0, crew#533 follow-through): the engine's `CoreEvent::to_json` and
 * the napi frames spell these fields camelCase — `routingMethod`, `agreementPct`, `returned`,
 * `seated`, `dissent`, `degradedReason`, `seatConstraint` — exactly as `wicked-core-ts`'s own
 * `UnitDistributedEventJson` declares them; `packages/crew/tests/wire-contract.test.ts` pins this
 * interface against that type AND against a recorded frame. Pre-0.36 this interface declared the
 * snake_case spellings, which the engine never emitted — a consumer reading `degraded_reason` got
 * `undefined` and rendered a benched council as whole. The snake_case names stay for ONE minor as
 * `@deprecated` optional aliases (a normalising relay may still produce them); consumers read the
 * camelCase names. Every camelCase `Option` field is emitted unconditionally: `null`, never absent.
 */
export interface UnitDistributedEvent {
  type: 'unitDistributed';
  session: string;
  ord: number;
  /** The roster key of the assigned seat. */
  cli: string;
  /** How the seat was chosen: the council verdict, a degrade to the first candidate, an
   *  evaluator ≠ creator reassignment, or a deterministic tool execution. */
  routingMethod: 'council' | 'degraded' | 'evaluator_distinct' | 'tool';
  agreementPct: number | null;
  /** Ballots that came back. Read against `seated`. */
  returned: number | null;
  /** Seats CONVENED for the council that produced this assignment (`null` = unknown / not a council). */
  seated: number | null;
  dissent: number | null;
  /**
   * WHY the routing was degraded. Since wave 6 (F-7R2-006) the engine sets it on EVERY routing arm
   * whenever the eligible seat set is smaller than the configured roster — `"4 of 5 seats benched:
   * codex (signed out — launcher), pi (unauthenticated — ballot), …"` — not only for its `degraded`
   * arm, so a council that held on a fraction of its seats reads as degraded. `null` when whole.
   */
  degradedReason: string | null;
  /** WHY the candidate seats were narrowed BEFORE the council voted (core#401): a non-portable
   *  skill constrained the unit to a claude seat. `null` when every roster seat was a candidate. */
  seatConstraint: string | null;
  /** @deprecated api-types 0.36.0 — the engine emits `routingMethod`; removed in 0.37. */
  routing_method?: 'council' | 'degraded' | 'evaluator_distinct' | 'tool';
  /** @deprecated api-types 0.36.0 — the engine emits `agreementPct`; removed in 0.37. */
  agreement_pct?: number | null;
  /** @deprecated api-types 0.36.0 — the engine emits `degradedReason`; removed in 0.37. */
  degraded_reason?: string | null;
}

/** One seat the wave-6 engine BENCHED for a run (`AgentSession.benched_seats`, F-7R2-006): never
 *  convened, never a failover or judge target, named in `unitDistributed.degradedReason`. */
export interface BenchedSeat {
  /** The roster key. */
  cli: string;
  /** Why — the launcher's words (`signed out`) or the engine's classification (`not_logged_in`,
   *  `unauthenticated`). */
  reason: string;
  /** Who benched it: `launcher` (the roster's health probe — crew's `council_eligible`), `ballot`
   *  (a council seat failure), `worker` (a unit's worker failed with an auth refusal), `judge`
   *  (the seat failed while judging another unit — wicked-core#449 @ 9e11685). */
  source: 'launcher' | 'ballot' | 'worker' | 'judge' | (string & {});
}
// <<< VERBATIM

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:1535-1565 (crew#536) — WorkerToolCallDeniedEvent
/**
 * Wave 6 (F-7R2-012, api-types 0.36.0) — a WORKER seat asked to run a REMOTE-WRITING command
 * (`git push`, `gh pr create|merge|edit|comment`, a `gh api` mutation, `gh release`, …) and the
 * engine REFUSED it: delivery is performed by the run's deliver phase (which lifts, re-verifies,
 * pushes and opens the PR so the ledger records it), never by a creator or evaluator seat. Emitted
 * on both carriers: the ACP permission bridge (`carrier: 'acp'`) answers the seat's permission
 * request with its reject option; the wrapped carrier's PreToolUse gate hook (`carrier:
 * 'wrapped_cli'`) blocks the call and the fold replays the record at the gate. A refusal costs the
 * seat one tool call, never the unit — the seat continues with `remedy`. Spelled exactly as
 * wicked-core's `CoreEvent::to_json` emits it. `type` alias on purpose (relays through the
 * `CoreEvent`-typed seams unchanged).
 */
export type WorkerToolCallDeniedEvent = {
  type: 'workerToolCallDenied';
  session: string;
  ord: number;
  attempt: number;
  /** The registry seat key. */
  cli: string;
  /** `'acp'` | `'wrapped_cli'`; open-ended for a future carrier. */
  carrier: 'acp' | 'wrapped_cli' | (string & {});
  /** The unit's role (`creator` | `evaluator` | `neutral`). */
  role: 'creator' | 'evaluator' | 'neutral' | (string & {});
  /** The tool the seat invoked (`Bash`, `bash`, `shell`, …). */
  tool: string;
  /** The command text the seat sent. */
  command: string;
  reason: string;
  /** What the seat was told to do instead ("delivery is performed by the run's deliver phase"). */
  remedy: string;
};
// <<< VERBATIM

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:1108-1144 (crew#536) — AcpFallbackKind incl. the auth kinds + AcpFallbackEvent
/**
 * `acpFallback.fallbackKind` — WHY a unit left the ACP carrier for the wrapped (single-shot) one:
 * - `binary_unavailable` / `session_died` / `auth_required` — the ACP session could not be had; the
 *   run continues single-shot (a FAILURE of the seat's transport or account, counted by seat health);
 * - `governance_requires_wrapped` — a governed unit on a seat whose ACP adapter cannot enforce input
 *   governance is routed to the wrapped carrier by design (crew#276);
 * - `read_only_requires_wrapped` (wicked-core#431 / F-3R2-009, api-types 0.33.0) — an
 *   `executes_code: false` unit (an evaluator, a recon rung, a review) on an ACP seat NOT admitted to
 *   input governance (pi-acp, codex-acp) is routed to the wrapped carrier BEFORE any ACP turn, where
 *   the read-only lever is an argv fact (`--sandbox read-only` / `--exclude-tools edit,write`). No
 *   per-call {@link EvaluatorToolCallDeniedEvent} exists on that route — consumers must not wait for one.
 * The two `*_requires_wrapped` kinds are deliberate routing, not failures — never a seat-health signal.
 * Open-ended (`string & {}`) so a newer engine's kind parses in an older consumer.
 */
export type AcpFallbackKind =
  | 'binary_unavailable'
  | 'session_died'
  | 'auth_required'
  /** Wave 6 (F-7R2-019, api-types 0.36.0): the ACP handshake was REFUSED for authentication — the
   *  seat's account, not its binary (`pi-acp` existed; pi answered 401). The engine benches the seat
   *  for the run and does NOT attempt the single-shot wrapped fallback (it fails the same way). */
  | 'auth_failed'
  /** Wave 6 — the seat reported no credential at all (`unauthenticated`); same bench, same no-retry. */
  | 'unauthenticated'
  | 'governance_requires_wrapped'
  | 'read_only_requires_wrapped'
  | (string & {});

/** P1 — ACP unavailable or failed for a CLI, or the unit was deliberately routed off ACP; the run
 *  continues on the wrapped carrier. `fallbackKind` says which (see {@link AcpFallbackKind}). */
export interface AcpFallbackEvent {
  type: 'acpFallback';
  session: string;
  cliKey: string;
  reason: string;
  fallbackKind: AcpFallbackKind;
}
// <<< VERBATIM

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:1500-1528 (crew#536) — RunBaseResolvedEvent incl. runBranch
/** wicked-core#431 / F-3R2-013 — how the run's BASE commit was chosen when its worktree was minted:
 *  the engine fetches `origin` and, when the registered clone's `HEAD` is strictly behind the remote
 *  default branch's tip, bases the run on that tip — so the worker starts from the current code and
 *  the deliver lift has nothing to move. `lifted: true` = the base moved off the clone's `HEAD` by
 *  `behind` commits; `false` = `HEAD` was already the tip, or was ahead of / diverged from it (local
 *  unpushed work — kept, `note` says so), or no remote default ref resolved (`baseRef: null`).
 *  Emitted once per freshly minted worktree, BEFORE `worktreeReady`; a resumed run reuses its live
 *  worktree and emits nothing. Session-level (no `ord`). `type` alias on purpose. */
export type RunBaseResolvedEvent = {
  type: 'runBaseResolved';
  session: string;
  /** The remote default ref (`origin/main`), or `null` when none could be resolved. */
  baseRef: string | null;
  /** The commit the run worktree was minted from. */
  baseCommit: string;
  /** The registered clone's `HEAD` at mint time. */
  localHead: string;
  /** How many commits `localHead` was behind `baseRef`; `0` when not behind or unknown. */
  behind: number;
  /** Whether `git fetch origin` succeeded (a failed fetch is disclosed in `note`, cached refs used). */
  fetched: boolean;
  lifted: boolean;
  note: string | null;
  /** Wave 6 (F-7R2-013, api-types 0.36.0): the run branch the worktree was minted on
   *  (`wicked/<run id>`, sanitized), recorded on the session as `run_branch` beside `base_commit`
   *  so the run's diff is servable from the branch once the worktree is reaped. Absent on an
   *  engine predating wave 6. */
  runBranch?: string;
};
// <<< VERBATIM

// ── The roster — auth, free tier, council eligibility, the bench ──────────────────────────────

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:424-521 (crew#536) — RosterSeat incl. auth / auth_source / free_tier_source / council_eligible / council_bench + RosterSeatCouncilBench + SeatAuth
/**
 * A council seat (`AgenticCli`) as returned by `GET /roster`. Only the fields
 * the launch form uses are named; the index signature keeps the (large) rest of
 * the seat intact so it round-trips verbatim into `clisJson` on launch.
 */
export interface RosterSeat {
  key: string;
  display_name: string;
  binary: string;
  enabled_for_council: boolean;
  category?: string;
  /**
   * Runtime health (crew#274). Additive: absent on a daemon predating the field, and safe to
   * round-trip into `clisJson` (the engine's `AgenticCli` deserializer ignores unknown fields).
   * Absent-or-default reads as `active` with no message.
   */
  health?: SeatHealth;
  /**
   * The shell invocation that runs this seat's own interactive login flow (seat sign-in;
   * wicked-core PR#278 `AgenticCli.login_invocation`). Passed through from the engine roster
   * VERBATIM — the daemon never synthesizes one. The studio hosts it in a PTY terminal
   * (`POST /terminals`) so every CLI's native sign-in gets one uniform surface. Absent on an
   * engine predating the field (serde omits `None`) and on seats with no known login flow.
   */
  login_invocation?: string;
  /**
   * Whether the seat LOOKS signed in — a cheap file/env-presence HEURISTIC computed by the
   * daemon (`seat-signin.ts`), never a spawned probe and never proof the credential still
   * works. Three-valued on purpose: `true`/`false` when the seat's auth state is observable
   * from files or env, `null`/absent when it is unknowable cheaply (keychain-backed seats,
   * unknown seat keys, or a daemon predating the field).
   */
  signed_in?: boolean | null;
  /**
   * What `signed_in` MEANS for this seat (api-types 0.35.0, F-2R2-009): `signed_in` — a credential
   * artifact is observable; `signed_out` — none is and the seat needs one (a council benches it on
   * its first ballot; a chat refuses it up front); `not_required` — none is, but the seat answers
   * on a free tier with no account (`free_tier` names it); `unknown` — the probe cannot tell
   * cheaply (keychain-backed seats, unknown seat keys). Absent on a daemon predating the field.
   */
  auth?: SeatAuth;
  /**
   * Where `auth` came from (api-types 0.36.0, F-A45-006): `seat-stderr` — the seat ITSELF reported
   * no credential (a council ballot's "No API key found", a worker's 401, an authentication ACP
   * fallback) within the last 30 minutes with no ok output since, which OVERRIDES the credential-
   * file probe (`signed_in`) — the fresh rig's pi read `signed_in: true` off an empty `auth.json`
   * while every ballot failed. Absent = the probe decided (and since 0.36.0 the probe itself needs
   * a credential-SHAPED file, never mere presence).
   */
  auth_source?: 'seat-stderr';
  /** Present with `auth_source: 'seat-stderr'`: the seat's own words, bounded. */
  auth_evidence?: string;
  /** Present when `auth` is `not_required`: the free tier the seat answers on. */
  free_tier?: string;
  /**
   * Where the `not_required` reading came from: `registry` when the CLI's own record declared the
   * credential requirement, `crew-heuristic` when the daemon's per-CLI table did (today's only
   * source — the engine's `AgenticCli` declares none; a wicked-core follow-up). A reader can show
   * the heuristic as such.
   */
  free_tier_source?: 'registry' | 'crew-heuristic';
  /**
   * Whether a council would seat AND keep this seat as far as the daemon can tell: enabled for
   * council, runtime `health` active, `auth` not `signed_out`. The daemon's PREDICTION from its
   * own records — the engine still convenes whatever roster it is handed and benches a seat only
   * after it fails. Chat admission (`POST /chats` defaults) reads the same auth predicate.
   */
  council_eligible?: boolean;
  /** Present when `council_eligible` is false: the one reason, in the operator's words. */
  council_ineligible_reason?: string;
  /**
   * Present when THIS daemon's recent councils benched the seat: the engine's own
   * `councilSeatFailed` evidence (`non_zero_exit` / `timed_out`, the derivative `benched` kind
   * excluded), folded over a bounded window (`window_ms`) and cleared by the seat's next ok unit
   * output. `council_eligible` is false while it is present.
   */
  council_bench?: RosterSeatCouncilBench;
  [k: string]: unknown;
}

/** `RosterSeat.council_bench` (api-types 0.35.0). */
export interface RosterSeatCouncilBench {
  /** Primary ballot failures inside the window. */
  failures: number;
  /** The last failure's `councilSeatFailed.kind`. */
  last_kind: string;
  /** ISO-8601 of the last failure. */
  last_at: string;
  /** The run the last failure happened in, when the frame named one. */
  last_run?: string;
  /** A bounded excerpt of the last failure's detail / stderr, when there was one. */
  last_detail?: string;
  /** The rolling window the failures were counted over, ms. */
  window_ms: number;
}

/** A seat's auth reading (`RosterSeat.auth`; api-types 0.35.0). */
export type SeatAuth = 'signed_in' | 'signed_out' | 'not_required' | 'unknown';
// <<< VERBATIM

// ── Chat admission — the refused seats and why ────────────────────────────────────────────────

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:3917-3978 (crew#536) — ChatSeatOutcome, ChatRefusalSource, ChatSeatRefusal, ChatOpenResponse incl. refused[], ChatSeatRefusedFrame
/** One seat's warm-up outcome on `POST /chats`. */
export interface ChatSeatOutcome {
  cliKey: string;
  ok: boolean;
  error?: string;
}

/**
 * One seat a `POST /chats` did NOT seat, and why (api-types 0.35.0, F-2R2-007): a DEFAULT seat the
 * daemon's admission dropped before the engine saw it (signed out; not admissible to a scoped chat
 * — its ACP adapter asks no permissions and arms no sandbox, or it has no ACP adapter), or a
 * REQUESTED seat (`clis`) the engine refused (`ChatSeatOutcome.ok: false`, its `error` repeated
 * here as `reason`). One list for the scope card and the thread to read.
 */
/**
 * Why a seat was not seated (api-types 0.36.0, F-A45-011): `auth` — signed out (the probe, or the
 * seat's own "no credential" report); `scope` — the scoped-chat admission rule; `bench` — benched by
 * this daemon's recent councils; `budget` — the engine did not warm it within its dispatch budget
 * (the seat timed out or was dropped at dispatch); `engine` — the engine refused it with its own
 * reason. Open-ended so a newer daemon's source parses in an older skin.
 */
export type ChatRefusalSource = 'auth' | 'scope' | 'bench' | 'budget' | 'engine' | (string & {});

export interface ChatSeatRefusal {
  cliKey: string;
  reason: string;
  /** api-types 0.36.0 (F-A45-011): the cause class. Absent on a daemon predating the field. Since
   *  0.36.0 EVERY requested-or-defaulted seat that is not in `seats` as warm has an entry — a seat
   *  the engine DROPPED at dispatch (absent from `seats` altogether) included, never a silent gap. */
  source?: ChatRefusalSource;
}

/** `POST /chats` → 201. */
export interface ChatOpenResponse {
  chatId: string;
  seats: ChatSeatOutcome[];
  /** The resolved scope (crew#502). */
  scope: ChatScope;
  /** Present when the chat opened but its `crew.chat` filing into `projectId` failed. */
  projectAttachError?: string;
  /** Every seat that was asked for or defaulted and is NOT in `seats` as warm, with its reason
   *  (api-types 0.35.0). Empty when every seat warmed; absent on a daemon predating the field. */
  refused?: ChatSeatRefusal[];
}

/**
 * A seat refused at `POST /chats` (api-types 0.35.0, F-2R2-007). DAEMON-SYNTHETIC: broadcast
 * straight to `/ws` once per refused seat, right after the open, so the chat thread can say why a
 * seat is missing (the studio's `chat-scope-admission` copy) — the engine emits nothing for a seat
 * it never saw. `chat` names the chat the way the engine's `chatClosed` does; `project_id` rides
 * along when the chat was filed. An anonymous object type on purpose, like the stall frames, so it
 * flows through `CoreEvent`-typed seams.
 */
export type ChatSeatRefusedFrame = {
  type: 'chatSeatRefused';
  chat: string;
  cliKey: string;
  reason: string;
  /** api-types 0.36.0 (F-A45-011): the cause class — see {@link ChatRefusalSource}. */
  source?: ChatRefusalSource;
  project_id?: string;
};
// <<< VERBATIM

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:4000-4010 (crew#536) — ChatDetailResponse incl. refused[]
/** `GET /chats/:id` → 200. */
export interface ChatDetailResponse {
  chatId: string;
  seats: string[];
  /** The scope recorded at open; `null` for a chat this daemon did not open (or after a restart). */
  scope: ChatScope | null;
  /** The seats refused at open (api-types 0.36.0, F-A45-011) — the same list the 201 carried, so
   *  the admission copy survives a reload; `null` for a chat this daemon did not open; absent on a
   *  daemon predating the field. */
  refused?: ChatSeatRefusal[] | null;
}
// <<< VERBATIM

// ── The daemon-wide docs listing (no bridge spawn) ────────────────────────────────────────────

// >>> VERBATIM wicked-crew-api-types@0.36.0 index.d.ts:3741-3795 (crew#536) — GET /interactive/docs: InteractiveDocsListing, InteractiveSeamKind, InteractiveDocIndexRow, InteractiveDocsUnreachable
/**
 * `GET /api/v1/interactive/docs` (api-types 0.36.0, studio #263) — every interactive document across
 * projects, listed by the DAEMON from disk WITHOUT spawning a bridge: each project's docs root
 * (the per-project `interactiveRoot` binding, else `WICKED_INTERACTIVE_ROOT`, else the default
 * root / its `projects/<id>` partition), each slug-named child carrying a `versions.json`, read by
 * the bridge's own `listDocs` rules — plus what only the daemon knows: the seams that answered
 * the document and the governed runs they launched (the handoff ledgers). The per-project
 * `GET /projects/:id/interactive/api/docs` spawns one bridge per project (≈60 s cold start) — a
 * skin must never fan that out on mount; this is the listing it mounts with. `?includeRetired=1`
 * lists tombstoned rows too.
 */
export interface InteractiveDocsListing {
  /** Newest first (by `updatedAt`), then by name. */
  docs: InteractiveDocIndexRow[];
  /** Project docs roots the daemon could not read (or a partition its containment walk refused),
   *  with the reason — never silently dropped. `[]` when every root was readable. */
  unreachable: InteractiveDocsUnreachable[];
}

/** The seams that can answer a document (the handoff ledgers). */
export type InteractiveSeamKind = 'draft' | 'edit' | 'chat' | 'demo' | (string & {});

/** One document on the daemon-wide listing (api-types 0.36.0). */
export interface InteractiveDocIndexRow {
  /** The project whose docs root holds the document. A root SHARED by several projects (an
   *  explicit `interactiveRoot` binding, or `WICKED_INTERACTIVE_ROOT` applying to all) lists once,
   *  under the first project in listing order (the synthesized `default` first). */
  projectId: string;
  /** The doc name (slug). */
  name: string;
  /** Manifest `kind`; a manifest without one lists as `doc`. */
  kind: 'doc' | 'html' | 'source' | 'demo' | (string & {});
  /** Head version; `null` when the manifest carries none. */
  head: number | null;
  /** Lineage size. */
  versions: number;
  /** ISO-8601 of the head (last) version, or `null` when the lineage is empty. */
  updatedAt: string | null;
  /** Present only on a retired (tombstoned) row, listed only with `?includeRetired=1`. */
  retired?: true;
  /** ISO-8601 retirement timestamp; present with `retired`. */
  retiredAt?: string;
  /** The seams that answered this document, from the handoff ledgers (`[]` = none yet). */
  kinds: InteractiveSeamKind[];
  /** The governed runs those seams launched for it (ledger order) — the doc ↔ run binding. */
  runs: string[];
}

/** A project docs root the listing could not read (api-types 0.36.0). */
export interface InteractiveDocsUnreachable {
  projectId: string;
  /** The resolved root, or `null` when the containment walk refused the partition before resolving one. */
  root: string | null;
  error: string;
}
// <<< VERBATIM

/**
 * Studio's NORMALIZED row of the daemon-wide listing — what `docsIndexOf` hands the Vibe corpus
 * and the Home door: {@link InteractiveDocIndexRow} narrowed to the fields the surfaces count on,
 * in studio's own snake_case (the surfaces were written against it while the wire was unpublished;
 * the wire spells `projectId` / `updatedAt` and the reader accepts both).
 */
export interface InteractiveDocsIndexRow {
  project_id: string;
  name: string;
  kind: string;
  head: number;
  versions: number;
  updated_at: string | null;
}

/** Narrow the daemon-wide listing off the wire bag — rows without a project or a name are dropped;
 *  a body without `docs` is `null` (not the route's answer). */
export function docsIndexOf(body: unknown): InteractiveDocsIndexRow[] | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as Record<string, unknown>)['docs'];
  if (!Array.isArray(raw)) return null;
  const out: InteractiveDocsIndexRow[] = [];
  for (const r of raw) {
    if (typeof r !== 'object' || r === null) continue;
    const b = r as Record<string, unknown>;
    const pid = str(b['project_id']) ?? str(b['projectId']);
    const name = str(b['name']);
    if (pid === null || name === null) continue;
    out.push({
      project_id: pid,
      name,
      kind: str(b['kind']) ?? 'doc',
      head: typeof b['head'] === 'number' ? b['head'] : 0,
      versions: typeof b['versions'] === 'number' ? b['versions'] : 0,
      updated_at: str(b['updated_at']) ?? str(b['updatedAt']),
    });
  }
  return out;
}

/** The remedy the studio states when a frame carries none (the engine's own sentence). */
export const WORKER_REMOTE_WRITE_REMEDY = "delivery is performed by the run's deliver phase";

// ── Null-safe readers (one spelling per field, shared by every surface) ───────────────────────

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** `gateEvaluated.ungated` as the frame SAYS it — `true` only on an explicit `true`. */
export function gateUngated(ev: CoreEvent): boolean {
  return (ev as Record<string, unknown>)['ungated'] === true;
}

/** `gateEvaluated.ungatedReason`, or `null` when the frame carries none. */
export function gateUngatedReason(ev: CoreEvent): string | null {
  return str((ev as Record<string, unknown>)['ungatedReason']);
}

/** `unitDistributed.degradedReason` — the camelCase spelling the engine emits and 0.36.0 declares.
 *  The `@deprecated` snake_case alias is NOT read: the engine never emitted it. */
export function distributionDegradedReason(ev: CoreEvent): string | null {
  return str((ev as Record<string, unknown>)['degradedReason']);
}

/** `unitDistributed.agreementPct` (camelCase as emitted and declared); `null` when absent or not finite. */
export function distributionAgreementPct(ev: CoreEvent): number | null {
  const v = (ev as Record<string, unknown>)['agreementPct'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** `RunDiff.source` — `null` when the daemon predates the field (a worktree diff, by construction). */
export function diffSource(d: RunDiff): RunDiffSource | null {
  const s = d.source;
  return s === 'branch' || s === 'worktree' ? s : null;
}

// ── The registered test sets — `CampaignsListResponse.test_sets`, read null-safely ────────────

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** One `TestSetFile` narrowed off the wire; `null` unless the row names its `path`. An unknown
 *  status token reads as `not-executed` — never as a pass (deny-dominates). */
function testSetFileOf(raw: unknown): TestSetFile | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const f = raw as Record<string, unknown>;
  const path = str(f['path']);
  if (path === null) return null;
  const status = f['status'];
  return {
    path,
    harness: str(f['harness']) ?? 'unknown',
    status: status === 'passed' || status === 'failed' ? status : 'not-executed',
  };
}

/**
 * One `TestSet` row narrowed off the wire bag — `null` unless it names its producing `run_id` (the
 * join key; a row without one attaches to nothing). The contract declares every count required;
 * a count that is not a finite number reads as 0 and the row is still shown, never dropped — a
 * malformed registration is a red set, not a hidden one. `verified` is `true` only on an explicit
 * `true`.
 */
export function testSetOf(raw: unknown): TestSet | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Record<string, unknown>;
  const runId = str(t['run_id']);
  if (runId === null) return null;
  const label = str(t['label']);
  const repoName = str(t['repo_name']);
  const deliverUrl = str(t['deliverUrl']);
  return {
    id: str(t['id']) ?? `testset-${runId}`,
    run_id: runId,
    workflow_id: QE_AUTHOR_TESTS_WORKFLOW_ID,
    ...(label !== null ? { label } : {}),
    repo_ref: str(t['repo_ref']),
    ...(repoName !== null ? { repo_name: repoName } : {}),
    registered_at: num(t['registered_at']),
    run_status: str(t['run_status']) ?? 'unknown',
    verify_status: str(t['verify_status']),
    verified: t['verified'] === true,
    files: Array.isArray(t['files'])
      ? (t['files'] as unknown[]).map(testSetFileOf).filter((f): f is TestSetFile => f !== null)
      : [],
    produced: num(t['produced']),
    executed: num(t['executed']),
    passed: num(t['passed']),
    failed: num(t['failed']),
    not_executed: num(t['not_executed']),
    plan: str(t['plan']),
    harnesses: Array.isArray(t['harnesses'])
      ? (t['harnesses'] as unknown[]).filter((h): h is string => typeof h === 'string' && h !== '')
      : [],
    ...(deliverUrl !== null ? { deliverUrl } : {}),
  };
}

/** The `test_sets` list as read: the joinable rows plus the count of rows that could NOT be joined. */
export interface TestSetsRead {
  /** Every row naming its `run_id`, wire order (newest first). */
  sets: TestSet[];
  /** Rows the daemon registered WITHOUT a `run_id` (nothing to join, nothing to open). Counted, never
   *  hidden — a malformed registration is still a registration (review of #266, F-2). */
  malformed: number;
}

/**
 * `CampaignsListResponse.test_sets` off the `GET /campaigns` body: `null` when the daemon carries
 * no such key (pre-0.36 — absence, never a fabricated empty list), else the joinable rows in wire
 * order (newest first) plus how many rows were malformed. `{ sets: [], malformed: 0 }` is a real
 * answer: a 0.36 daemon with nothing registered yet.
 */
export function testSetsReadOf(body: unknown): TestSetsRead | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = (body as Record<string, unknown>)['test_sets'];
  if (!Array.isArray(raw)) return null;
  const sets: TestSet[] = [];
  let malformed = 0;
  for (const row of raw) {
    const t = testSetOf(row);
    if (t !== null) sets.push(t);
    else malformed += 1;
  }
  return { sets, malformed };
}

/** The joinable rows alone — {@link testSetsReadOf} without the malformed count. */
export function testSetsOf(body: unknown): TestSet[] | null {
  return testSetsReadOf(body)?.sets ?? null;
}
