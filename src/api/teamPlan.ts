/**
 * The team-plan wire (DES-TEAMING-002 T9): the phase catalog, the launch preview, mid-run plan
 * edits, and the run's identity — imported from `wicked-crew-api-types` (0.92.0, ASK-S1).
 *
 * Three READ-SIDE SUBSETS stay declared here on purpose: `TeamRow`, `RunTeamResponse` and
 * `TeamEventFrame`. The contract types them with the full `TeamEventPayloads` union; studio folds
 * rows it has not classified yet (`payload: Record<string, unknown>`, the chain and plan models read
 * fields by name after checking `event_type`) and its fixtures build partial responses — so the
 * subset is the shape studio depends on, not a stale copy of the contract.
 */

import { apiFetch } from './client.js';

/** One `wicked.team.*` bus row of `GET /runs/:id/team` (a subset of crew's `TeamRow`). */
export interface TeamRow {
  event_id: number;
  event_type: string;
  payload: Record<string, unknown>;
  /** wicked-bus `emitted_at` (Unix millis; crew api-types 0.42.0). */
  emitted_at?: number;
}

/**
 * `GET /runs/:id/team` (a subset of crew's `RunTeamResponse`): the run's `wicked.team.*` rows —
 * run-level ones (`plan.*`, `path.scored`) under `rows`, unit-level ones (`gate.*`) under each unit.
 */
export interface RunTeamResponse {
  rows: TeamRow[];
  units: Array<{ ord: number; rows: TeamRow[]; transport?: string | null; reason?: string | null }>;
  // The fields below are crew's `RunTeamResponse` (api-types 0.42.0+), read by the session chain
  // (S6a). Optional here so a partial fixture or an older daemon reads as "not said".
  runId?: string;
  /** Whether the run is a team run at all. `false` ⇒ `transport` and `reason` are `null`. */
  teamed?: boolean;
  /** `"bus"`, `"none"` (the team fell back to no transport: say so, with `reason`), `"pending"`,
   *  `"unavailable"`; `null` for a run that is not a team run. */
  transport?: string | null;
  reason?: string | null;
  planRev?: number | null;
  /** The run is terminal and its end is on record. */
  ended?: boolean;
}

/** One `/ws` frame relaying one `wicked.team.*` bus row verbatim (crew `TeamEventFrame`). */
export interface TeamEventFrame {
  type: 'teamEvent';
  event: TeamRow & { [k: string]: unknown };
  project_id?: string;
}

// ── Calls ─────────────────────────────────────────────────────────────────────────────────────

import type { CatalogEntry, CatalogResponse, TeamPlanOverride, LaunchPlan, TeamPlanStep, PlanPreviewBody, PlanPreviewResponse, EditPlanBody, EditPlanGateResponse, PlanProposalResponse, EditPlanResponse, RunIdentity, Preset } from 'wicked-crew-api-types';
export type { CatalogEntry, CatalogResponse, TeamPlanOverride, LaunchPlan, TeamPlanStep, PlanPreviewBody, PlanPreviewResponse, EditPlanBody, EditPlanGateResponse, PlanProposalResponse, EditPlanResponse, RunIdentity, Preset };

export const teamPlanApi = {
  catalog: () => apiFetch<CatalogResponse>('/catalog'),
  previewPlan: (body: PlanPreviewBody) =>
    apiFetch<PlanPreviewResponse>('/plans/preview', { method: 'POST', body: JSON.stringify(body) }),
  editPlan: (runId: string, body: EditPlanBody) =>
    apiFetch<EditPlanResponse>(`/runs/${encodeURIComponent(runId)}/plan`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  team: (runId: string) => apiFetch<RunTeamResponse>(`/runs/${encodeURIComponent(runId)}/team`),
  /** Save a preset (`PUT /presets/:name`, crew 0.47.0): global when `projectId` is absent. */
  putPreset: (name: string, body: { steps: Array<{ catalog: string; id: string }>; projectId?: string }) =>
    apiFetch<{ preset: Preset }>(`/presets/${encodeURIComponent(name)}`, { method: 'PUT', body: JSON.stringify(body) }),
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
