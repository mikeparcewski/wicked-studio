/**
 * The campaign wire (DES-CAMPAIGN-001 §1.4/§4.1 + TH-14) — types and calls for the
 * read-only campaign surface: `GET /campaigns` and `GET /campaigns/:id`.
 *
 * ── INTEGRATION POINT (TH-9 / crew#342, marked per the TH-14 lane) ──────────────────────────
 * These shapes are hand-mirrored from the MERGED design contract in
 * `.product/DES-CAMPAIGN-001.md` §1.4 (b)–(d) because the crew slice that serves them
 * (crew#342 slice 1: api-types Campaign contract + store + read routes) is being built in a
 * parallel lane and studio's installed `wicked-crew-api-types` predates it. Like
 * `SessionDelivery` in `./types.ts`, every declaration here is TEMPORARY: **delete this
 * block and re-export from `wicked-crew-api-types`** the moment studio bumps to the
 * api-types version that carries the Campaign contract. Field names, spellings and null
 * conventions below are the design's, verbatim — a served payload that disagrees is a
 * contract bug, not an adoption gap.
 *
 * The support probe (§1.5) is the adoption seam: an older daemon has no `/campaigns` route,
 * so `404` means "this daemon predates campaigns" and the surface says so honestly —
 * `200 []` is the "no campaigns yet" answer, never a 404.
 */

import { apiFetch } from './client.js';
import type { SessionStatus } from './types.js';

/** The campaign — the launch-time label that groups the sibling runs of one effort (§1.4b). */
export interface Campaign {
  /** The label itself; minted by first use, never by a create call. */
  id: string;
  /** Operator-set display title; `null` ⇒ surfaces render the id. */
  title: string | null;
  /**
   * Operator-declared total run count (>= 1), or `null` when undeclared — the DENOMINATOR of
   * "n of m landed". §3.3: a surface must SAY which denominator it is using (the "so far"
   * suffix), never render the two identically.
   */
  expected: number | null;
  /** Unix millis — the first launch that used this label. */
  created_at: number;
  /** Unix millis — the newest launch filed here, or the newest metadata write. */
  updated_at: number;
  [k: string]: unknown;
}

/**
 * Run counts over the campaign's FULL filed set, INCLUDING archived runs — computed
 * server-side (§4.2: the client's run list is archive-filtered, so a client-derived
 * denominator shrinks when the operator archives a landed run — remembering what the run
 * list forgets is the campaign's entire job).
 */
export interface CampaignCounts {
  filed: number;
  landed: number;
  failed: number;
  cancelled: number;
  /** `planning | distributing | executing`. */
  running: number;
  awaitingHuman: number;
  /** Any status the daemon could not classify — never folded into another bucket. */
  other: number;
  /** How many of `filed` are archived — reported so a surface can explain a gap it cannot show. */
  archived: number;
}

/** A landed run's pull request (§4.3) — the URL verbatim as the deliver phase printed it. */
export interface CampaignPr {
  runId: string;
  url: string;
}

/** One row of `GET /campaigns` (§1.4c). */
export interface CampaignSummary {
  campaign: Campaign;
  /** Every run filed under this label, newest launch first. INCLUDES archived runs (§4.2). */
  runIds: string[];
  /** The projects those runs are filed into, deduped, first-seen order (§3.4). */
  projectIds: string[];
  counts: CampaignCounts;
  /** Landed runs that opened a PR, newest first; capped server-side. */
  prs: CampaignPr[];
  prsTruncated: boolean;
}

/** One run's place in a campaign (§1.4d). Status is a SNAPSHOT — live status stays the run list's job. */
export interface CampaignRun {
  runId: string;
  /** The run's status at read time; `null` when the engine no longer holds the run. */
  status: SessionStatus | null;
  /** The project this run is filed into, or `null` for an unfiled run. */
  projectId: string | null;
  problem: string;
  /** Unix millis — when the label was attached. */
  filed_at: number;
  /** The PR this run opened, when it opened one. */
  prUrl?: string;
  /** True when the run is archived and therefore absent from the default `GET /runs` list. */
  archived: boolean;
  /**
   * INTEGRATION POINT (TH-20 / test-R22, NOT in DES-CAMPAIGN-001 §1.4): per-node cost, once
   * campaign budget governance folds token/cost accounting into the evidence manifest and
   * crew serves it here. Absent on every daemon shipping today — the scoreboard's cost
   * column renders an honest "—" until the producer exists.
   */
  cost?: number;
}

/** `GET /campaigns/:id` — the summary plus the per-run roll-up the list route is too hot to carry. */
export interface CampaignDetail {
  campaign: Campaign;
  runs: CampaignRun[];
  counts: CampaignCounts;
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

/** `GET /campaigns` — always 200 with `[]` on an empty store; 404 = daemon predates campaigns (§1.5). */
export function listCampaigns(): Promise<{ campaigns: CampaignSummary[] }> {
  return apiFetch<{ campaigns: CampaignSummary[] }>('/campaigns');
}

/** `GET /campaigns/:id` — 404 on an unknown label. */
export function getCampaign(id: string): Promise<CampaignDetail> {
  return apiFetch<CampaignDetail>(`/campaigns/${encodeURIComponent(id)}`);
}

/** `GET /runs/:id/acceptance` — always 200 for a known run ("no ledger" is an answer, not an error). */
export function getRunAcceptance(runId: string): Promise<RunAcceptance> {
  return apiFetch<RunAcceptance>(`/runs/${encodeURIComponent(runId)}/acceptance`);
}
