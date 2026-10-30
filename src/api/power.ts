import { apiFetch } from './client.js';

/**
 * POWER MODE wire (program DES-POWER-MODE; crew-api-types 0.149.0, crew#1201 as of 2026-10-29 12:59Z): one orchestrator seat session builds the
 * whole change in many turns; rigor is sized at intake, re-scored at checkpoints from the actual diff, and applied once
 * at hand-off. The shapes are 0.149.0's, spelled here because studio builds against an older published contract; they
 * are the same fields. `capabilities.powerMode` says a daemon serves them: absent, nothing here is shown.
 *
 * The ENGINE computes every rigor value. Studio only reads it, raises it (`POST /runs/:id/rigor`) and flips the switch
 * (`POST /runs/:id/power`); nothing here can lower rigor.
 */

export type Rigor = 'light' | 'standard' | 'high' | 'highest';
export const RIGORS: readonly Rigor[] = ['light', 'standard', 'high', 'highest'];

export type RigorTrigger = 'intake' | 'commit' | 'turn' | 'timer' | 'pre_handoff' | 'operator' | 'plugin' | 'doc_edit' | 'toggle';

export interface RigorFloor {
  rigor: Rigor;
  by: 'policy' | 'compliance' | 'qe_plan' | 'operator' | 'plugin' | 'doc_edit';
  why: string;
}

export interface HandoffRequirements {
  tests: 'targeted' | 'full';
  reviews: Array<{ kind: 'distinct_seat' | 'design' | 'security'; why: string }>;
  qeAcceptance: { required: boolean; why: string };
  checks: string[];
}

export interface RigorPlan {
  rigor: Rigor;
  score: number;
  band: string;
  highRisk: boolean;
  reasons: string[];
  handoff: HandoffRequirements;
  mandatoryPhases: Array<{ phase: string; why: string }>;
  phasedRequired: string | null;
  estimateMinutes: number | null;
  risks: string[];
  scenarios: string[];
  floors: RigorFloor[];
  plannedBy: string;
  at: number;
}

export interface RigorSignals {
  files: number;
  lines: number;
  dependents: number | null;
  spread: number;
  newDependencies: number;
  sensitive: string[];
  struggle: { failedRuns: number; reverts: number; turns: number; elapsedMinutes: number; estimateMinutes: number | null; score: number };
  planGaps: string[];
}

export interface RigorChange {
  seq: number;
  at: number;
  trigger: RigorTrigger;
  /** Null only on a `toggle` row written before intake planned anything. */
  from: Rigor | null;
  to: Rigor | null;
  direction: 'up' | 'down' | 'same';
  planned: number;
  actual: number;
  delta: number;
  reasons: string[];
  signals: RigorSignals | null;
  by: string;
  floors: RigorFloor[];
  checkpoint: number | null;
  turn: number | null;
  paused: boolean;
}

export interface PowerToggle {
  at: number;
  on: boolean;
  by: string;
  reason: string | null;
  stayPhased: string[];
}

/** The orchestrator waits at its turn end (the run stays `executing`; it is NOT an engine gate) until
 *  `POST /runs/:id/power/pause` answers. */
export interface PowerPause {
  at: number;
  checkpoint: number;
  reasons: string[];
  recommended: 'split' | 'switch_phased' | 'continue_high' | 'stop';
}

export type HandoffStepKind = 'rescore' | 'checks' | 'review' | 'security' | 'qe' | 'compliance';

export interface HandoffStep {
  step: HandoffStepKind;
  /** The hand-off round (1-based); absent on a row from before the field. */
  round?: number;
  ord: number | null;
  status: 'pending' | 'running' | 'passed' | 'failed' | 'skipped';
  seat: string | null;
  summary: string | null;
  at: number;
}

export interface PowerOutcome {
  plannedRigor: Rigor;
  finalRigor: Rigor;
  plannedScore: number;
  finalScore: number;
  estimateMinutes: number | null;
  actualMinutes: number;
  turns: number;
  checkpoints: number;
  handoffRounds: number;
  operatorGates: number;
  outcome: 'delivered' | 'completed' | 'failed' | 'cancelled';
}

export interface PowerState {
  on: boolean;
  available: boolean;
  refusedReason: string | null;
  rigor: Rigor | null;
  plan: RigorPlan | null;
  history: RigorChange[];
  toggles: PowerToggle[];
  orchestrator: { cli: string | null; ord: number | null; turns: number; inTurn: boolean; sessionRestarts: number };
  /** Every orchestrator turn so far, oldest first (at most the last 50). */
  turnLog?: PowerTurnRecord[];
  checkpoints: number;
  handoff: { round: number; maxRounds: number; steps: HandoffStep[] } | null;
  pause: PowerPause | null;
  outcome: PowerOutcome | null;
}

export interface PowerTurnRecord {
  turn: number;
  attempt: number;
  cli: string;
  startedAt: number;
  endedAt: number | null;
  outcome: 'checkpoint' | 'handoff' | 'paused' | 'failed' | 'cap' | null;
  summary: string | null;
}

/** `POST /runs/:id/power/pause`: answer a checkpoint pause. */
export type PauseDecision = 'continue_high' | 'continue' | 'switch_phased' | 'stop';

export interface PowerView extends PowerState {
  runId: string;
}

// ── /ws frames (also in the run's recorded trail) ──────────────────────────────────────────────────────

export interface PowerIntakePlannedEvent { type: 'powerIntakePlanned'; session: string; ord: number; plan: RigorPlan; ts?: number }
export interface RigorRescoredEvent { type: 'rigorRescored'; session: string; change: RigorChange; ts?: number }
export interface PowerCheckpointEvent {
  type: 'powerCheckpointReached'; session: string; ord: number; checkpoint: number; turn: number;
  trigger: 'commit' | 'turn' | 'timer' | 'pre_handoff'; head: string | null; picked: number; rigor: Rigor; paused: boolean;
  /** The pause this checkpoint opened, else null (absent on an older frame). */
  pause?: PowerPause | null; at?: number; ts?: number;
}
export interface PowerTurnEvent {
  type: 'powerTurnStarted' | 'powerTurnCompleted'; session: string; ord: number; attempt: number; turn: number; cli: string;
  outcome?: 'checkpoint' | 'handoff' | 'paused' | 'failed' | 'cap'; summary?: string | null; ts?: number;
}
export interface PowerHandoffEvent { type: 'powerHandoffStepped'; session: string; round: number; maxRounds?: number; step: HandoffStep; ts?: number }
export interface PowerToggledEvent { type: 'powerToggled'; session: string; toggle: PowerToggle; ts?: number }
/**
 * What the orchestrator did in the worktree, read off git by the engine about once a minute and at a turn's end (bus
 * `wicked.run.activity.recorded`): `edit` (`path`, `added`/`removed` = the file's totals against the run's base) or
 * `commit` (short `sha`, `subject`, its `added`/`removed`). 0.149.0 reports no test runs (the headless carrier
 * records no exit codes); `test` and `read` are read here if an engine ever sends them.
 */
export interface PowerActivityEvent {
  type: 'powerActivity'; session: string; ord: number; turn: number; at: number;
  kind: 'edit' | 'commit' | 'test' | 'read';
  path?: string | null; paths?: string[]; added?: number | null; removed?: number | null;
  command?: string; passed?: number; failed?: number; durationMs?: number;
  sha?: string | null; subject?: string | null;
  ts?: number;
}

export type PowerEvent = PowerIntakePlannedEvent | RigorRescoredEvent | PowerCheckpointEvent | PowerTurnEvent | PowerHandoffEvent | PowerToggledEvent | PowerActivityEvent;

export const POWER_EVENT_TYPES: ReadonlySet<string> = new Set([
  'powerIntakePlanned', 'rigorRescored', 'powerCheckpointReached', 'powerTurnStarted', 'powerTurnCompleted', 'powerHandoffStepped', 'powerToggled', 'powerActivity',
]);

/** A run's power state off its session DTO (`AgentSession.power`): null when the run has none (a phased run on an
 *  older engine) or the shape is not one studio can read. */
export function powerOf(session: unknown): PowerState | null {
  const p = (session as { power?: unknown } | null)?.power;
  if (p === null || typeof p !== 'object') return null;
  const s = p as Partial<PowerState>;
  if (typeof s.on !== 'boolean' || typeof s.available !== 'boolean' || !Array.isArray(s.history)) return null;
  return {
    on: s.on,
    available: s.available,
    refusedReason: typeof s.refusedReason === 'string' ? s.refusedReason : null,
    rigor: isRigor(s.rigor) ? s.rigor : null,
    plan: s.plan ?? null,
    history: s.history,
    toggles: Array.isArray(s.toggles) ? s.toggles : [],
    orchestrator: s.orchestrator ?? { cli: null, ord: null, turns: 0, inTurn: false, sessionRestarts: 0 },
    turnLog: Array.isArray(s.turnLog) ? s.turnLog : [],
    checkpoints: typeof s.checkpoints === 'number' ? s.checkpoints : 0,
    handoff: s.handoff ?? null,
    pause: s.pause ?? null,
    outcome: s.outcome ?? null,
  };
}

export function isRigor(v: unknown): v is Rigor {
  return v === 'light' || v === 'standard' || v === 'high' || v === 'highest';
}

export function rigorRank(r: Rigor): number {
  return RIGORS.indexOf(r);
}

export const powerApi = {
  /** `POST /runs/:id/power`: flip the switch. Off -> On on a phased-required run answers 409 `{error, reason}`. */
  toggle: (runId: string, on: boolean, reason?: string) =>
    apiFetch<PowerView>(`/runs/${encodeURIComponent(runId)}/power`, { method: 'POST', body: JSON.stringify(reason !== undefined && reason !== '' ? { on, reason } : { on }) }),
  /** `POST /runs/:id/rigor`: raise rigor to at least `atLeast` (never lower: an equal or lower one is 409). */
  raise: (runId: string, atLeast: Rigor, reason: string) =>
    apiFetch<PowerView>(`/runs/${encodeURIComponent(runId)}/rigor`, { method: 'POST', body: JSON.stringify({ atLeast, reason }) }),
  get: (runId: string) => apiFetch<PowerView>(`/runs/${encodeURIComponent(runId)}/power`),
  /** `POST /runs/:id/power/pause`: answer a checkpoint pause (409 when the run is not paused). */
  pause: (runId: string, decision: PauseDecision, note?: string) =>
    apiFetch<PowerView>(`/runs/${encodeURIComponent(runId)}/power/pause`, { method: 'POST', body: JSON.stringify(note !== undefined && note !== '' ? { decision, note } : { decision }) }),
};
