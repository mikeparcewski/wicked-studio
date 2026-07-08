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
  | { method: 'evaluator_distinct'; winner: string; was: string };

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
  [k: string]: unknown;
}

/** The launch-run request body (`POST /runs`). */
export interface LaunchRunBody {
  problem: string;
  sessionId?: string;
  clisJson?: string;
  entityMode?: EntityMode;
  humanConfirm?: string;
  repoRef?: string;
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
