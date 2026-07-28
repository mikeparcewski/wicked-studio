/**
 * Boundary types for the wicked-crew daemon's `/api/v1` JSON surface + the
 * verbatim CoreEvent WS frames.
 *
 * The studio is a separate package with no dependency on the daemon; it speaks
 * these daemon-owned shapes over REST/WS. They mirror the daemon's
 * `packages/crew/src/core/types.ts` (which in turn mirrors wicked-core's
 * `domain.rs` serde representation). Optional/index-signature fields keep the
 * shapes forward-additive: a newer core that adds fields still parses, and new
 * CoreEvent variants pass through the event switch untouched (DES-STUDIO-001
 * §5.1). No `any` at the boundary — unknown-typed fields are narrowed at use.
 */

/** Run-level lifecycle status (`SessionStatus`, snake_case serde token). */
export type SessionStatus =
  | 'planning'
  | 'distributing'
  | 'executing'
  | 'awaiting_human'
  | 'completed'
  | 'cancelled'
  | 'failed';

/** Per-unit lifecycle status (`UnitStatus`). */
export type UnitStatus = 'pending' | 'distributed' | 'done' | 'rejected';

/** The methodology stage badge on a unit (`StageKind`). */
export type StageKind = 'recon' | 'build' | 'review' | 'test';

/** Collection-scope mode (`EntityMode`). */
export type EntityMode = 'shared' | 'isolated';

/** Human-confirm gate policy. serde: `None`->"none", `All`->"all", `Before(n)`->{ before: n }. */
export type HumanConfirm = 'none' | 'all' | { before: number };

/** Why a CLI was assigned to a unit (`RoutingInfo`, internally tagged on `method`). */
export type RoutingInfo =
  | { method: 'council'; winner: string; agreement_pct: number; returned: number; dissent: number }
  | { method: 'degraded'; reason: string }
  | { method: 'evaluator_distinct'; winner: string; was: string }
  | { method: 'tool' };

/** A run (`AgentSession`). */
export interface AgentSession {
  id: string;
  workflow_id: string;
  problem: string;
  entity_mode: EntityMode;
  collection_scope: string | null;
  clis: string[];
  status: SessionStatus;
  human_confirm: HumanConfirm;
  unit_ix: number;
  attempt: number;
  workdir: string | null;
  repo_ref: string | null;
}

/** An ordered unit of work within a run (`WorkUnit`). */
export interface WorkUnit {
  id: string;
  session_id: string;
  ord: number;
  description: string;
  stage: StageKind;
  assigned_cli: string | null;
  assigned_invocation: string | null;
  council_task_ref: string | null;
  routing: RoutingInfo | null;
  denial_reason: string | null;
  phase_ref: string | null;
  conformance_ref: string | null;
  phase_status: string | null;
  collection_scope: string | null;
  status: UnitStatus;
  skill_ref?: string | null;
  /** The command this unit runs directly (Tool-executor phases). Absent for Agent units. */
  tool_cmd?: string[] | null;
  /** Evaluator≠creator role. Present on def-driven units; absent on legacy/free-text. */
  role?: PhaseRole;
  /** Gate policy for this phase. Present on def-driven units; absent on legacy/free-text. */
  gate?: GateSpec | string;
  /** True when a pinned deterministic validator is attached to this unit. */
  has_validator_pin?: boolean;
}

/** A run plus its ordered units (`SessionView`) — the shape `GET /runs` returns. */
export interface SessionView {
  session: AgentSession;
  units: WorkUnit[];
}

/** A registered git repository (`RepoEntry`). */
export interface RepoEntry {
  id: string;
  name: string;
  root_path: string;
  default_branch: string;
  registered_at: number;
  git_url?: string;
}

/** The run id of the onboarding run launched when a repo was registered. */
export interface OnboardRef {
  runId: string | null;
}

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
  [k: string]: unknown;
}

/** The daemon's cached open-gate record (`GET /runs/:id/gate`, DES-STUDIO-001 §3.3). */
export interface GateInfo {
  runId: string;
  ord: number;
  prompt: string;
  lifecycle: string;
  receivedAt: string;
}

/**
 * A CoreEvent frame as delivered verbatim over `/ws` — a tagged-JSON object
 * discriminated on `type` (wicked-core-ts `event_to_json`). The named optional
 * fields cover the frames the studio inspects; the index signature keeps the
 * shape additive-safe so new variants pass through untouched (DES-STUDIO-001
 * §2.1, §5.1).
 */
export interface CoreEvent {
  type: string;
  session?: string;
  ord?: number;
  prompt?: string;
  chunk?: string;
  allow?: boolean;
  cli?: string;
  description?: string;
  problem?: string;
  message?: string;
  // ── DES-STUDIO-COCKPIT-001 §3 B-events (Phase B insight wires) ──
  /** `unitDispatched`/`cliUsage`: 0-based dispatch attempt (`>0` = a re-dispatch / rework). */
  attempt?: number;
  /** `cliUsage`: prompt/input tokens for the unit run. */
  inputTokens?: number;
  /** `cliUsage`: completion/output tokens for the unit run. */
  outputTokens?: number;
  /** `cliUsage`: dollar cost when the CLI reports it (claude) or a price table resolves it; else `null`. */
  costUsd?: number | null;
  /** `dataUsed`: the data files the unit's CLI touched (`tool_use` file paths). */
  files?: string[];
  /** `gateEvaluated`: the gated criterion — `null` when the phase was UNGATED (no deterministic floor). */
  criterion?: string | null;
  /** `gateEvaluated`: `true` iff a pinned validator gated this unit (else the phase is ungated). */
  hasDeterministicFloor?: boolean;
  /** `gateEvaluated`: whether the deterministic (layer-1) floor passed (vacuous when no floor). */
  deterministicPass?: boolean;
  /** `gateEvaluated`: the agent (layer-2) judge's verdict when one ran, else `null`. */
  agentVerdict?: string | null;
  /** `gateEvaluated`: the agent judge's reasoning when one ran, else `null`. */
  agentReasoning?: string | null;
  /** `gateEvaluated`: the evaluator≠creator second-pass result — `null` when that layer did not run. */
  evaluatorPass?: boolean | null;
  /** `gateEvaluated`: the WINNING denial's reason when `combined === false`, else `null`. */
  denialReason?: string | null;
  /** `gateEvaluated`: the final deny-dominant decision over all layers (mirrors `gateDecided.allow`). */
  combined?: boolean;
  // sessionStarted enrichment fields (snake_case — serde wire names)
  workflow_id?: string | null;
  cli_count?: number;
  governed?: boolean;
  entity_mode?: string;
  // workflowSelected (EVT-001) — camelCase per event_to_json
  workflowId?: string;
  unitCount?: number;
  // unitReworkAmended (EVT-012)
  amendment?: string;
  updatedDescription?: string;
  // unitOutputCaptured (EVT-013)
  outputBytes?: number;
  stepStatus?: 'ok' | 'failed' | 'cancelled';
  // unitPlanned enrichment fields — the wire spelling is camelCase (event_to_json);
  // the snake_case variants are kept for older daemons.
  stage?: string;
  skill_ref?: string | null;
  skillRef?: string | null;
  has_validator_pin?: boolean;
  hasValidatorPin?: boolean;
  executor_type?: string;
  executorType?: string;
  // unitDistributed enrichment fields
  routing_method?: string;
  agreement_pct?: number | null;
  returned?: number | null;
  dissent?: number | null;
  degraded_reason?: string | null;
  // councilConvened / councilDeliberated / councilVoted (live deliberation) — camelCase
  // per event_to_json
  clis?: string[];
  consensus?: boolean;
  agreementPct?: number;
  votes?: number;
  /** councilDeliberated: the completed ballot number (1-based). */
  round?: number;
  /** councilDeliberated: the approval bar the council must reach, as a percent. */
  neededPct?: number;
  /** workerStalled: silent seconds before the stall event fired. */
  stalledSecs?: number;
  /** failureTriaged: the triage judge's decision. */
  decision?: string;
  /** failureTriaged: the judge's bounded reasoning. */
  analysis?: string;
  // assumptionRecorded (external-transform convention) — camelCase per event_to_json
  kind?: string;
  library?: string;
  transform?: string;
  known?: boolean;
  detail?: string;
  [k: string]: unknown;
}

/**
 * DES-STUDIO-COCKPIT-001 §3 B-events — the 4 new tagged-JSON insight frames, as a discriminated
 * union for consumers that narrow on `type`. Each mirrors a wicked-core `CoreEvent` variant
 * (`event_to_json`, camelCase). They also flow through the permissive {@link CoreEvent} above; the
 * union just gives Phase-B panels exact field types.
 */
export type InsightEvent =
  | UnitDispatchedEvent
  | CliUsageEvent
  | DataUsedEvent
  | GateEvaluatedEvent;

/** §3 B2 — a unit was dispatched (initial + each re-dispatch); `attempt>0` = rework. */
export interface UnitDispatchedEvent {
  type: 'unitDispatched';
  session: string;
  ord: number;
  attempt: number;
}

/** §3 B3 — token/cost burn for one unit run. `costUsd` is `null` when no cost is known. */
export interface CliUsageEvent {
  type: 'cliUsage';
  session: string;
  ord: number;
  attempt: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

/** §3 B4 — the data files a unit's CLI touched. */
export interface DataUsedEvent {
  type: 'dataUsed';
  session: string;
  ord: number;
  files: string[];
}

/** §3 B1 — the gate's decision depth, emitted alongside `gateDecided`. */
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
  denialReason: string | null;
  combined: boolean;
}

/** Foundation wave: session started with enriched context. */
export interface SessionStartedEvent {
  type: 'sessionStarted';
  session: string;
  problem: string;
  workflow_id: string | null;
  cli_count: number;
  governed: boolean;
  entity_mode: 'shared' | 'isolated';
}

// ── P1 observability events ─────────────────────────────────────────────────

/** P1 — a worker failure halted this unit; `detail` is a bounded excerpt of raw output. */
export interface StepFailedEvent {
  type: 'stepFailed';
  session: string;
  ord: number;
  attempt: number;
  detail: string;
  failureKind: string;
}

/** P1 — the engine restarted and is re-dispatching this unit; `attempt` is the NEW attempt number. */
export interface CrashRecoveryRedriveEvent {
  type: 'crashRecoveryRedrive';
  session: string;
  ord: number;
  attempt: number;
}

/** P1 — a PTY worker session opened for the run; `terminalId` matches the terminal event stream. */
export interface WorkerSessionStartedEvent {
  type: 'workerSessionStarted';
  session: string;
  terminalId: string;
  cliKey: string;
}

/** P1 — an ACP persistent session opened for a CLI; `acpSessionId` is the protocol session handle. */
export interface AcpSessionStartedEvent {
  type: 'acpSessionStarted';
  session: string;
  cliKey: string;
  acpSessionId: string;
}

/** P1 — ACP unavailable or failed for a CLI; the run continues with single-shot fallback. */
export interface AcpFallbackEvent {
  type: 'acpFallback';
  session: string;
  cliKey: string;
  reason: string;
  fallbackKind: string;
}

// ── P2 observability events ─────────────────────────────────────────────────

/**
 * P2 — one prior unit's context contributed to a cross-CLI injection.
 * Mirrors `wicked_core::InjectedContext`: identity + size only, no raw content.
 */
export interface InjectedContextRecord {
  ord: number;
  label: string;
  outputBytes: number;
}

/** P2 — an existing PTY session was reused for a subsequent unit in the same run (EVT-003). */
export interface WorkerSessionReusedEvent {
  type: 'workerSessionReused';
  session: string;
  terminalId: string;
  ord: number;
}

/**
 * P2 — a PTY worker session closed (EVT-004).
 * `reason`: `"run_complete"` (normal end-of-run) | `"error"` (PTY write failure).
 */
export interface WorkerSessionClosedEvent {
  type: 'workerSessionClosed';
  session: string;
  terminalId: string;
  reason: 'run_complete' | 'error';
}

/**
 * P2 — prior cross-CLI unit outputs were injected into a unit's context before dispatch (EVT-007).
 * Carries identity + byte-size only — raw output content is not included.
 */
export interface UnitContextInjectedEvent {
  type: 'unitContextInjected';
  session: string;
  ord: number;
  recipientCli: string;
  priorUnits: InjectedContextRecord[];
}

// ── P2 governance-deep observability events (wicked-core#89) ────────────────

/** P2 — governance hook fired for a tool call; records the per-call allow/deny decision. */
export interface GovernanceHookFiredEvent {
  type: 'governanceHookFired';
  session: string;
  ord: number;
  attempt: number;
  toolName: string;
  decision: 'allow' | 'deny';
  denyingPolicy: string | null;
}

/** P2 — a pinned deterministic validator was attached; confirms the governance floor is armed. */
export interface ValidationPinAttachedEvent {
  type: 'validationPinAttached';
  session: string;
  ord: number;
  pin: string;
  criterion: string;
}

/** P2 — a HumanConfirmIf gate escalated to human review. */
export interface GateEscalatedEvent {
  type: 'gateEscalated';
  session: string;
  ord: number;
  condition: string;
  verdictSummary: string;
}

/** P2 — a tool-executor command was dispatched (non-agent unit). */
export interface ToolExecutorDispatchedEvent {
  type: 'toolExecutorDispatched';
  session: string;
  ord: number;
  cmd: string[];
  workdir: string | null;
}

/** P2 — governance context was confirmed armed for a unit. */
export interface GovernanceContextArmedEvent {
  type: 'governanceContextArmed';
  session: string;
  ord: number;
  attempt: number;
  path: 'wrapped_cli' | 'acp';
  dbPath: string;
}

// ── P2 decisions-full observability events (wicked-core EVT-001/012/013) ────

/** P2 — a structured workflow def was selected; fires once per session, after SessionStarted and before
 *  the first UnitPlanned. Not emitted for free-text runs. `unitCount` is the number of phases. */
export interface WorkflowSelectedEvent {
  type: 'workflowSelected';
  session: string;
  workflowId: string;
  unitCount: number;
}

/** P2 — a human approved a gate with an amendment text that was injected into the unit's description
 *  before re-dispatch. Fires after the amendment is persisted, before Resumed. Only emitted when
 *  the amendment text is non-empty. The canonical record for the HITL paper trail. */
export interface UnitReworkAmendedEvent {
  type: 'unitReworkAmended';
  session: string;
  ord: number;
  /** The raw amendment text supplied by the operator. */
  amendment: string;
  /** The unit's description after the amendment was injected. */
  updatedDescription: string;
}

/** P2 — a worker's ApplyStepResult arrived and output is ready to be gated. Fires before GateDecided.
 *  `outputBytes` is the byte length of the worker's output; `stepStatus` is "ok"/"failed"/"cancelled";
 *  `governed` reflects whether the runner armed input governance for this unit. */
export interface UnitOutputCapturedEvent {
  type: 'unitOutputCaptured';
  session: string;
  ord: number;
  attempt: number;
  /** Byte length of the worker's raw output — distinguishes 0-byte from 8 MB truncated. */
  outputBytes: number;
  stepStatus: 'ok' | 'failed' | 'cancelled';
  governed: boolean;
}

/** Foundation wave: a unit was planned with full phase metadata. */
export interface UnitPlannedEvent {
  type: 'unitPlanned';
  session: string;
  ord: number;
  description: string;
  stage: StageKind;
  role: PhaseRole;
  gate: 'auto' | 'human_confirm' | 'human_confirm_if';
  skill_ref: string | null;
  has_validator_pin: boolean;
  executor_type: 'agent' | 'tool';
}

/** Foundation wave: a unit was distributed with full routing detail. */
export interface UnitDistributedEvent {
  type: 'unitDistributed';
  session: string;
  ord: number;
  cli: string;
  routing_method: 'council' | 'degraded' | 'evaluator_distinct' | 'tool';
  agreement_pct: number | null;
  returned: number | null;
  dissent: number | null;
  degraded_reason: string | null;
}

// ── Worker injection + reassignment events (core#93) ──────────────────────────

/** An operator message was injected into active worker sessions mid-run. */
export interface WorkerMessageInjectedEvent {
  type: 'workerMessageInjected';
  session: string;
  message: string;
  /** `"all"` or the cli_key that was targeted. */
  target: string;
}

/** A unit was stopped and re-dispatched to a different CLI (or re-routed via council). */
export interface UnitReassignedEvent {
  type: 'unitReassigned';
  session: string;
  ord: number;
  attempt: number;
  previousCli: string;
  /** `null` means the council was re-convened and its choice is the new assignment. */
  newCli: string | null;
}

// ── Governance types (crew#40/42/43) ───────────────────────────────────────────

/**
 * A registered governance policy (`wicked-governance::Policy`).
 * `effect`: `deny` | `allow_with_conditions` | `allow`.
 * `severity`: `high` | `medium` | `low`.
 */
export interface GovernancePolicy {
  id: string;
  kind: string;
  applies_to: string[];
  effect: 'deny' | 'allow_with_conditions' | 'allow';
  trigger: { contains?: string };
  obligations: string[];
  criteria: string;
  severity: 'high' | 'medium' | 'low';
  rule: string;
}

/**
 * A prescriptive conformance rule (`wicked-governance::ConformanceRule`).
 * `rule_type`: `pattern` | `policy`. `severity`: `info` | `warn` | `error` | `critical`.
 */
export interface ConformanceRule {
  id: string;
  rule_type: 'pattern' | 'policy';
  statement: string;
  severity: 'info' | 'warn' | 'error' | 'critical';
  confidence: number;
  targets: { language?: string; layer?: string; framework?: string };
  symbol_ref?: string;
  compliance?: { framework: string; control_id: string };
  provenance: { source: string; ref?: string; source_kinds: string[] };
}

/** Facet query for `GET /governance/rules/preview`. All fields are optional. */
export interface RulePreviewQuery {
  language?: string;
  layer?: string;
  framework?: string;
  severity?: string;
  rule_type?: string;
}

// ── Governance claims (crew#40/43) ─────────────────────────────────────────────

/**
 * A recorded governance decision from the conformance store (`wicked-apps-core::ConformanceClaim`).
 * `decision` values: `allow` | `deny` | `allow_with_conditions`.
 */
export interface GovernanceClaim {
  claim_id: string;
  scope: string;
  phase: string;
  policy_ids: string[];
  decision: 'allow' | 'deny' | 'allow_with_conditions';
  obligations: string[];
  evaluated_context_ref: string;
  criteria: string;
  evaluator_identity: string;
  /** Unix-seconds timestamp. */
  evaluated_at: number;
}

/** The launch-run request body (`POST /runs`). */
export interface LaunchRunBody {
  problem: string;
  sessionId?: string;
  clisJson?: string;
  entityMode?: EntityMode;
  humanConfirm?: string;
  repoRef?: string;
  /** Built-in workflow id (`feature` | `bug` | `migration`); omit for free-text single-unit mode. */
  workflow?: string;
}

// ── Governance types (crew#40/41) ──────────────────────────────────────────────

/** Per-app breakdown within a `CoverageReport`. */
export interface CoveragePerApp {
  app: string;
  behavior_bearing: number;
  resolved: number;
  risk_flagged: number;
  unaccounted: number;
  coverage: number;
}

/** A behavior-bearing node without a coverage annotation (a coverage hole). */
export interface UnaccountedNode {
  symbol_id: string;
  name?: string;
  kind?: string;
  file?: string;
  app?: string;
}

/**
 * Front-half coverage gate report (`wicked-governance::CoverageReport`).
 * `null` when the graph store has no nodes.
 */
export interface CoverageReport {
  total: number;
  behavior_bearing: number;
  resolved: number;
  risk_flagged: number;
  unaccounted: number;
  coverage: number;
  resolved_rate: number;
  mean_confidence: number;
  resolve_threshold: number;
  per_app: CoveragePerApp[];
  unaccounted_nodes: UnaccountedNode[];
}

// ── Workflow viewer + domain-model browser types (crew#44) ──────────────────

/** Gate position in the value→strategy→execution ladder. */
export type GateType = 'value' | 'strategy' | 'execution';

/** Human-confirm spec for a phase gate (serde flattened from Rust enum). */
export type GateSpec =
  | 'auto'
  | { human_confirm: { unconditional: boolean } }
  | { human_confirm_if: 'verdict_not_pass' };

/** Evaluator≠creator role for a phase. */
export type PhaseRole = 'neutral' | 'creator' | 'evaluator';

/** How a phase executes — agent (council-routed CLI) or tool (direct command). */
export type PhaseExecutor =
  | { type: 'agent' }
  | { type: 'tool'; cmd: string[] };

/** One ordered phase of a workflow. */
export interface PhaseDef {
  id: string;
  kind: 'recon' | 'build' | 'review' | 'test';
  gate_type: GateType | null;
  gate: GateSpec;
  executes_code: boolean;
  verified_evidence: boolean;
  required_deliverables: string[];
  depends_on: string[];
  role: PhaseRole;
  skill_ref: string | null;
  allowed_skills: string[];
  validator_pin: string | null;
  /** How the phase executes. Omitted = Agent (default). */
  executor?: PhaseExecutor;
}

/** A workflow — id + ordered phases. */
export interface WorkflowDef {
  id: string;
  phases: PhaseDef[];
  /** True for built-in workflows that have dedicated entry points and must not appear in the work-mode selector. */
  is_system?: boolean;
}

/** Top-level requirements_graph.json artifact (schema 1.0.0). */
export interface DomainGraph {
  metadata: { schema_version: string; migration_mode: string; source?: string };
  domains: Record<string, DomainGraphDomain>;
}

/** A capability domain in the requirements graph. */
export interface DomainGraphDomain {
  description?: string;
  cluster_id?: number;
  requirements: Record<string, DomainGraphRequirement>;
  entities: Record<string, { description?: string }>;
}

/** A requirement in a domain. */
export interface DomainGraphRequirement {
  title: string;
  description: string;
  status?: string;
  disposition?: string;
  business_rules: Array<{ id: string; statement: string; confidence: number; provenance: { source: string } }>;
  validations: Array<{ id: string; statement: string; confidence?: number }>;
  error_paths: Array<{ id: string; statement: string }>;
}

/** Coverage stats from `wicked-core coverage --json` — present when code is indexed but domain not yet annotated. */
export interface DomainCoverage {
  coverage: number;
  total: number;
  behavior_bearing: number;
  resolved: number;
}

/** The open-terminal request body (`POST /terminals`, DES-TERMINAL-001 §6). */
export interface OpenTerminalBody {
  /** Working directory the PTY opens in. */
  cwd: string;
  /** Command to run; omit for the user's login shell. */
  cmd?: string[];
  cols: number;
  rows: number;
  /**
   * Omit for the safe governed default; `false` is the loud, opt-in UNGOVERNED
   * operator shell (surfaced as ungoverned in the UI, DES-TERMINAL-001 §7).
   */
  governed?: boolean;
}

/** Symbol-level code graph from estate (GET /repos/:id/graph). */
export interface CodeGraphNode {
  id: string;      // estate symbol ID (primary key)
  name: string;    // short display name (function/class/type name)
  kind: string;    // function | class | struct | interface | type_alias | method | enum
  file: string;    // source file path
  inDeg: number;   // incoming call/import count (hotspot indicator)
  outDeg: number;  // outgoing call/import count
  lang: string;    // language (typescript, rust, python, etc.)
}
export interface CodeGraphEdge { src: string; tgt: string; }
export interface CodeGraphData {
  nodes: CodeGraphNode[];
  edges: CodeGraphEdge[];
  stats: { nodeCount: number; edgeCount: number; fileCount: number };
}

export interface GitCommit {
  sha: string;
  shortSha: string;
  message: string;
  author: string;
  date: string;
}

export interface GitContributor {
  commits: number;
  name: string;
  email: string;
}

/** Daemon-persisted system settings (~/.config/wicked-core/settings.json). */
export interface SystemSettings {
  graphNodeLimit: number;
}

// ── Requirements management (server-side search + overrides; crew api/requirements.ts) ──
export interface RequirementSummary {
  key: string;
  domain: string;
  reqId: string;
  title: string;
  statement: string;
  status: string;
  risk: boolean;
  riskSource: 'operator' | 'data' | null;
  edited: boolean;
}

export interface RequirementDetail extends RequirementSummary {
  description: string;
  notes: string;
  sourceTitle: string;
  ruleCount: number;
  componentCount: number;
  validationCount: number;
  errorPathCount: number;
  businessRules: unknown[];
  legacyComponents: unknown[];
}

export interface RequirementsPage {
  total: number;
  corpus: number;
  offset: number;
  limit: number;
  items: RequirementSummary[];
}

export interface RequirementPatch {
  title?: string;
  notes?: string;
  status?: 'active' | 'deprecated' | 'review';
  risk?: boolean;
}
