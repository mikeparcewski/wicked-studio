import type { CoreEvent, RepoCheckRun, UnitDenial, WorkUnit, WorktreeChangedPath } from '../api/types.js';

/**
 * gateVerdict — the evaluator's record for the gate the operator is answering, read off the run's
 * event log (wicked-studio#250, F-3R2-006 — the UI half of wicked-core F-036/F-039).
 *
 * The gate card asked "Approve unit 4 before it runs: verify" and, one denial later, "Unit 4
 * verdict is NOT PASS — confirm to retry the phase, or reject to cancel the run" — and nothing
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
 * pass. The judge SEAT is not on this wire (api-types 0.31.0 `gateEvaluated` carries no seat),
 * so no view field exists for it — render nothing rather than infer one from `unitDispatched`.
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
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function denialOf(ev: CoreEvent): GateDenialView | null {
  const raw = ev.denial;
  if (isRecord(raw) && typeof raw.reason === 'string') {
    const d = raw as Partial<UnitDenial> & Record<string, unknown>;
    return {
      source: str(d.source),
      reason: d.reason as string,
      claimId: str(d.claimId),
      ruleIds: strings(d.ruleIds),
      deniedTool: str(d.deniedTool),
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
  };
}

function floorOf(ev: CoreEvent): GateFloorView {
  return {
    passed: ev.passed === true,
    criterion: str(ev.criterion) ?? '',
    attempt: typeof ev.attempt === 'number' ? ev.attempt : null,
    checks: Array.isArray(ev.checks) ? ev.checks.map(checkOf).filter((c): c is GateFloorCheck => c !== null) : [],
    skipped: strings(ev.skipped),
  };
}

function mutationOf(ev: CoreEvent): GateMutationView {
  const changed = Array.isArray(ev.changed)
    ? ev.changed.filter(
        (p): p is WorktreeChangedPath => isRecord(p) && typeof p.path === 'string' && typeof p.status === 'string',
      )
    : [];
  return {
    cli: str(ev.cli) ?? '',
    phase: str(ev.phase) ?? '',
    beforeTree: str(ev.beforeTree) ?? '',
    afterTree: str(ev.afterTree) ?? '',
    headMoved: ev.headMoved === true,
    changed,
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
export function gateVerdict(events: readonly CoreEvent[], gateOrd?: number): GateVerdictView | null {
  let idx = -1;
  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;
    if (e.type !== 'gateEvaluated') continue;
    if (gateOrd !== undefined && typeof e.ord === 'number' && e.ord > gateOrd) continue;
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

  const outcome: GateOutcome =
    !combined || denial !== null
      ? 'fail'
      : !hasDeterministicFloor && agentVerdict === null && evaluatorPolicies.length === 0
        ? 'ungated'
        : 'pass';

  const floorFrame = nearestBefore(events, idx, 'repoChecksEvaluated', ord);
  const mutationFrame = nearestBefore(events, idx, 'evaluatorMutatedWorktree', ord);

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
  };
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

/** `6893` → `6.9s`, `79191` → `1m 19s`, `420` → `420ms`. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms - m * 60_000) / 1000);
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/**
 * Split prose on backticked spans so a quoted command (`git read-tree --reset -u …`) can render
 * as code the operator can copy. Odd indices are the code spans.
 */
export function splitBackticks(text: string): string[] {
  return text.split('`');
}
