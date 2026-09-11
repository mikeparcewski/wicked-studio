/**
 * MIRROR of the wicked-crew-api-types 0.36.0 wave-6 additions (the governed testing journey —
 * wicked-crew `feat/qe-test-authoring-workflow`, wicked-core `feat/governed-testing-floor-and-fence`)
 * — replace with imports from the published package at release.
 *
 * PROVISIONAL: 0.36.0 is not published while this file is written. Every name below is spelled
 * EXACTLY as the wave-6 briefs give it (camelCase as the engine's `event_to_json` emits), and
 * every reader in studio is null-safe, so an older daemon — 0.34.0/0.35.0, which sends none of
 * these keys — changes nothing. At the release swap the body becomes VERBATIM regions copied from
 * the package's `index.d.ts` between `>>> VERBATIM` / `<<< VERBATIM` markers, pinned byte-for-byte
 * by `tests/wave6Wire.test.ts` against a vendored fixture AND the installed package (the
 * `skills-wire.ts` / `tests/skillsWire.test.ts` pattern from #257). Until then that test asserts
 * the pin is BELOW 0.36.0 and this header still says PROVISIONAL — a pin bump without the
 * re-vendor fails the suite.
 *
 * What the wave adds, and where studio reads it:
 *  - {@link QE_AUTHOR_TESTS_WORKFLOW_ID} — the drop-in workflow "New test" launches (recon → author →
 *    verify → review → deliver); studio reads its presence off `GET /workflows`, never assumes it.
 *  - {@link TestingAuthorBody} / {@link TestingAuthorResponse} — the launch route for THAT workflow
 *    (`POST /testing/author`; the recon body grows an additive `workflow` too). `workflow` on the
 *    answer echoes what the daemon launched.
 *  - {@link TestSetRegistration} — the produced test set a completed `qe-author-tests` run registers
 *    on the campaigns surface (`Campaign.test_set` / `RunGroup.test_set`, daemon-joined like
 *    `node_delivery`), with the counts the verify phase RE-DERIVED (executed / passed / failed) —
 *    never the author's claim.
 *  - {@link RunDiffSource} — `GET /runs/:id/diff` answers 200 with `source: "branch"` (the run branch
 *    vs its base) once the worktree is gone, instead of 409.
 *  - {@link GateEvaluatedUngated} — `gateEvaluated.ungated` / `ungatedReason`: the engine SAYS no
 *    judge seat could be convened ("no eligible judge seat"), so the card reads UNGATED, not pass.
 *  - {@link UnitDistributedWave6} — `unitDistributed.degradedReason` (+ the camelCase twins of the
 *    snake_case names 0.34.0 declared: `agreementPct`, `seated`, `routingMethod`): why the council
 *    was smaller than configured ("4 of 5 seats benched: …").
 *  - {@link WorkerToolCallDeniedEvent} — a creator/evaluator seat asked for a REMOTE WRITE
 *    (`git push`, `gh pr create`, …) and the fence refused it; `remedy` says delivery is the run's
 *    deliver phase's job.
 */

import type { CoreEvent, RunDiff } from './types.js';

// ── The QE authoring workflow ─────────────────────────────────────────────────────────────────

/** The drop-in workflow id "New test" launches (wave 6). Read off `GET /workflows` — a daemon that
 *  does not list it has no governed test workflow, and the panel says so before launching. */
export const QE_AUTHOR_TESTS_WORKFLOW_ID = 'qe-author-tests';

/**
 * `POST /testing/author` body — launch the `qe-author-tests` workflow with the operator's intent as
 * the problem statement. Every sibling pauses at its intake gate (`before:1`) by default; the intake
 * card shows the planned phases + seats.
 *
 * SCOPE SEMANTICS — a REQUIREMENT on the wave-6 crew PR, NOT the recon route's union (independent
 * review of #263, R2-1): `repoRefs` WITH `projectId` is the EXACT set of repositories to launch over
 * — `projectId` FILES the runs into the project and never adds its other members back in. That is
 * what lets a narrowed project ("attach the project, drop repos", F-076) launch in ONE call with the
 * engine's own deliver phase. `repoRefs` alone = those repos, unfiled; `projectId` alone = every
 * member, filed (as today). Studio guards the answer: a route that returns more `runIds` than repos
 * requested did not honour the narrowing, and the panel says so instead of claiming the scope.
 */
export interface TestingAuthorBody {
  problem: string;
  projectId?: string;
  repoRefs?: string[];
  /** EXPLICITLY launch unattended (no intake gate). Default `false`. */
  ungated?: boolean;
}

/** `POST /testing/author` 201 body — `TestingReconResponse` plus the workflow the daemon launched. */
export interface TestingAuthorResponse {
  runId: string;
  runIds: string[];
  campaign: string;
  campaignRegistered: boolean;
  /** The workflow id every launched run carries (`qe-author-tests`). */
  workflow: string;
  projectAttachError?: string;
}

/** The additive `workflow` key on `TestingReconBody` (0.36.0): route the recon launch through a
 *  registered workflow instead of free-text planning. A pre-0.36 daemon's strict schema 400s it
 *  as an unrecognized key — the launch chain reads that refusal and falls back. */
export interface TestingReconWorkflowBody {
  problem: string;
  projectId?: string;
  repoRefs?: string[];
  ungated?: boolean;
  workflow?: string;
}

// ── The produced test set (campaign registration) ─────────────────────────────────────────────

/** The counts the VERIFY phase re-derived over the produced tests — `executed` is how many the run
 *  actually ran; a set whose `executed < tests` was not fully verified and the card says so. */
export interface TestSetCounts {
  files: number;
  tests: number;
  executed: number;
  passed: number;
  failed: number;
}

/**
 * The test set a completed `qe-author-tests` run registers (0.36.0) — DAEMON-JOINED onto the
 * campaigns surface (`Campaign.test_set` / `RunGroup.test_set`), so the Test landing shows what a
 * New test produced with its counts, from ONE `GET /campaigns`.
 */
export interface TestSetRegistration {
  /** The run that produced the set. */
  runId: string;
  /** The workflow that produced it (`qe-author-tests`). */
  workflow: string;
  /** Repo-relative paths of the produced test files. */
  files: string[];
  counts: TestSetCounts;
  /** Repo-relative path of the PLAN the author phase wrote; `null` when none. */
  plan: string | null;
  /** The delivered PR URL when the deliver phase opened one; `null` otherwise. */
  prUrl: string | null;
}

/** A campaign row (or ad-hoc group) as the wave-6 wire decorates it. */
export interface WithTestSet {
  test_set?: TestSetRegistration | null;
}

// ── The diff route once the worktree is gone ──────────────────────────────────────────────────

/** Where `GET /runs/:id/diff` read the diff from (0.36.0): `worktree` = the live worktree vs HEAD
 *  (today's answer, uncommitted work only); `branch` = the run branch vs its base commit, served
 *  once the worktree is reaped — COMMITTED work included. Absent from a pre-0.36 daemon. */
export type RunDiffSource = 'worktree' | 'branch';

export interface RunDiffWave6 extends RunDiff {
  source?: RunDiffSource;
}

// ── Gate / routing / fence events ─────────────────────────────────────────────────────────────

/** `gateEvaluated` (0.36.0): the engine SAYS the unit went ungated — no eligible judge seat could be
 *  convened (evaluator ≠ creator could not be held) — and why. Absent from a pre-0.36 daemon, where
 *  the card's "no floor, no judge, no policy" fold is the only signal. */
export interface GateEvaluatedUngated {
  ungated?: boolean;
  ungatedReason?: string | null;
}

/** `unitDistributed` (0.36.0): the camelCase names the engine emits (declared in 0.34.0 as
 *  snake_case, which consumers read as undefined) plus `degradedReason` — set whenever the eligible
 *  seat set was smaller than the configured seats ("4 of 5 seats benched: codex, pi (signed out)"). */
export interface UnitDistributedWave6 {
  routingMethod?: 'council' | 'degraded' | 'evaluator_distinct' | 'tool';
  agreementPct?: number | null;
  returned?: number | null;
  seated?: number | null;
  dissent?: number | null;
  degradedReason?: string | null;
}

/**
 * `workerToolCallDenied` (0.36.0, F-7R2-012): a creator/evaluator seat asked for a REMOTE-WRITING
 * command (`git push`, `gh pr create|merge|edit|comment`, `gh api` mutations, `gh release`) and the
 * fence refused it — delivery is the ENGINE's job (the run's deliver phase). Mirrors
 * `EvaluatorToolCallDeniedEvent`'s envelope; `role` and `command` are the two facts the brief names.
 */
export interface WorkerToolCallDeniedEvent {
  type: 'workerToolCallDenied';
  session: string;
  ord: number;
  attempt: number;
  /** The registry seat key. */
  cli: string;
  /** The carrier the refusal happened on — `acp` (the per-call deny) or `wrapped_cli` (the
   *  wrapped carrier's command filter). Open-ended for a future carrier (core #449 emits both). */
  carrier: 'acp' | 'wrapped_cli' | (string & {});
  /** The seat's role on the unit — `creator`, `evaluator`, or `neutral` (a recon/planning rung;
   *  core #449 emits all three). */
  role: string;
  /** The tool the seat asked for, as it named it (`Bash`, `shell`, `run_command`, …). */
  tool: string;
  /** The refused command, as the seat spelled it. */
  command: string;
  reason: string;
  /** The remedy the engine attaches ("delivery is performed by the run's deliver phase"). */
  remedy: string | null;
}

// ── The daemon-wide docs listing (no bridge spawn) ────────────────────────────────────────────

/**
 * `GET /interactive/docs` (0.36.0 — the wave-6 crew PR): every project's documents from the
 * state-home doc LEDGERS, served by the daemon itself — it never resolves a project root and never
 * starts a `wicked-interactive` bridge. The cheap census the Vibe surface and the Home door count
 * from (independent review of #263, F-1); absent on a pre-0.36 daemon (route-absent 404), and then
 * studio counts only what a surface has already listed. PROVISIONAL spelling: rows are the bridge's
 * `DocSummary` (snake_case, as `GET /projects/:id/interactive/api/docs` serves them) plus the
 * project they belong to.
 */
export interface InteractiveDocsIndexRow {
  project_id: string;
  name: string;
  kind: string;
  head: number;
  versions: number;
  updated_at: string | null;
}

export interface InteractiveDocsIndexResponse {
  docs: InteractiveDocsIndexRow[];
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

/**
 * `unitDistributed.degradedReason` — the camelCase spelling the engine emits, with the snake_case
 * `degraded_reason` 0.34.0 declared read as the fallback. TODO(api-types 0.36.0): drop the
 * snake_case read once the pin declares the camelCase name.
 */
export function distributionDegradedReason(ev: CoreEvent): string | null {
  const bag = ev as Record<string, unknown>;
  // The camelCase key PRESENT — even as an explicit `null` (the engine saying "none") — is the
  // answer; the snake_case read is only for a frame that never carried the camelCase key.
  if ('degradedReason' in bag) return str(bag['degradedReason']);
  return str(bag['degraded_reason']);
}

/** `unitDistributed.agreementPct` (camelCase as emitted), `agreement_pct` as the 0.34.0 fallback.
 *  TODO(api-types 0.36.0): drop the snake_case read. */
export function distributionAgreementPct(ev: CoreEvent): number | null {
  const bag = ev as Record<string, unknown>;
  const v = 'agreementPct' in bag ? bag['agreementPct'] : bag['agreement_pct'];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** `RunDiff.source` — `null` when the daemon predates the field (a worktree diff, by construction). */
export function diffSource(d: RunDiff): RunDiffSource | null {
  const s = (d as RunDiffWave6).source;
  return s === 'branch' || s === 'worktree' ? s : null;
}

/** `Campaign.test_set` / `RunGroup.test_set` narrowed off the wire bag — `null` unless the shape holds. */
export function testSetOf(row: unknown): TestSetRegistration | null {
  if (typeof row !== 'object' || row === null) return null;
  const raw = (row as Record<string, unknown>)['test_set'];
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Record<string, unknown>;
  const counts = t['counts'];
  if (typeof t['runId'] !== 'string' || typeof counts !== 'object' || counts === null) return null;
  const c = counts as Record<string, unknown>;
  const n = (k: string): number => (typeof c[k] === 'number' && Number.isFinite(c[k]) ? (c[k] as number) : 0);
  return {
    runId: t['runId'],
    workflow: str(t['workflow']) ?? QE_AUTHOR_TESTS_WORKFLOW_ID,
    files: Array.isArray(t['files']) ? (t['files'] as unknown[]).filter((f): f is string => typeof f === 'string') : [],
    counts: { files: n('files'), tests: n('tests'), executed: n('executed'), passed: n('passed'), failed: n('failed') },
    plan: str(t['plan']),
    prUrl: str(t['prUrl']),
  };
}
