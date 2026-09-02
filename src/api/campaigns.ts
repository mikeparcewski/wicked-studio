/**
 * The campaign wire — types and calls for the campaign surface: `GET /campaigns` and
 * `GET /campaigns/:id`, as the daemon ACTUALLY serves them (crew#342's shipped shape +
 * the api-types 0.19.0 additions built for wicked-studio#27).
 *
 * ── INTEGRATION POINT (api-types 0.19.0) ─────────────────────────────────────────────────────
 * These shapes are hand-mirrored VERBATIM from `wicked-crew-api-types` 0.19.0 (the engine's
 * persisted `Campaign` plus the daemon-joined rollup fields) because studio's installed
 * `wicked-crew-api-types` is stale at 0.8.x. Like `SessionDelivery` in `./types.ts`, every
 * declaration here is TEMPORARY: **delete this block and re-export from
 * `wicked-crew-api-types`** the moment studio bumps to ≥ 0.19.0.
 *
 * ⚠ WIRE CORRECTION over the first cut of this file: crew#342 shipped the ENGINE campaign
 * shape (`id`/`def`/`node_status`/`node_run_id`…), NOT the DES-CAMPAIGN-001 §1.4 summary DTO
 * this module used to mirror (`{campaign:{title,expected,…}, counts, prs}`). The old mirror
 * was checked against the live daemon (`GET :7701/api/v1/campaigns`) and disagrees with every
 * shipping payload — the design was superseded by the parallel crew lane. What replaces the
 * design's server-side counts: `node_status` is ENGINE-PERSISTED over the full node set, so
 * client-side folds over it keep the §4.2 archived-run honesty the old counts existed for.
 *
 * The support probe (§1.5) is unchanged: an older daemon has no `/campaigns` route, so `404`
 * means "this daemon predates campaigns"; `200` with an empty list is "no campaigns yet".
 */

import { apiFetch } from './client.js';
import type { SessionStatus } from './types.js';

/** Per-node lifecycle status. Terminal = `completed` | `failed` | `blocked` | `cancelled`. */
export type CampaignNodeStatus =
  | 'pending'
  | 'ready'
  | 'running'
  | 'awaiting_human'
  | 'ready_to_resume'
  | 'completed'
  | 'failed'
  | 'blocked'
  | 'cancelled';

/** Campaign lifecycle status — also what `/resume` / `/cancel` resolve to. */
export type CampaignStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'partially_completed'
  | 'failed'
  | 'cancelled';

/** What one campaign node runs — only the fields studio reads are typed. */
export interface CampaignRunSpec {
  /** The free-text problem this node's run decomposes (a short label for scenario nodes). */
  problem: string;
  /** The registered repo the node's run targets, if any. */
  repo_ref?: string | null;
  workflow_id?: string | null;
  [k: string]: unknown;
}

/** A schedulable unit of the DAG — one node = one governed core run. */
export interface CampaignNode {
  /** Stable node id, unique within the campaign (never contains `:`). */
  node_id: string;
  run_spec: CampaignRunSpec;
  [k: string]: unknown;
}

/** The static campaign definition, persisted verbatim inside the live {@link Campaign}. */
export interface CampaignDef {
  id: string;
  name: string;
  nodes: CampaignNode[];
  [k: string]: unknown;
}

/**
 * One member's delivery snapshot on the campaigns surface (api-types 0.19.0) — the same
 * tri-state + URL contract as `AgentSession.delivery`/`deliverUrl` (crew#393/#311), derived
 * by the same daemon code at DTO assembly. `deliverUrl` present exactly when
 * `delivery === 'delivered'`.
 */
export interface CampaignNodeDelivery {
  delivery: 'delivered' | 'stranded' | 'vacuous' | 'none';
  /** Untrusted until it passes `isPrUrl` — every rendering goes through that gate. */
  deliverUrl?: string;
}

/**
 * An ad-hoc run on the campaigns surface (api-types 0.19.0) — a member of
 * `Campaign.attached_runs` or `RunGroup.runs`. `runId` is the engine session id: live `/ws`
 * CoreEvent frames for it carry it as `session`, so narration correlation is client-side.
 */
export interface AttachedRunView {
  runId: string;
  status: SessionStatus;
  delivery: CampaignNodeDelivery['delivery'];
  deliverUrl?: string;
}

/**
 * The live campaign instance as `GET /campaigns` serves it: the engine's persisted shape
 * verbatim, plus two DAEMON-JOINED 0.19.0 fields (`node_delivery`, `attached_runs`) that are
 * assembled per request and never engine-persisted.
 */
export interface Campaign {
  id: string;
  def_id: string;
  status: CampaignStatus;
  /** The full definition, embedded — `def.nodes` is the ladder and the real denominator. */
  def: CampaignDef;
  node_status: Record<string, CampaignNodeStatus>;
  /**
   * node_id → live run id (`{campaign}:{node}:a{attempt}`). These ARE engine session ids:
   * served by `GET /runs/:id`, and every session-scoped `/ws` frame carries one as `session`
   * — so a campaign card's live narration is a pure client-side correlation, no extra wire.
   */
  node_run_id: Record<string, string>;
  /** node_id → 0-based attempt counter. */
  node_attempt?: Record<string, number>;
  /**
   * Per-node delivery (api-types 0.19.0), keyed like `node_status`; a node appears once its
   * current-attempt run exists on the store. ABSENT (the whole field) only from a pre-0.19
   * daemon — which is the honest "no rollup" discriminator, per-field, not per-route.
   */
  node_delivery?: Record<string, CampaignNodeDelivery>;
  /**
   * Ad-hoc runs attached at launch (`LaunchRunBody.campaignId`) — NOT DAG nodes: the
   * scheduler ignores them; provenance only. Absent from a pre-0.19 daemon; `[]` when none.
   */
  attached_runs?: AttachedRunView[];
  [k: string]: unknown;
}

/**
 * An ad-hoc label group (api-types 0.19.0): the runs launched with the same
 * `LaunchRunBody.groupLabel`, in launch order. NOT an engine campaign — no DAG, no scheduler,
 * no status of its own; it exists the moment the first run is launched under the label.
 */
export interface RunGroup {
  label: string;
  runs: AttachedRunView[];
}

/** `GET /campaigns` 200 body — `groups` is ADDITIVE (a pre-0.19 daemon sends only campaigns). */
export interface CampaignsListResponse {
  campaigns: Campaign[];
  groups: RunGroup[];
}

/**
 * The acceptance gate's resolution for one run — the `gate` half of crew's
 * `GET /runs/:id/acceptance` (a shipping route today; crew-internal `AcceptanceView`, so only
 * the fields the verdict chip reads are typed here). Deny-dominates: `satisfied` is `true`
 * only for a clean PASS or when nothing was required; `reason` is always populated.
 */
export interface RunAcceptance {
  runId: string;
  gate: {
    required: boolean;
    satisfied: boolean;
    verdict: string | null;
    reason: string;
  };
  [k: string]: unknown;
}

/**
 * `GET /campaigns` — 200 with empty lists on an empty store; 404/501 = daemon predates
 * campaigns (§1.5). A pre-0.19 daemon omits `groups`, normalized here to `[]` so no consumer
 * carries the `undefined` arm.
 */
export async function listCampaigns(): Promise<CampaignsListResponse> {
  const res = await apiFetch<{ campaigns?: Campaign[]; groups?: RunGroup[] }>('/campaigns');
  return { campaigns: res.campaigns ?? [], groups: res.groups ?? [] };
}

/** `GET /campaigns/:id` — `{ campaign }`, the same daemon-side join as the list; 404 unknown. */
export async function getCampaign(id: string): Promise<Campaign> {
  const res = await apiFetch<{ campaign: Campaign }>(`/campaigns/${encodeURIComponent(id)}`);
  return res.campaign;
}

/** `GET /runs/:id/acceptance` — always 200 for a known run ("no ledger" is an answer, not an error). */
export function getRunAcceptance(runId: string): Promise<RunAcceptance> {
  return apiFetch<RunAcceptance>(`/runs/${encodeURIComponent(runId)}/acceptance`);
}
