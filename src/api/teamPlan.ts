/**
 * The team-plan wire (DES-TEAMING-002 T9): the phase catalog, the launch preview, mid-run plan
 * edits, and the run's identity.
 *
 * ── TEMPORARY: hand-declared from wicked-crew-api-types 0.47.0 ─────────────────────────────────
 * crew's repo carries 0.47.0 (`packages/crew-api-types/index.d.ts`), but npm's newest is 0.40.0
 * and studio pins 0.39.0. Same pattern as `./steering.ts` and the delivery section of
 * `./types.js`: every declaration below is a verbatim subset of 0.47.0. **Delete this block and
 * import from `wicked-crew-api-types`** the moment studio bumps to a published version that
 * carries `CatalogEntry`, `PlanPreviewResponse`, `PlanProposalResponse` and `RunIdentity`.
 * Crew bundles this dist, so the two always ship together.
 */

import { apiFetch } from './client.js';
import type { GateSpec, GateType, PhaseRole, StageKindPhase } from './types.js';

// ── 0.47.0 declarations (verbatim subset) ─────────────────────────────────────────────────────

/** One phase type of the engine's catalog (`GET /catalog`), in catalog order. */
export interface CatalogEntry {
  id: string;
  kind: StageKindPhase;
  role: PhaseRole;
  gate: GateSpec;
  gate_type: GateType | null;
  executes_code: boolean;
  /** `"tool"`: a step of this entry supplies its own command (`deliver`); else `"agent"`. */
  executor: 'agent' | 'tool';
  validator_pin: string | null;
  pinned: boolean;
  evidence_floor: boolean;
  /** A step of it is an acceptance requirement of the run (absent before api-types 0.46.0). */
  verified_evidence?: boolean;
  skill_ref: string | null;
  description: string | null;
}

export interface CatalogResponse {
  entries: CatalogEntry[];
}

/** A manual-mode floor override. */
export interface TeamPlanOverride {
  remove: string[];
  reason: string;
}

/** A user-composed plan: ordered steps over the catalog, plus the predicted `touch` set. */
export interface LaunchPlan {
  steps: Array<{ catalog: string; id?: string | undefined; [k: string]: unknown }>;
  touch?: string[];
  override?: TeamPlanOverride;
}

/** One step of an engine plan. `added_by: "floor"` marks a step the floor added. */
export interface TeamPlanStep {
  catalog: string;
  id: string;
  instructions?: string;
  owner?: string;
  depends_on?: string[];
  gate?: unknown;
  added_by?: 'plan' | 'floor' | (string & {});
  floor_reason?: string;
  late?: boolean;
}

/** `POST /plans/preview` body. */
export interface PlanPreviewBody {
  plan: LaunchPlan;
  projectId?: string;
  humanConfirm?: string;
  repoRef?: string;
  deliver?: 'pr' | 'none';
}

/** `POST /plans/preview`: what the launch would decide, persisting nothing. */
export interface PlanPreviewResponse {
  score: number;
  deterministic: number;
  reasons: string[];
  destructive: boolean;
  band: string;
  high_risk: boolean;
  floor: string[];
  floor_override: TeamPlanOverride | null;
  steps: TeamPlanStep[];
  def?: unknown;
  pauses: boolean;
  pause_reason: 'manual_mode' | 'high_risk' | 'override' | (string & {}) | null;
  /** `pending_pa_scope`: the PA scopes the plan first; score, band and floor are the baseline's. */
  graph: 'ready' | 'not_needed' | 'unavailable' | 'pending_pa_scope';
}

/** `POST /runs/:id/plan` body. */
export interface EditPlanBody {
  plan: LaunchPlan;
  /** The idempotency key: a retried POST with the same id proposes once (`duplicate: true`). */
  requestId?: string;
}

/** `POST /runs/:id/plan` at a `plan_approval` gate: the edit answered the gate. */
export interface EditPlanGateResponse {
  status: string;
}

/** `POST /runs/:id/plan` mid-run: what the held edit does to the run. */
export interface PlanProposalResponse {
  proposal_id: string;
  /** `true`: this `requestId` was already taken; nothing new is held. */
  duplicate: boolean;
  band: string | null;
  high_risk: boolean | null;
  floor_added: string[];
}

export type EditPlanResponse = EditPlanGateResponse | PlanProposalResponse;

/** What a run is, resolved by the daemon (`SessionView.session.run_identity`, api-types 0.46.0). */
export interface RunIdentity {
  kind: 'preset' | 'user_plan' | 'workflow' | 'free_text' | 'unknown';
  name: string | null;
  user_plan: boolean;
  /** A machine-owned run: keep it off delivery surfaces. */
  system: boolean;
}

/** A preset (`GET /presets`): a saved phase selection launched by name. */
export interface Preset {
  name: string;
  scope: string;
  steps: Array<{ catalog: string; id: string; [k: string]: unknown }>;
  created_by: string;
  updated_at: number;
}

// ── Calls ─────────────────────────────────────────────────────────────────────────────────────

export const teamPlanApi = {
  catalog: () => apiFetch<CatalogResponse>('/catalog'),
  previewPlan: (body: PlanPreviewBody) =>
    apiFetch<PlanPreviewResponse>('/plans/preview', { method: 'POST', body: JSON.stringify(body) }),
  editPlan: (runId: string, body: EditPlanBody) =>
    apiFetch<EditPlanResponse>(`/runs/${encodeURIComponent(runId)}/plan`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  presets: (projectId?: string | null) =>
    apiFetch<{ presets: Preset[] }>(
      projectId ? `/presets?projectId=${encodeURIComponent(projectId)}` : '/presets',
    ),
};

/** The run's identity off its DTO, or `undefined` from a daemon before api-types 0.46.0. */
export function runIdentityOf(session: object): RunIdentity | undefined {
  const id = (session as { run_identity?: unknown }).run_identity;
  if (typeof id !== 'object' || id === null) return undefined;
  const r = id as Partial<RunIdentity>;
  return typeof r.system === 'boolean' && typeof r.kind === 'string' ? (r as RunIdentity) : undefined;
}
