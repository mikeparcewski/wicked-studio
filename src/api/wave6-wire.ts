/**
 * The wave-6 wire — the governed testing journey (crew#536) — plus the null-safe readers every
 * surface shares, one spelling per field.
 *
 * The contract shapes (`TestingAuthorBody` / `TestingAuthorResponse`, `WorkflowPlan`, `TestSet`,
 * `TestingReconBody`, `CampaignsListResponse`, `RunDiff`, the gate / floor / routing / fence /
 * carrier / base events, `RosterSeat`, the chat seat shapes, the interactive docs index,
 * `IntentAmendment`, `RefusedWorkflow`) are imported from `wicked-crew-api-types` (pin 0.92.0,
 * ASK-S1) and re-exported here, so every importer of this module keeps its names. The byte-pinned
 * VERBATIM mirror that lived here while the pin lagged, and `tests/wave6Wire.test.ts` that guarded
 * it, are gone: the package IS the evidence now. The readers below (`gateUngated*`,
 * `distribution*`, `diffSource`, `testSetsOf`, `docsIndexOf`, `intentAmendmentsOf`, `judge*Of`,
 * `refusedWorkflowsOf`) are studio's own and are pinned by `tests/wave6Readers.test.ts`.
 *
 * Two shapes studio 0.5.7 coded against PROVISIONALLY (a row-level `Campaign.test_set` /
 * `RunGroup.test_set` join; `TestingReconBody.workflow`) are not on the wire: the produced sets ride
 * the declared TOP-LEVEL `CampaignsListResponse.test_sets`, and the recon body carries no `workflow`
 * key — studio sends none.
 */

import { api } from './client.js';
import type { Project as CrewProject } from './types.js';
import type { CoreEvent } from './types.js';
import type { QeAuthorTestsWorkflowId, TestingAuthorBody, WorkflowPlanPhase, WorkflowPlan, TestingAuthorRun, TestingAuthorResponse, TestSetFile, TestSet, TestingReconBody, CampaignsListResponse, RunDiff, GateEvaluatedEvent, RepoChecksEvaluatedEvent, UnitDistributedEvent, BenchedSeat, WorkerToolCallDeniedEvent, AcpFallbackKind, AcpFallbackEvent, RunBaseResolvedEvent, RosterSeat, RosterSeatCouncilBench, SeatAuth, ChatSeatOutcome, ChatRefusalSource, ChatSeatRefusal, ChatSingleSeatDegradation, ChatOpenResponse, ChatMessageResponse, ChatSeatRefusedFrame, ChatDetailResponse, InteractiveDocsListing, InteractiveSeamKind, InteractiveDocIndexRow, InteractiveDocsUnreachable, IntentAmendment, RefusedWorkflow } from 'wicked-crew-api-types';
export type { QeAuthorTestsWorkflowId, TestingAuthorBody, WorkflowPlanPhase, WorkflowPlan, TestingAuthorRun, TestingAuthorResponse, TestSetFile, TestSet, TestingReconBody, CampaignsListResponse, RunDiff, GateEvaluatedEvent, RepoChecksEvaluatedEvent, UnitDistributedEvent, BenchedSeat, WorkerToolCallDeniedEvent, AcpFallbackKind, AcpFallbackEvent, RunBaseResolvedEvent, RosterSeat, RosterSeatCouncilBench, SeatAuth, ChatSeatOutcome, ChatRefusalSource, ChatSeatRefusal, ChatSingleSeatDegradation, ChatOpenResponse, ChatMessageResponse, ChatSeatRefusedFrame, ChatDetailResponse, InteractiveDocsListing, InteractiveSeamKind, InteractiveDocIndexRow, InteractiveDocsUnreachable, IntentAmendment, RefusedWorkflow };

// ── The governed test-authoring launch (wave 6; api-types 0.36.0) ──────────────────────────────

/** The drop-in workflow id "New test" launches (wave 6). Read off `GET /workflows` — a daemon that
 *  does not list it has no governed test workflow, and the panel says so before launching. */
export const QE_AUTHOR_TESTS_WORKFLOW_ID = 'qe-author-tests' satisfies QeAuthorTestsWorkflowId;

// ── The diff route once the worktree is gone ──────────────────────────────────────────────────

/** The two declared sources of a diff — studio's alias over {@link RunDiff}`.source`. */
export type RunDiffSource = NonNullable<RunDiff['source']>;

// ── The daemon-wide docs listing (no bridge spawn) ────────────────────────────────────────────

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

/** Additive crew#556 field, read outside the pinned mirror. Older daemons omit it (null). Any
 *  non-null value discloses a distinctness fallback — `same_cli_instance` since wicked-core#595 /
 *  crew#666, and an unrecognised value as `{ unrecognised }` (the contract: never read as distinct). */
export function distributionDistinctnessFallback(ev: CoreEvent): DistinctnessFallback | null {
  const value = (ev as Record<string, unknown>)['distinctnessFallback'];
  if (value == null) return null;
  if (value === 'creator_seat' || value === 'same_cli_instance') return value;
  // The contract (api-types 0.39.0): an unrecognised value is a disclosure too, never "distinct".
  return { unrecognised: typeof value === 'string' ? value : JSON.stringify(value) };
}

/** A `unitDistributed.distinctnessFallback` as read: a published token, or an unrecognised value
 *  (a newer engine's token, or off-contract) carried verbatim so it can still be disclosed. */
export type DistinctnessFallback = 'creator_seat' | 'same_cli_instance' | { unrecognised: string };

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

// ── #279: the ONE setter for a project's Documents root (DES-L7 §5 I3) ─────────────────────────

/**
 * Bind — or, with `null`, clear — a project's `interactiveRoot` through crew's existing
 * `PATCH /projects/:id` (`UpdateProjectBody.interactiveRoot`, api-types 0.38.0 `index.d.ts:3932`).
 * Studio never had a caller for that field: the binding that isolates a project's documents was
 * API-only (RC1's `[SUBSTITUTE]` curl). Returns the project as the daemon now holds it, so the
 * caller replaces its store row and the docs tile re-lists off the new root. Crew canonicalizes
 * the spelling (`~`, relative, trailing `/`) and refuses the `default` project — its message is
 * surfaced as-is. A blank string is a clear, never "the cwd".
 */
export async function setProjectInteractiveRoot(projectId: string, root: string | null): Promise<CrewProject> {
  const trimmed = root === null ? null : root.trim();
  const { project } = await api.updateProject(projectId, { interactiveRoot: trimmed === '' ? null : trimmed });
  return project;
}

// ── core#469 / core#467 (crew#699, api-types 0.57.0): the escalation arms of POST /runs/:id/gate ──

/**
 * The four escalation arms crew#699 added to `GateDecision.action` (api-types 0.57.0), typed here
 * because studio pins an older contract. Each is approve-shaped (`approve: true`) and takes no
 * `amend`, `amendScope` or `plan`; the engine refuses each (409) at a gate it does not answer.
 *  - `extend` | `targeted` | `accept_partial`: a repo-checks floor that did not finish
 *    (`denial.source: 'repo_checks_timeout'`) re-runs on the tree as it stands, with 2x bounds,
 *    with the repo's `test_targeted` in place of the full test set, or with the unfinished checks
 *    waived.
 *  - `accept_suggestion`: an evaluator the worktree guard denied, whose edit was restored and
 *    pinned (`worktreeRestored.suggestionRef`): the engine applies that edit and rewinds to the
 *    creator.
 */
export type EscalationAction = 'extend' | 'targeted' | 'accept_partial' | 'accept_suggestion';

/** The wire body of one escalation arm: `{approve: true, action}` and nothing else. */
export interface EscalationDecision {
  approve: true;
  action: EscalationAction;
}

// ── wicked-core#555 (crew, api-types 0.67.0): amend the run's intent at a gate ────────────────

/**
 * The `amend_intent` arm of `POST /runs/:id/gate` (typed here because studio pins an older
 * contract). `request_changes` reaches the CREATOR and an approve's `amend` reaches ONE unit's
 * instruction; nothing amended the acceptance list an EVALUATOR is handed — the launch intent —
 * so a mid-run descope could only end in a relaunch, and the evaluator kept failing a withdrawn
 * item (inconsistently: the same tree passed on one attempt and failed on the next).
 *
 * Approve-shaped, the text required and non-empty, and NO `amendScope`: the scope is every unit at
 * or after the cursor, which is what makes it reach the later evaluator. The engine appends the
 * text to those units, records it on the run ({@link IntentAmendment}) and emits `intentAmended`;
 * it refuses the arm at a plan gate or a team pause (409, the gate stays open).
 */
export interface AmendIntentDecision {
  approve: true;
  action: 'amend_intent';
  amend: string;
}

/**
 * The run's approved intent amendments, read off the session record. ABSENT on an unamended run
 * and on a daemon/engine before the field, so an empty array means "none", never "unknown".
 * Rows that are not well-formed are dropped rather than rendered half-read.
 */
export function intentAmendmentsOf(session: unknown): IntentAmendment[] {
  const raw = (session as { intent_amendments?: unknown } | null)?.intent_amendments;
  if (!Array.isArray(raw)) return [];
  const out: IntentAmendment[] = [];
  for (const row of raw) {
    const r = row as { text?: unknown; ord?: unknown; at?: unknown };
    if (typeof r.text !== 'string' || r.text.trim() === '') continue;
    out.push({
      text: r.text,
      ord: typeof r.ord === 'number' ? r.ord : 0,
      at: typeof r.at === 'number' ? r.at : 0,
    });
  }
  return out;
}

// ── studio#306 (wicked-core#539): `agentVerdict: "skipped"`, a judge that was deliberately not run ──

/**
 * `gateEvaluated.agentVerdict` with the `"skipped"` token read as NO judge verdict. The engine
 * sends `"skipped"` (with `judgeDistinct: false` and a `judgeSkippedReason`) when the only
 * eligible judge seat was the creator's own, so no judge ran; the pinned contract still types
 * `string | null`. Every surface that asks "did a judge decide" reads this, never the raw field.
 */
export function judgeVerdictOf(ev: Record<string, unknown>): string | null {
  const v = ev['agentVerdict'];
  if (typeof v !== 'string' || v === 'skipped') return null;
  return v;
}

/**
 * Why the judge was skipped, when the frame says it was (`agentVerdict: "skipped"`): the engine's
 * `judgeSkippedReason`, or a plain default when the frame carries none. `null` when a judge ran, or
 * none was expected.
 */
export function judgeSkippedOf(ev: Record<string, unknown>): string | null {
  if (ev['agentVerdict'] !== 'skipped') return null;
  return str(ev['judgeSkippedReason']) ?? 'the only eligible judge seat was the creator';
}

// ── wicked-crew#718: `GET /workflows` names the drop-ins the engine refused ──────────────────

/** The refused defs a `GET /workflows` body carries, or `[]` on a daemon older than the field. */
export function refusedWorkflowsOf(body: { unavailable?: RefusedWorkflow[] }): RefusedWorkflow[] {
  const list = body.unavailable;
  if (!Array.isArray(list)) return [];
  return list.filter((w): w is RefusedWorkflow => typeof w?.id === 'string' && typeof w?.reason === 'string');
}
