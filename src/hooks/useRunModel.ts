import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import type {
  AgentSession,
  CoreEvent,
  GateSpec,
  InjectedContextRecord,
  PhaseRole,
  RoutingInfo,
  SessionView,
  StageKind,
  UnitStatus,
} from '../api/types.js';
import { useRunEventStore } from '../store/events.js';

/**
 * `useRunModel(runId)` — the hydrate + append core (DES-STUDIO-COCKPIT-001 §1).
 *
 * A run's state = **snapshot (authoritative)** merged with **live events (append)**:
 *  - Hydrate: `GET /runs/:id` → {@link SessionView} is the source of truth for units,
 *    routing, denial_reason, skill_ref, assigned CLI/invocation, and status. Re-fetched
 *    whenever a lifecycle event for this run arrives (the rich detail only exists on the
 *    snapshot; NFR-2 relaxed).
 *  - Append: the coarse `/ws` `CoreEvent` stream patches lifecycle (unit/session status),
 *    and the Phase-B insight events (`unitDispatched` / `cliUsage` / `dataUsed` /
 *    `gateEvaluated`) accumulate onto each unit keyed by `(ord, attempt)`.
 *
 * The panels are pure views over the returned {@link RunModel}. The merge itself is the
 * pure {@link mergeRunModel} (unit-tested: hydrate + append → expected model).
 */

/** Lifecycle frames that change unit/session status → trigger a snapshot re-hydrate. */
const LIFECYCLE: ReadonlySet<string> = new Set([
  'sessionStarted',
  'unitPlanned',
  'unitDistributed',
  'unitExecuting',
  'gateDecided',
  'unitDone',
  'unitDenied',
  'awaitingHuman',
  'resumed',
  'runCancelled',
  'sessionFailed',
  'sessionCompleted',
]);

/** Per-attempt token/cost burn (from `cliUsage`). `costUsd` is `null` when unknown. */
export interface UsageRecord {
  attempt: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** One gate evaluation's depth (from `gateEvaluated`), in arrival order. */
export interface GateEvalRecord {
  criterion: string | null;
  hasDeterministicFloor: boolean;
  deterministicPass: boolean;
  agentVerdict: string | null;
  agentReasoning: string | null;
  evaluatorPass: boolean | null;
  denialReason: string | null;
  combined: boolean;
}

/** A unit as the cockpit sees it: snapshot fields + accumulated live insight. */
export interface UnitModel {
  ord: number;
  description: string;
  stage: StageKind;
  status: UnitStatus;
  /**
   * `true` iff this unit came from the authoritative snapshot. An insight-only ord
   * (a `cliUsage`/`dataUsed`/`unitDispatched`/`gateEvaluated` for an `ord` the snapshot
   * hasn't backfilled yet) is minted `false`: its `stage`/`status` are placeholders, NOT
   * facts, and views must render it as unresolved (no invented stage tint / BUILD badge).
   */
  resolved: boolean;
  assignedCli: string | null;
  assignedInvocation: string | null;
  routing: RoutingInfo | null;
  denialReason: string | null;
  skillRef: string | null;
  phaseStatus: string | null;
  /** Evaluator≠creator role from the phase def (null for free-text/legacy units). */
  role: PhaseRole | null;
  /** Gate policy from the phase def (null for free-text/legacy units). */
  gate: GateSpec | string | null;
  /** True when a pinned deterministic validator is attached. */
  hasValidatorPin: boolean;
  /** Executor type: 'agent' for council-routed, 'tool' for direct command. Null until resolved. */
  executorType: 'agent' | 'tool' | null;
  /** Dispatch attempts seen via `unitDispatched`, ascending. `attempt>0` = rework. */
  attempts: number[];
  /** Token/cost usage per attempt (from `cliUsage`). */
  usage: UsageRecord[];
  /** Files the CLI read (from `dataUsed`), deduped, first-seen order. */
  filesRead: string[];
  /** Gate evaluations for this unit (from `gateEvaluated`), in arrival order. */
  gateEvals: GateEvalRecord[];
  /** P1: worker failure records for this unit (from `stepFailed`), in arrival order. */
  stepErrors: StepErrorRecord[];
  /** P1: number of crash-recovery redrives observed for this unit (from `crashRecoveryRedrive`). */
  crashRedrives: number;
  /** P2: how many times this unit reused an existing PTY session (from `workerSessionReused`). */
  workerSessionReuses: number;
  /** P2: cross-CLI context injections for this unit (from `unitContextInjected`), in arrival order. */
  contextInjections: InjectedContextRecord[];
  /** P2: per-tool-call hook decisions for this unit (from `governanceHookFired`). */
  hookFires: GovernanceHookRecord[];
  /** P2: true iff a pinned deterministic validator was confirmed armed (from `validationPinAttached`). */
  validationPinAttached: boolean;
  /** P2: true iff a HumanConfirmIf escalation fired for this unit (from `gateEscalated`). */
  gateEscalated: boolean;
  /** P2: the tool executor command for this unit (from `toolExecutorDispatched`); null for agent units. */
  toolExecutorCmd: string[] | null;
  /** P2: true iff governance was confirmed armed for this unit (from `governanceContextArmed`). */
  governanceArmed: boolean;
  // ── P2 decisions-full fields (EVT-001/012/013) ──
  /** P2: byte length of the last captured output for this unit (from `unitOutputCaptured`). Null until captured. */
  outputBytes: number | null;
  /** P2: whether the unit's output was governed (from `unitOutputCaptured`). */
  outputGoverned: boolean;
  /** P2: amendment text injected by the operator at a human gate (from `unitReworkAmended`). Null until amended. */
  reworkAmendment: string | null;
}

/** A recorded worker failure for one unit attempt (from `stepFailed`). */
export interface StepErrorRecord {
  attempt: number;
  detail: string;
  failureKind: string;
}

/** A recorded governance hook fire for one tool call (from `governanceHookFired`). */
export interface GovernanceHookRecord {
  toolName: string;
  decision: 'allow' | 'deny';
  denyingPolicy: string | null;
}

/** The current awaiting-human gate (prompt is `null` on a late-join with no live event). */
export interface PendingGate {
  ord: number;
  prompt: string | null;
}

/** A recorded ACP fallback event for this session (from `acpFallback`). */
export interface AcpFallbackRecord {
  cliKey: string;
  reason: string;
  fallbackKind: string;
}

/** The merged, panel-ready run model. */
export interface RunModel {
  session: AgentSession;
  units: UnitModel[];
  pendingGate: PendingGate | null;
  /** P1: most-recent PTY terminal id from `workerSessionStarted` (null until first event). */
  activeTerminalId: string | null;
  /** P1: ACP fallback events for this session, in arrival order. */
  acpFallbacks: AcpFallbackRecord[];
  /** P2: most-recent PTY session close (from `workerSessionClosed`); null until first event. */
  lastWorkerClose: { terminalId: string; reason: 'run_complete' | 'error' } | null;
  /** P2: workflow id from `workflowSelected`; null for free-text runs or before the event arrives. */
  selectedWorkflow: string | null;
}

function blankUnit(ord: number): UnitModel {
  return {
    ord,
    description: '',
    // Placeholder stage/status — NOT facts. `resolved:false` marks this unit as minted from
    // an insight-only ord; views must not render `stage`/`status` as authoritative.
    stage: 'build',
    status: 'pending',
    resolved: false,
    assignedCli: null,
    assignedInvocation: null,
    routing: null,
    denialReason: null,
    skillRef: null,
    phaseStatus: null,
    role: null,
    gate: null,
    hasValidatorPin: false,
    executorType: null,
    attempts: [],
    usage: [],
    filesRead: [],
    gateEvals: [],
    stepErrors: [],
    crashRedrives: 0,
    workerSessionReuses: 0,
    contextInjections: [],
    hookFires: [],
    validationPinAttached: false,
    gateEscalated: false,
    toolExecutorCmd: null,
    governanceArmed: false,
    outputBytes: null,
    outputGoverned: false,
    reworkAmendment: null,
  };
}

/** Stable identity for a gate evaluation, used to dedup double-emitted `gateEvaluated`. */
function gateEvalKey(g: GateEvalRecord): string {
  return JSON.stringify([
    g.criterion,
    g.hasDeterministicFloor,
    g.deterministicPass,
    g.agentVerdict,
    g.agentReasoning,
    g.evaluatorPass,
    g.denialReason,
    g.combined,
  ]);
}

/**
 * Pure hydrate + append. Deterministic over `(snapshot, events)` — the same inputs always
 * yield the same model, so it is directly unit-testable. Never mutates its arguments (the
 * snapshot's `WorkUnit`s are copied into fresh {@link UnitModel}s).
 */
export function mergeRunModel(snapshot: SessionView, events: readonly CoreEvent[]): RunModel {
  const session: AgentSession = { ...snapshot.session };
  const units = new Map<number, UnitModel>();
  for (const u of snapshot.units) {
    units.set(u.ord, {
      ord: u.ord,
      description: u.description,
      stage: u.stage,
      status: u.status,
      resolved: true,
      assignedCli: u.assigned_cli,
      assignedInvocation: u.assigned_invocation,
      routing: u.routing,
      denialReason: u.denial_reason,
      skillRef: u.skill_ref ?? null,
      phaseStatus: u.phase_status,
      role: u.role ?? null,
      gate: u.gate ?? null,
      hasValidatorPin: u.has_validator_pin ?? false,
      executorType: u.tool_cmd != null ? 'tool' : 'agent',
      attempts: [],
      usage: [],
      filesRead: [],
      gateEvals: [],
      stepErrors: [],
      crashRedrives: 0,
      workerSessionReuses: 0,
      contextInjections: [],
      hookFires: [],
      validationPinAttached: false,
      gateEscalated: false,
      toolExecutorCmd: u.tool_cmd ?? null,
      governanceArmed: false,
      outputBytes: null,
      outputGoverned: false,
      reworkAmendment: null,
    });
  }

  // MAJOR fix (cockpit adversarial review): `session.unit_ix` is a 0-based cursor INDEX; a gate's `ord`
  // is 1-based (`ord = index + 1`). A client that rehydrates DURING a pause (snapshot says awaiting_human)
  // has no live `awaitingHuman` event to override this fallback, so resolve the cursor index to the real
  // unit ord from the snapshot — else the HITL panel highlights a phantom ord no unit has.
  let pendingGate: PendingGate | null =
    session.status === 'awaiting_human'
      ? { ord: snapshot.units[session.unit_ix]?.ord ?? session.unit_ix + 1, prompt: null }
      : null;
  let activeTerminalId: string | null = null;
  const acpFallbacks: AcpFallbackRecord[] = [];
  // P2 state
  let lastWorkerClose: { terminalId: string; reason: 'run_complete' | 'error' } | null = null;
  // P2 decisions-full state
  let selectedWorkflow: string | null = null;
  // Dedup trackers for replay-safe accumulators (matches gateEvaluated pattern).
  const redrivedAttempts = new Map<number, Set<number>>(); // ord → Set<attempt>
  // P2 dedup: one reuse count per (ord, terminalId) pair; one injection record per recipient ord.
  const reusedOrdTerminalKeys = new Set<string>(); // `${ord}:${terminalId}`
  const contextInjectedOrds = new Set<number>(); // recipient ord → injections already recorded
  // P2 governance-deep dedup: hook fires keyed by (ord, attempt, toolName) to handle WS reconnect replays.
  const hookFireKeys = new Set<string>(); // `${ord}:${attempt}:${toolName}`

  const ensureUnit = (ord: number): UnitModel => {
    let u = units.get(ord);
    if (u === undefined) {
      u = blankUnit(ord);
      units.set(ord, u);
    }
    return u;
  };

  for (const ev of events) {
    const ord = typeof ev.ord === 'number' ? ev.ord : undefined;
    switch (ev.type) {
      case 'sessionStarted':
        session.status = 'planning';
        break;
      case 'unitPlanned':
        if (ord !== undefined) {
          const u = ensureUnit(ord);
          u.description = typeof ev.description === 'string' ? ev.description : u.description;
          if (!u.resolved) {
            // Unit not yet in snapshot — populate all phase metadata from the event.
            if (typeof ev.stage === 'string') u.stage = ev.stage as StageKind;
            if (typeof ev.role === 'string') u.role = ev.role as PhaseRole;
            if (typeof ev.gate === 'string') u.gate = ev.gate;
            u.hasValidatorPin = ev.has_validator_pin === true;
            if (typeof ev.executor_type === 'string') u.executorType = ev.executor_type as 'agent' | 'tool';
          } else {
            // Unit is from snapshot — only supplement fields still at their null/false default
            // so the event never clobbers authoritative snapshot values.
            if (u.role === null && typeof ev.role === 'string') u.role = ev.role as PhaseRole;
            if (u.gate === null && typeof ev.gate === 'string') u.gate = ev.gate;
            if (!u.hasValidatorPin && ev.has_validator_pin === true) u.hasValidatorPin = true;
            if (u.executorType === null && typeof ev.executor_type === 'string') u.executorType = ev.executor_type as 'agent' | 'tool';
          }
          if (!u.skillRef && typeof ev.skill_ref === 'string') u.skillRef = ev.skill_ref;
        }
        break;
      case 'unitDistributed':
        if (ord !== undefined) {
          const u = ensureUnit(ord);
          if (u.status === 'pending') u.status = 'distributed';
          if (typeof ev.cli === 'string' && u.assignedCli === null) u.assignedCli = ev.cli;
        }
        break;
      case 'unitExecuting':
        if (ord !== undefined) {
          const u = ensureUnit(ord);
          if (u.status === 'pending') u.status = 'distributed';
        }
        break;
      case 'unitDone':
        if (ord !== undefined) ensureUnit(ord).status = 'done';
        break;
      case 'unitDenied':
        if (ord !== undefined) ensureUnit(ord).status = 'rejected';
        break;
      case 'awaitingHuman':
        if (ord !== undefined) {
          session.status = 'awaiting_human';
          pendingGate = { ord, prompt: typeof ev.prompt === 'string' ? ev.prompt : null };
        }
        break;
      case 'resumed':
        session.status = 'executing';
        pendingGate = null;
        break;
      case 'runCancelled':
        session.status = 'cancelled';
        pendingGate = null;
        break;
      case 'sessionFailed':
        session.status = 'failed';
        pendingGate = null;
        break;
      case 'sessionCompleted':
        session.status = 'completed';
        pendingGate = null;
        break;

      // ── Phase-B insight events (accumulate; never invent) ──
      case 'unitDispatched':
        if (ord !== undefined && typeof ev.attempt === 'number') {
          const u = ensureUnit(ord);
          if (!u.attempts.includes(ev.attempt)) {
            u.attempts.push(ev.attempt);
            u.attempts.sort((a, b) => a - b);
          }
        }
        break;
      case 'cliUsage':
        if (
          ord !== undefined &&
          typeof ev.attempt === 'number' &&
          typeof ev.inputTokens === 'number' &&
          typeof ev.outputTokens === 'number'
        ) {
          const u = ensureUnit(ord);
          const cost = typeof ev.costUsd === 'number' ? ev.costUsd : null;
          const existing = u.usage.find((r) => r.attempt === ev.attempt);
          if (existing) {
            existing.inputTokens = ev.inputTokens;
            existing.outputTokens = ev.outputTokens;
            existing.costUsd = cost;
          } else {
            u.usage.push({
              attempt: ev.attempt,
              inputTokens: ev.inputTokens,
              outputTokens: ev.outputTokens,
              costUsd: cost,
            });
          }
        }
        break;
      case 'dataUsed':
        if (ord !== undefined && Array.isArray(ev.files)) {
          const u = ensureUnit(ord);
          for (const f of ev.files) {
            if (typeof f === 'string' && !u.filesRead.includes(f)) u.filesRead.push(f);
          }
        }
        break;
      case 'gateEvaluated':
        if (ord !== undefined) {
          const u = ensureUnit(ord);
          const rec: GateEvalRecord = {
            criterion: ev.criterion ?? null,
            hasDeterministicFloor: ev.hasDeterministicFloor === true,
            deterministicPass: ev.deterministicPass === true,
            agentVerdict: ev.agentVerdict ?? null,
            agentReasoning: ev.agentReasoning ?? null,
            evaluatorPass: typeof ev.evaluatorPass === 'boolean' ? ev.evaluatorPass : null,
            denialReason: ev.denialReason ?? null,
            combined: ev.combined === true,
          };
          // Guard against a double-emitted `gateEvaluated` duplicating the ledger/ladder:
          // skip if an identical evaluation is already recorded for this unit.
          const key = gateEvalKey(rec);
          if (!u.gateEvals.some((g) => gateEvalKey(g) === key)) u.gateEvals.push(rec);
        }
        break;
      // ── P1 observability events ────────────────────────────────────────────
      case 'stepFailed':
        if (
          ord !== undefined &&
          typeof ev.attempt === 'number' &&
          typeof ev.detail === 'string' &&
          typeof ev.failureKind === 'string'
        ) {
          const u = ensureUnit(ord);
          // Dedup: one failure record per attempt (replay-safe).
          if (!u.stepErrors.some((e) => e.attempt === ev.attempt)) {
            u.stepErrors.push({ attempt: ev.attempt, detail: ev.detail, failureKind: ev.failureKind });
          }
        }
        break;
      case 'crashRecoveryRedrive':
        if (ord !== undefined && typeof ev.attempt === 'number') {
          let seen = redrivedAttempts.get(ord);
          if (!seen) {
            seen = new Set();
            redrivedAttempts.set(ord, seen);
          }
          if (!seen.has(ev.attempt)) {
            seen.add(ev.attempt);
            ensureUnit(ord).crashRedrives += 1;
          }
        }
        break;
      case 'workerSessionStarted':
        if (typeof ev.terminalId === 'string') {
          activeTerminalId = ev.terminalId;
        }
        break;
      case 'acpSessionStarted':
        // No persistent model state — the event is observability-only (log / badge).
        break;
      case 'acpFallback':
        if (
          typeof ev.cliKey === 'string' &&
          typeof ev.reason === 'string' &&
          typeof ev.fallbackKind === 'string'
        ) {
          // Dedup: replay-safe (same cliKey+reason+fallbackKind is one event).
          const isDupFallback = acpFallbacks.some(
            (f) => f.cliKey === ev.cliKey && f.reason === ev.reason && f.fallbackKind === ev.fallbackKind,
          );
          if (!isDupFallback) {
            acpFallbacks.push({ cliKey: ev.cliKey, reason: ev.reason, fallbackKind: ev.fallbackKind });
          }
        }
        break;
      // ── P2 observability events ────────────────────────────────────────────
      case 'workerSessionReused':
        // Dedup: one reuse count per (ord, terminalId) — replay-safe.
        if (ord !== undefined && typeof ev.terminalId === 'string') {
          const key = `${ord}:${ev.terminalId}`;
          if (!reusedOrdTerminalKeys.has(key)) {
            reusedOrdTerminalKeys.add(key);
            ensureUnit(ord).workerSessionReuses += 1;
          }
        }
        break;
      case 'workerSessionClosed':
        // Last-write wins: a run's session can close multiple times (error → reopen → run_complete).
        // Validate reason against the known literals for runtime robustness and type narrowing.
        if (
          typeof ev.terminalId === 'string' &&
          (ev.reason === 'run_complete' || ev.reason === 'error')
        ) {
          lastWorkerClose = { terminalId: ev.terminalId, reason: ev.reason };
        }
        break;
      case 'unitContextInjected':
        // Dedup: one injection record per recipient ord — the event fires exactly once per dispatch.
        if (ord !== undefined && Array.isArray(ev.priorUnits) && !contextInjectedOrds.has(ord)) {
          contextInjectedOrds.add(ord);
          const u = ensureUnit(ord);
          for (const pi of ev.priorUnits as unknown[]) {
            if (typeof pi === 'object' && pi !== null) {
              const p = pi as Record<string, unknown>;
              if (
                typeof p.ord === 'number' &&
                typeof p.label === 'string' &&
                typeof p.outputBytes === 'number'
              ) {
                u.contextInjections.push({ ord: p.ord, label: p.label, outputBytes: p.outputBytes });
              }
            }
          }
        }
        break;
      // ── P2 governance-deep events (wicked-core#89) ────────────────────────
      case 'governanceHookFired':
        // Dedup on (ord, attempt, toolName) — safe against WS reconnect replays.
        if (
          ord !== undefined &&
          typeof ev.attempt === 'number' &&
          typeof ev.toolName === 'string' &&
          (ev.decision === 'allow' || ev.decision === 'deny')
        ) {
          const hookKey = `${ord}:${ev.attempt}:${ev.toolName}`;
          if (!hookFireKeys.has(hookKey)) {
            hookFireKeys.add(hookKey);
            const u = ensureUnit(ord);
            u.hookFires.push({
              toolName: ev.toolName,
              decision: ev.decision,
              denyingPolicy: typeof ev.denyingPolicy === 'string' ? ev.denyingPolicy : null,
            });
          }
        }
        break;
      case 'validationPinAttached':
        // Idempotent: once armed, always armed.
        if (ord !== undefined) ensureUnit(ord).validationPinAttached = true;
        break;
      case 'gateEscalated':
        // Idempotent: escalation is a one-way flag.
        if (ord !== undefined) ensureUnit(ord).gateEscalated = true;
        break;
      case 'toolExecutorDispatched':
        // Last-write-wins — one dispatch per unit in practice; Array.isArray guards the field.
        if (ord !== undefined && Array.isArray(ev.cmd)) {
          ensureUnit(ord).toolExecutorCmd = ev.cmd as string[];
        }
        break;
      case 'governanceContextArmed':
        // Idempotent: governance armed is a one-way flag.
        if (ord !== undefined) ensureUnit(ord).governanceArmed = true;
        break;
      // ── P2 decisions-full events (EVT-001/012/013) ─────────────────────────
      case 'workflowSelected':
        // Idempotent: set once — the workflow id is fixed for the session lifetime.
        if (selectedWorkflow === null && typeof ev.workflowId === 'string') {
          selectedWorkflow = ev.workflowId;
        }
        break;
      case 'unitReworkAmended':
        // Last-write-wins per ord: an operator can amend at most once per gate pause, so
        // a WS reconnect replay just overwrites the same value (idempotent in practice).
        if (ord !== undefined && typeof ev.amendment === 'string') {
          ensureUnit(ord).reworkAmendment = ev.amendment;
        }
        break;
      case 'unitOutputCaptured':
        // Last-write-wins per attempt: the event fires exactly once per apply_step_result call
        // per attempt, so a WS reconnect replay safely overwrites with the same values.
        if (
          ord !== undefined &&
          typeof ev.attempt === 'number' &&
          typeof ev.outputBytes === 'number' &&
          typeof ev.governed === 'boolean'
        ) {
          const u = ensureUnit(ord);
          u.outputBytes = ev.outputBytes;
          u.outputGoverned = ev.governed;
        }
        break;
      default:
        break;
    }
  }

  const unitList = [...units.values()].sort((a, b) => a.ord - b.ord);
  return {
    session,
    units: unitList,
    pendingGate,
    activeTerminalId,
    acpFallbacks,
    lastWorkerClose,
    selectedWorkflow,
  };
}

/** A per-CLI token/cost split for the Burn panel. */
export interface CliBurn {
  cli: string;
  input: number;
  output: number;
  cost: number | null;
}

/** Aggregated burn/rework economics — derived only from real `cliUsage` records. */
export interface BurnSummary {
  totalInput: number;
  totalOutput: number;
  totalTokens: number;
  /** Sum of known costs; `null` when no usage record carried a cost. */
  totalCost: number | null;
  /** True iff every usage record carried a cost (else the total is a partial). */
  costComplete: boolean;
  reworkTokens: number;
  /** Rework tokens as a % of total (0 when no tokens). */
  reworkPct: number;
  perCli: CliBurn[];
  /**
   * Non-claude seats dispatched but with NO `cliUsage` — genuinely "usage unavailable"
   * because those CLIs have no usage adapter. A *fact* about the seat.
   */
  noAdapterClis: string[];
  /**
   * claude seats dispatched but with no `cliUsage` *yet* — transient. claude DOES emit
   * `cliUsage`; the record can simply lag the dispatch, or the client joined mid-run. Never
   * labeled "unavailable" (that would be a false claim about claude).
   */
  pendingUsageClis: string[];
  /** Whether any usage record exists at all (else the panel is "awaiting usage"). */
  hasUsage: boolean;
}

/** The file stem of an argv[0] (posix/windows basename, extension stripped, lowercased). */
function binaryStem(argv0: string): string {
  const base = argv0.split(/[\\/]/).pop() ?? argv0;
  return base.replace(/\.(exe|cmd|bat)$/i, '').toLowerCase();
}

/**
 * Whether a unit's worker is the claude binary — matching the ENGINE's adapter selection
 * (`execute_wrapped.rs` `binary_is_claude`: resolved binary stem === "claude"). HONESTY (cockpit
 * adversarial review): classify by the unit's INVOCATION (argv[0] stem), NOT the seat name — a seat
 * aliased to the claude binary but keyed e.g. `opus` would else be mislabeled "usage unavailable", and a
 * non-claude seat keyed `claude-*` would sit "pending" forever. Falls back to the seat-key stem only when
 * no invocation is recorded. Only a true claude worker emits `cliUsage`, so this is what decides whether
 * an absent record is transient ("pending") or a genuine adapter gap ("unavailable").
 */
function unitIsClaude(assignedInvocation: string | null, assignedCli: string | null): boolean {
  const inv = assignedInvocation?.trim();
  if (inv) return binaryStem(inv.split(/\s+/)[0] ?? '') === 'claude';
  return assignedCli !== null && binaryStem(assignedCli) === 'claude';
}

/**
 * Rework = burn on a genuine RE-RUN of a unit. HONESTY (cockpit adversarial review): computed per unit as
 * usage beyond that unit's EARLIEST recorded attempt — NOT a blanket `attempt>0`. The engine bumps
 * `attempt` for wedge-key freshness on some gate approvals, so a unit's FIRST dispatch can carry a nonzero
 * attempt; keying rework off the per-unit minimum makes a once-dispatched unit contribute zero rework
 * regardless of its attempt number, and only a truly re-run unit (usage at >1 attempt) books rework.
 */
export function burnSummary(model: RunModel): BurnSummary {
  let totalInput = 0;
  let totalOutput = 0;
  let costSum = 0;
  let costCount = 0;
  let usageCount = 0;
  let reworkTokens = 0;
  const perCli = new Map<string, CliBurn>();
  const noAdapter = new Set<string>();
  const pending = new Set<string>();

  for (const u of model.units) {
    const dispatched =
      u.status === 'distributed' || u.status === 'done' || u.status === 'rejected';
    if (u.usage.length === 0 && u.assignedCli !== null && dispatched) {
      // Derive the reason PER seat, by the resolved binary (not the seat name). A true claude worker
      // emits `cliUsage`, so an absent record is transient (lagging / late-join), never "unavailable".
      // Only a non-claude worker is truly adapter-less.
      if (unitIsClaude(u.assignedInvocation, u.assignedCli)) pending.add(u.assignedCli);
      else noAdapter.add(u.assignedCli);
    }
    const cli = u.assignedCli ?? 'unknown';
    // Rework is burn on a re-run of THIS unit: usage beyond the unit's earliest recorded attempt.
    const firstAttempt =
      u.usage.length > 0 ? Math.min(...u.usage.map((r) => r.attempt)) : 0;
    for (const r of u.usage) {
      usageCount += 1;
      totalInput += r.inputTokens;
      totalOutput += r.outputTokens;
      if (r.costUsd !== null) {
        costSum += r.costUsd;
        costCount += 1;
      }
      if (r.attempt > firstAttempt) reworkTokens += r.inputTokens + r.outputTokens;
      const e = perCli.get(cli) ?? { cli, input: 0, output: 0, cost: null };
      e.input += r.inputTokens;
      e.output += r.outputTokens;
      if (r.costUsd !== null) e.cost = (e.cost ?? 0) + r.costUsd;
      perCli.set(cli, e);
    }
  }

  const totalTokens = totalInput + totalOutput;
  return {
    totalInput,
    totalOutput,
    totalTokens,
    totalCost: costCount > 0 ? costSum : null,
    costComplete: usageCount > 0 && costCount === usageCount,
    reworkTokens,
    reworkPct: totalTokens > 0 ? (reworkTokens / totalTokens) * 100 : 0,
    perCli: [...perCli.values()],
    noAdapterClis: [...noAdapter],
    pendingUsageClis: [...pending],
    hasUsage: usageCount > 0,
  };
}

const EMPTY_EVENTS: CoreEvent[] = [];

/**
 * The React hook: hydrates the snapshot (re-fetching on each lifecycle transition) and
 * merges the appended live events into a {@link RunModel}. Returns `null` until the
 * authoritative snapshot for `runId` has loaded.
 *
 * @param runId the selected run.
 * @param initial an optional already-fetched snapshot (e.g. the run-list entry) to hydrate
 *   immediately and avoid a loading flash; the hook still re-fetches for authority.
 */
export function useRunModel(runId: string, initial?: SessionView): RunModel | null {
  const events = useRunEventStore((s) => s.byRun[runId]) ?? EMPTY_EVENTS;
  const [snapshot, setSnapshot] = useState<SessionView | null>(initial ?? null);

  // Count of lifecycle events for this run — a stable number selector that only changes on
  // a real transition, so the re-hydrate effect fires exactly when authoritative detail moves.
  const lifecycleTick = useRunEventStore((s) => {
    const evs = s.byRun[runId];
    if (evs === undefined) return 0;
    let n = 0;
    for (const e of evs) if (LIFECYCLE.has(e.type)) n += 1;
    return n;
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { run } = await api.getRun(runId);
        if (!cancelled) setSnapshot(run);
      } catch {
        /* keep the last snapshot; ConnectionStatus reflects the disconnect */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId, lifecycleTick]);

  return useMemo(() => {
    if (snapshot === null || snapshot.session.id !== runId) return null;
    return mergeRunModel(snapshot, events);
  }, [snapshot, events, runId]);
}
