import type { CoreEvent, RepoCheckRun, RosterSeat, UnitDenial, WorkUnit, WorktreeChangedPath } from '../api/types.js';
import { gateUngated, gateUngatedReason } from '../api/wave6-wire.js';
import { parseDenial } from './denialCopy.js';

/**
 * gateVerdict — the evaluator's record for the gate the operator is answering, read off the run's
 * event log (wicked-studio#250, F-3R2-006 — the UI half of wicked-core F-036/F-039).
 *
 * The gate card asked "Approve unit 4 before it runs: verify" and, one denial later, "Unit 4
 * verdict is NOT PASS — …" (the pre-0.33.0 retry-or-reject wording) — and nothing
 * else. The verdict the operator was really answering (the `fix` phase PASSED its floor and its
 * judge; the `verify` phase was DENIED because it changed the worktree it was reviewing, here is
 * the path, here is the restore command) sat on the wire the whole time, in `gateEvaluated`,
 * `evaluatorMutatedWorktree` and `repoChecksEvaluated` (wicked-crew-api-types 0.31.0), rendered
 * only as an expandable thread line.
 *
 * This module is the pure half: pick the DECIDING evaluation and attach its evidence. Zero
 * requests — the card is a view over the event log the run page already hydrates
 * (`store/events.ts`), exactly as `VerdictDetail` reads it for a finished run.
 *
 * WHICH evaluation: the LAST `gateEvaluated` in the log whose `ord` does not exceed the gate's.
 * Arrival order is the daemon's order, so at an open gate "last" is the verdict that opened it —
 * for a pre-run gate "before unit #N" that is the phase that just finished (ord < N, the fix
 * gate); for an escalated gate it is unit N's own denial. The `ord` bound is defensive: a frame
 * for a later unit can never be the answer to an earlier gate. `null` when the log holds no
 * evaluation yet (the very first gate) or is not hydrated — the card then renders NO verdict
 * block, never one fabricated from the prompt.
 *
 * WHAT is attached, by ord and log order (the nearest frame BEFORE the chosen evaluation):
 *  - `repoChecksEvaluated` — the F-039 floor: which repository checks ran, each exit code and
 *    duration, what was skipped; the wire fires it once per fold just before `gateEvaluated`.
 *  - `evaluatorMutatedWorktree` — the F-036 record: the paths an `executes_code: false` phase
 *    changed, the seat that ran it, both tree ids.
 *  - `denial` — the structured twin of `denialReason` (which layer denied, the engine's prose);
 *    an older engine that sends only the prose still yields a denial view with `source: null`.
 *
 * Never overclaimed (FINDING-025): an evaluation with no floor, no judge verdict and no evaluator
 * policy is `'ungated'` — a default-allow the card labels as "nothing gated this phase", not a
 * pass.
 *
 * wicked-core#431 (api-types 0.33.0) put three more facts on the same frames, all read here and
 * all `null` when an older daemon does not send them:
 *  - `gateEvaluated.judgeCli` / `judgeDistinct` — WHO rendered `agentVerdict`, and whether that
 *    seat was identity-distinct from the work's author (evaluator ≠ creator is the doctrine;
 *    `false` means the judge fell back to the single default runner and its independence is
 *    prompt-only). Read off the frame, never inferred from `unitDispatched`.
 *  - `evaluatorMutatedWorktree.restored` / `restoreError` — whether the engine already put the
 *    creator's tree back after the mutation, so a human's Approve now means a retry against the
 *    VERIFIED tree, not adoption of the evaluator's edit.
 *  - `worktreeRestored` (a new frame between the mutation record and the verdict) — what was
 *    discarded and where the discarded edit was pinned (`refs/wicked/suggestions/<run>/<ord>/<attempt>`,
 *    `null` when the pin failed), attached as `restore`.
 */

export type GateOutcome = 'pass' | 'fail' | 'ungated';

/** One repository check the engine ran, narrowed off the wire's {@link RepoCheckRun}. */
export interface GateFloorCheck {
  name: string;
  argv: string[];
  source: string;
  exitCode: number | null;
  timedOut: boolean;
  spawnError: string | null;
  durationMs: number;
  /** The last 4 KiB of the check's stdout / stderr as the engine recorded them (`RepoCheckRun`, on the
   *  wire since api-types 0.31.0) — the evidence behind a failed check, verbatim. `null` when the
   *  stream was empty or the frame predates the field, so no surface paints an empty box (F-255-03). */
  stdoutTail: string | null;
  stderrTail: string | null;
}

/** The F-039 floor as `repoChecksEvaluated` reported it. */
export interface GateFloorView {
  passed: boolean;
  criterion: string;
  attempt: number | null;
  checks: GateFloorCheck[];
  skipped: string[];
}

/** The F-036 record as `evaluatorMutatedWorktree` reported it. */
export interface GateMutationView {
  cli: string;
  phase: string;
  beforeTree: string;
  afterTree: string;
  headMoved: boolean;
  changed: WorktreeChangedPath[];
  /** wicked-core#431: whether the engine restored the creator's tree right after the mutation.
   *  `null` when the frame predates the field (an older engine) — the card then keeps the manual
   *  `git read-tree` remedy the denial prose carries and says nothing about a restore. */
  restored: boolean | null;
  /** Why the restore failed or was not attempted, when `restored === false`. */
  restoreError: string | null;
}

/** The `worktreeRestored` record (wicked-core#431, api-types 0.33.0): what the engine put back and
 *  what it threw away. Follows `evaluatorMutatedWorktree` when `restored` is `true`. */
export interface GateRestoreView {
  /** The tree id the worktree was restored to (the creator's baseline). */
  tree: string;
  /** The commit `HEAD` was reset to when the phase had moved it; `null` when it had not. */
  head: string | null;
  /** Exactly what the evaluator's edit was — the same list the mutation event carried as `changed`. */
  discarded: WorktreeChangedPath[];
  /** Where the discarded edit was pinned (`refs/wicked/suggestions/<run>/<ord>/<attempt>`), so
   *  `git show <ref>` reads it back; `null` when the pin failed. */
  suggestionRef: string | null;
}

/** The winning denial: structured when the wire carries `denial`, prose-only from an older engine. */
export interface GateDenialView {
  /** The denying layer (`worktree_guard`, `repo_checks`, …); `null` when only the prose survived. */
  source: string | null;
  /** The engine's prose, verbatim — it carries the remedy (the restore command, the def change). */
  reason: string;
  claimId: string | null;
  ruleIds: string[];
  deniedTool: string | null;
  phase: string | null;
}

export interface GateVerdictView {
  ord: number | null;
  outcome: GateOutcome;
  criterion: string | null;
  hasDeterministicFloor: boolean;
  deterministicPass: boolean;
  agentVerdict: string | null;
  agentReasoning: string | null;
  evaluatorPass: boolean | null;
  evaluatorPolicies: string[];
  denial: GateDenialView | null;
  floor: GateFloorView | null;
  mutation: GateMutationView | null;
  /** The `worktreeRestored` record for this fold, when the engine restored the creator's tree. */
  restore: GateRestoreView | null;
  /** The council seat key the layer-2 judge ran under (`codex`, `pi`, …); `null` when no judge ran,
   *  on the bus-mediated path, and from a daemon that predates api-types 0.33.0. */
  judgeCli: string | null;
  /** Whether that judge seat was identity-distinct from the work's author; `null` when unknown. */
  judgeDistinct: boolean | null;
  /**
   * The engine SAYS the unit went ungated (api-types 0.36.0 `gateEvaluated.ungated` — wave 6,
   * F-7R2-005): no eligible judge seat could be convened, so evaluator ≠ creator was not held and
   * the verdict is a disclosed default-allow, never a pass. `false` from a daemon that does not send
   * the field — the card's own "no floor, no judge, no policy" fold then decides `outcome`.
   */
  ungated: boolean;
  /** Why (`ungatedReason`, e.g. "no eligible judge seat"); `null` when the frame carries none. */
  ungatedReason: string | null;
  /**
   * The ATTEMPT this evaluation judged — the `attempt` of the nearest `unitDispatched` for the same
   * ord before it (`gateEvaluated` itself carries none). `null` when no dispatch frame precedes it
   * in the log. An escalation gate is about the LATEST attempt (F-7R2-018): an earlier attempt's
   * verdict is not this gate's.
   */
  attempt: number | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
/** A recorded stream tail: a non-blank string, else `null` — an empty stream is nothing to show. */
const tail = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function denialOf(ev: CoreEvent): GateDenialView | null {
  const raw = ev.denial;
  if (isRecord(raw) && typeof raw.reason === 'string') {
    // Either casing survives the wire (api-types 0.31.0 spells it camelCase; earlier engines and
    // the unit-record twin spell `claim_id` / `rule_ids` — the same tolerance `denialCopy.ts`
    // already keeps), so a snake_case denial never drops its rule ids from the card.
    const d = raw as Partial<UnitDenial> & Record<string, unknown>;
    return {
      source: str(d.source),
      reason: d.reason as string,
      claimId: str(d.claimId) ?? str(d['claim_id']),
      ruleIds: strings(d.ruleIds ?? d['rule_ids']),
      deniedTool: str(d.deniedTool) ?? str(d['denied_tool']),
      phase: str(d.phase),
    };
  }
  const prose = str(ev.denialReason);
  if (prose === null || prose === '') return null;
  return { source: null, reason: prose, claimId: null, ruleIds: [], deniedTool: null, phase: null };
}

function checkOf(raw: unknown): GateFloorCheck | null {
  if (!isRecord(raw) || typeof raw.name !== 'string') return null;
  const c = raw as Partial<RepoCheckRun> & Record<string, unknown>;
  return {
    name: c.name as string,
    argv: strings(c.argv),
    source: str(c.source) ?? '',
    exitCode: typeof c.exitCode === 'number' ? c.exitCode : null,
    timedOut: c.timedOut === true,
    spawnError: str(c.spawnError),
    durationMs: typeof c.durationMs === 'number' ? c.durationMs : 0,
    stdoutTail: tail(c.stdoutTail),
    stderrTail: tail(c.stderrTail),
  };
}

/** The F-039 floor off a `repoChecksEvaluated` frame — shared with the deliver re-verify
 *  (`deliverLiftModel.ts`), which is the same frame emitted for the deliver ord. */
export function floorOf(ev: CoreEvent): GateFloorView {
  return {
    passed: ev.passed === true,
    criterion: str(ev.criterion) ?? '',
    attempt: typeof ev.attempt === 'number' ? ev.attempt : null,
    checks: Array.isArray(ev.checks) ? ev.checks.map(checkOf).filter((c): c is GateFloorCheck => c !== null) : [],
    skipped: strings(ev.skipped),
  };
}

/** Narrow a wire `ChangedPath[]` — anything that is not `{path, status}` strings is dropped. */
function changedPaths(v: unknown): WorktreeChangedPath[] {
  return Array.isArray(v)
    ? v.filter(
        (p): p is WorktreeChangedPath => isRecord(p) && typeof p.path === 'string' && typeof p.status === 'string',
      )
    : [];
}

function mutationOf(ev: CoreEvent): GateMutationView {
  return {
    cli: str(ev.cli) ?? '',
    phase: str(ev.phase) ?? '',
    beforeTree: str(ev.beforeTree) ?? '',
    afterTree: str(ev.afterTree) ?? '',
    headMoved: ev.headMoved === true,
    changed: changedPaths(ev.changed),
    // Absent (an older engine) is `null`, never `false`: `false` is the engine SAYING the restore
    // failed, and the card renders that as a warning it must not fabricate.
    restored: typeof ev.restored === 'boolean' ? ev.restored : null,
    restoreError: str(ev.restoreError),
  };
}

function restoreOf(ev: CoreEvent): GateRestoreView {
  return {
    tree: str(ev.tree) ?? '',
    head: str(ev.head),
    discarded: changedPaths(ev.discarded),
    suggestionRef: str(ev.suggestionRef),
  };
}

/**
 * The nearest frame of `type` for `ord` BEFORE index `before`, or `null` — searching back only as
 * far as the previous `gateEvaluated` for the same ord. Evidence belongs to ONE fold: a retry's
 * evaluation must not inherit the mutation record or the repo checks of the attempt it replaced
 * (the ord-4 `verify` retry in the recording passed on its own floor; attempt 0's changed path is
 * that attempt's story, and the previous verdict is the boundary between them).
 */
function nearestBefore(events: readonly CoreEvent[], before: number, type: string, ord: number | null): CoreEvent | null {
  for (let i = before - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'gateEvaluated' && (ord === null || e.ord === ord)) return null;
    if (e.type !== type) continue;
    if (ord !== null && e.ord !== ord) continue;
    return e;
  }
  return null;
}

/**
 * The deciding evaluation for a gate on `gateOrd` (the card's `ord`; omit to take the last
 * evaluation in the log), with its floor and mutation evidence attached. `null` when the log
 * holds no qualifying `gateEvaluated`.
 */
/** The `attempt` of the nearest `unitDispatched` for `ord` BEFORE index `before` (exclusive; the whole
 *  log when `before` is omitted), or `null` when none precedes — which attempt a frame at `before`
 *  belongs to. */
export function attemptBefore(events: readonly CoreEvent[], ord: number, before: number = events.length): number | null {
  for (let i = Math.min(before, events.length) - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'unitDispatched' && e.ord === ord && typeof e.attempt === 'number') return e.attempt;
  }
  return null;
}

export function gateVerdict(events: readonly CoreEvent[], gateOrd?: number): GateVerdictView | null {
  let idx = -1;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type !== 'gateEvaluated') continue;
    // A bounded lookup needs a numeric ordinal to bound: a frame with no `ord` cannot be shown to
    // belong at or below this gate, so it is never the answer to one (Copilot on #252). Unbounded
    // (no `gateOrd`) still takes the last evaluation whatever its shape.
    if (gateOrd !== undefined && (typeof e.ord !== 'number' || e.ord > gateOrd)) continue;
    idx = i;
  }
  if (idx === -1) return null;
  const ev = events[idx]!;
  const ord = typeof ev.ord === 'number' ? ev.ord : null;

  const hasDeterministicFloor = ev.hasDeterministicFloor === true;
  const agentVerdict = str(ev.agentVerdict);
  const evaluatorPolicies = strings(ev.evaluatorPolicies);
  const denial = denialOf(ev);
  const combined = ev.combined === true;
  // Wave 6 (api-types 0.36.0): the engine's own word that no judge could be convened wins over the
  // fold below — a floor may still have run (`hasDeterministicFloor`), but the verdict is UNGATED
  // on the evaluator axis and the card says why. A denial is still a denial.
  const ungated = gateUngated(ev);
  const ungatedReason = gateUngatedReason(ev);

  const outcome: GateOutcome =
    !combined || denial !== null
      ? 'fail'
      : ungated || (!hasDeterministicFloor && agentVerdict === null && evaluatorPolicies.length === 0)
        ? 'ungated'
        : 'pass';

  const floorFrame = nearestBefore(events, idx, 'repoChecksEvaluated', ord);
  const mutationFrame = nearestBefore(events, idx, 'evaluatorMutatedWorktree', ord);
  // The restore record rides the same fold: emitted AFTER the mutation frame and BEFORE the verdict
  // (wicked-core#431), so the same bounded look-back finds it and a retry never inherits it.
  const restoreFrame = nearestBefore(events, idx, 'worktreeRestored', ord);

  return {
    ord,
    outcome,
    criterion: str(ev.criterion),
    hasDeterministicFloor,
    deterministicPass: ev.deterministicPass === true,
    agentVerdict,
    agentReasoning: str(ev.agentReasoning),
    evaluatorPass: typeof ev.evaluatorPass === 'boolean' ? ev.evaluatorPass : null,
    evaluatorPolicies,
    denial,
    floor: floorFrame === null ? null : floorOf(floorFrame),
    mutation: mutationFrame === null ? null : mutationOf(mutationFrame),
    restore: restoreFrame === null ? null : restoreOf(restoreFrame),
    judgeCli: str(ev.judgeCli),
    judgeDistinct: typeof ev.judgeDistinct === 'boolean' ? ev.judgeDistinct : null,
    ungated,
    ungatedReason,
    attempt: ord === null ? null : attemptBefore(events, ord, idx),
  };
}

/**
 * The unit an ESCALATION gate is about, read off the engine's own prompt spellings — the
 * triage escalation ("Unit N failed and triage escalated: …") and the verdict escalation
 * ("Unit N verdict is NOT PASS — …"). `null` for a pre-run gate ("Approve unit N before it
 * runs: …") and for any prompt this cannot read — the pre-run rule then stands.
 */
export function escalationUnit(prompt: string | undefined): number | null {
  if (prompt === undefined) return null;
  const m = /^\s*Unit\s+(\d+)\s+(?:failed and triage escalated|verdict is NOT PASS)/i.exec(prompt);
  return m === null ? null : Number(m[1]);
}

/**
 * The verdict block a gate card may show (acceptance finding F-7R2-018): {@link gateVerdict}
 * bounded on the gate's ord, AND — for an escalation gate about unit N — only unit N's OWN
 * evaluation. The phase7-r2 rig's "Unit 3 failed and triage escalated" card rendered unit 2's
 * vacuous pass ("Evaluator verdict — build · UNGATED") under a card about unit 3, because a
 * worker failure leaves no `gateEvaluated` for N and the last-at-or-below lookup fell through
 * to N-1. A pre-run gate ("Approve unit N before it runs") keeps the previous phase's verdict —
 * that IS what the operator is approving (F-3R2-006). No verdict for THAT unit ⇒ no block.
 *
 * Keyed on ord AND attempt: an escalation is about the LATEST attempt of unit N (the last
 * `unitDispatched` for N), so a verdict that judged an EARLIER attempt — attempt 1 denied, attempt 2's
 * worker then failed — is not this gate's either, and is dropped the same way.
 */
export function gateVerdictFor(events: readonly CoreEvent[], gateOrd: number | undefined, prompt: string | undefined): GateVerdictView | null {
  if (typeof gateOrd !== 'number') return null;
  const view = gateVerdict(events, gateOrd);
  if (view === null) return null;
  const unit = escalationUnit(prompt);
  if (unit === null) return view;
  if (view.ord !== unit) return null;
  const latest = attemptBefore(events, unit);
  if (latest !== null && view.attempt !== null && view.attempt !== latest) return null;
  return view;
}

/**
 * Whether this gate is a FAILURE escalation — the unit's worker failed (or triage gave up on it)
 * and the engine escalated to a human (F-7R2-007): the gate whose plain Approve re-dispatches the
 * SAME dead seat. Read off the engine's prompt spelling, or the deciding denial's kind (crew's
 * `worker_failure` layer, the `triage escalation:` / `Worker FAILED` prose `denialCopy` knows).
 */
export function isFailureEscalation(prompt: string | undefined, view: GateVerdictView | null): boolean {
  if (prompt !== undefined && /^\s*Unit\s+\d+\s+failed and triage escalated/i.test(prompt)) return true;
  if (view === null || view.outcome !== 'fail' || view.denial === null) return false;
  if (view.denial.source === 'worker_failure') return true;
  const kind = parseDenial(view.denial.reason, view.denial.source === null ? null : { source: view.denial.source }).kind;
  return kind === 'triage' || kind === 'worker-failed';
}

/** One seat the operator may move a failed unit to, with the roster's word on it (F-7R2-007). */
export interface ReassignCandidate {
  cli: string;
  /** The roster's display name, or the seat key when the roster is cold. */
  label: string;
  /** `ready` (signed in, or no sign-in needed; not inactive) · `unknown` (no roster word) ·
   *  `signed-out` (no sign-in observed — may fail or be benched) · `inactive` · `ineligible` (the
   *  daemon SAYS a council would not seat it — api-types 0.35.0 `council_eligible: false`). */
  state: 'ready' | 'unknown' | 'signed-out' | 'inactive' | 'ineligible';
  /** The suffix the picker shows after the name — empty when nothing follows from the roster. */
  note: string;
}

const CANDIDATE_RANK: Record<ReassignCandidate['state'], number> = { ready: 0, unknown: 1, 'signed-out': 2, inactive: 3, ineligible: 4 };

/**
 * The seat's standing as far as the wire SAYS it (never inferred): today's roster carries
 * `signed_in` (a file/env heuristic) and `health`; crew#533 (api-types 0.35.0) adds `auth`
 * (`signed_in | signed_out | not_required | unknown`), `free_tier`, `council_eligible` and
 * `council_ineligible_reason` — read off the seat bag when present, so a daemon that states what a
 * council would do is believed and one that does not gets the hedged words. The wire pinned by the
 * phase2-r2 rig is the reason for the hedge: opencode read `signed_in:false` and still answered a
 * chat on its provider free tier — "councils bench this seat" is not a fact today's roster carries.
 */
export function seatStanding(seat: RosterSeat | undefined): { state: ReassignCandidate['state']; note: string } {
  if (seat === undefined) return { state: 'unknown', note: '' };
  if (seat.health?.status === 'inactive') {
    return { state: 'inactive', note: `inactive${seat.health.message ? `: ${seat.health.message}` : ''}` };
  }
  const bag = seat as Record<string, unknown>;
  const eligible = bag['council_eligible'];
  const auth = bag['auth'];
  const reason = bag['council_ineligible_reason'];
  if (eligible === false) {
    return { state: 'ineligible', note: typeof reason === 'string' && reason !== '' ? reason : 'a council would not seat it' };
  }
  if (auth === 'not_required') {
    const tier = bag['free_tier'];
    return { state: 'ready', note: `no sign-in needed${typeof tier === 'string' && tier !== '' ? ` (${tier})` : ''}` };
  }
  if (auth === 'signed_in' || seat.signed_in === true) return { state: 'ready', note: '' };
  if (auth === 'signed_out' || seat.signed_in === false) {
    return { state: 'signed-out', note: eligible === true ? 'no sign-in observed — still council-eligible' : 'no sign-in observed — may fail or be benched' };
  }
  return { state: 'unknown', note: '' };
}

/**
 * The run's OTHER seats, ordered by what the roster says: signed-in seats first, then seats the
 * roster cannot vouch for, then seats with no sign-in observed (hedged — see `seatStanding`), then
 * inactive, then seats the daemon says a council would not seat. The failed seat is excluded:
 * re-dispatching to it is what plain Approve does.
 */
export function reassignCandidates(
  pool: readonly string[],
  failedCli: string | null,
  roster: readonly RosterSeat[] | null,
): ReassignCandidate[] {
  const seen = new Set<string>();
  const out: ReassignCandidate[] = [];
  for (const cli of pool) {
    if (cli === failedCli || seen.has(cli)) continue;
    seen.add(cli);
    const seat = roster?.find((s) => s.key === cli);
    const { state, note } = seatStanding(seat);
    out.push({ cli, label: seat?.display_name ?? cli, state, note });
  }
  return out.sort((a, b) => CANDIDATE_RANK[a.state] - CANDIDATE_RANK[b.state] || pool.indexOf(a.cli) - pool.indexOf(b.cli));
}

/**
 * Phase name for an ord: the unit-key suffix for workflow units (`run:fix` → `fix`), the stage
 * for free-text ones, `unit N` when the snapshot has no such unit. Shared with `VerdictDetail`.
 */
export function phaseLabel(runId: string, units: readonly WorkUnit[], ord: number | null): string {
  if (ord === null) return 'unknown phase';
  const unit = units.find((u) => u.ord === ord);
  if (unit === undefined) return `unit ${ord}`;
  const key = unit.id.startsWith(`${runId}:`) ? unit.id.slice(runId.length + 1) : `u${unit.ord}`;
  return /^u\d+$/.test(key) ? unit.stage : key;
}

/**
 * A person's name for the layer that denied (wicked-core `UnitDenial.source`). Unknown tokens —
 * a newer engine's — are shown as they arrive rather than guessed at.
 */
export function denialSourceLabel(source: string | null): string {
  switch (source) {
    case 'worktree_guard': return 'worktree guard (evaluator ≠ creator)';
    case 'repo_checks': return 'repository checks';
    case 'pinned_validator': return 'pinned validator';
    case 'agent_validator': return 'agent judge';
    case 'evaluator': return 'evaluator second pass';
    case 'governance': return 'governance gate';
    case 'input_governance': return 'input governance';
    case 'worker_failure': return 'worker failure';
    case 'substance': return 'no reviewable substance';
    case 'deliverables': return 'declared deliverables missing';
    case 'elicitation': return 'elicitation ended';
    case null: return 'the gate';
    default: return source;
  }
}

/** How one repository check ended, in a word or two. */
export function checkOutcome(c: GateFloorCheck): { word: string; ok: boolean } {
  if (c.spawnError !== null) return { word: `could not start: ${c.spawnError}`, ok: false };
  if (c.timedOut) return { word: 'timed out', ok: false };
  if (c.exitCode === null) return { word: 'no exit code', ok: false };
  return { word: c.exitCode === 0 ? 'exit 0' : `exit ${c.exitCode}`, ok: c.exitCode === 0 };
}

/**
 * The recorded stream tails of a check that did NOT pass, stderr first — what a collapsed `<details>`
 * per stream renders on the gate card's floor and on the deliver lift (F-255-03). Empty for a passing
 * check (its output is not evidence of anything the card claims) and for a check whose streams the
 * engine recorded as empty.
 */
export function checkTails(c: GateFloorCheck): Array<{ stream: 'stderr' | 'stdout'; text: string }> {
  if (checkOutcome(c).ok) return [];
  const out: Array<{ stream: 'stderr' | 'stdout'; text: string }> = [];
  if (c.stderrTail !== null) out.push({ stream: 'stderr', text: c.stderrTail });
  if (c.stdoutTail !== null) out.push({ stream: 'stdout', text: c.stdoutTail });
  return out;
}

/**
 * Whether Approve on the gate for `gateOrd` means "retry against the restored tree" (wicked-core#431 /
 * F-3R2-010): the deciding evaluation is THIS unit's, it failed, the WORKTREE GUARD is the layer that
 * denied it, and the engine reports the creator's tree restored. That is the engine's own condition
 * for sending the restored-tree prompt (`actor.rs`: `denial.source == "worktree_guard" &&
 * mutation.restored`) — in a dual-deny another layer wins, the engine keeps the legacy prompt and this
 * keeps "Approve" (F-255-05). ONE predicate for every gate card — the run page's `SteeringGate` and the
 * landing inbox's card (F-255-01) — so an open gate never reads "Retry" on one surface and "Approve"
 * on the other. Keyed on the evidence frames, never on the prompt text; a prose-only denial from an
 * older engine (`source: null`) cannot be shown to be the guard's and stays "Approve".
 */
export function isRestoredRetry(view: GateVerdictView | null, gateOrd: number | null | undefined): boolean {
  return (
    view !== null &&
    typeof gateOrd === 'number' &&
    view.ord === gateOrd &&
    view.outcome === 'fail' &&
    view.denial?.source === 'worktree_guard' &&
    view.mutation?.restored === true
  );
}

/**
 * `6893` → `6.9s`, `79191` → `1m 19s`, `420` → `420ms`. Rounds to the UNIT it is about to print
 * BEFORE choosing the format, so a boundary value never shows sixty of a smaller unit: 59,999 ms is
 * `1m` (not `60.0s`), 119,500 ms is `2m` (not `1m 60s`), 999.6 ms is `1.0s` (Copilot on #252).
 */
export function formatDuration(ms: number): string {
  const wholeMs = Math.max(0, Math.round(ms));
  if (wholeMs < 1000) return `${wholeMs}ms`;
  const tenths = Math.round(ms / 100);
  if (tenths < 600) return `${(tenths / 10).toFixed(1)}s`;
  const totalSecs = Math.round(ms / 1000);
  const m = Math.floor(totalSecs / 60);
  const s = totalSecs % 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/**
 * Split prose on backticked spans so a quoted command (`git read-tree --reset -u …`) can render
 * as code the operator can copy. Odd indices are the code spans.
 */
export function splitBackticks(text: string): string[] {
  return text.split('`');
}

/** A git object id cut for display: the first `n` hex chars (trees 10, as the card already prints
 *  them; commits 7, git's own default). Anything shorter than `n` is shown whole. */
export function shortId(id: string, n = 10): string {
  return id.length > n ? id.slice(0, n) : id;
}
