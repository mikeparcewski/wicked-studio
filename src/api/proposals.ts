/**
 * The proposal-queue wire (DES-MEM-FACETED-001) — types and calls for the "policies and
 * memories" review queue (`/proposals`): the surface where agent-proposed governed-knowledge
 * items wait, each `pending`, for a human to approve or reject.
 *
 * ── INTEGRATION POINT (faceted-memory build, paired estate/crew lane) ─────────────────────────
 * The `Proposal` shape is hand-mirrored from the engine that PRODUCES it — the estate proposal
 * store, surfaced through crew's `/api/v1/proposals*` slice (built in a parallel lane) — because
 * that crew slice is not yet in studio's installed `wicked-crew-api-types`. Like the wiki shapes
 * in `./wiki.ts` and the steering shapes in `./steering.ts`, every declaration here is
 * TEMPORARY: **delete this block and re-export from `wicked-crew-api-types`** the moment studio
 * bumps to the api-types version that carries the proposal contract. Field names are the
 * engine's serde output, verbatim — a served payload that disagrees is a contract bug, not an
 * adoption gap.
 *
 * The support probe is the same two-layer adoption seam as the wiki/steering reads: a bare 404
 * (Fastify's unknown-route answer) means "this crew daemon predates the proposal routes"; a 501
 * means "the route exists but the embedded engine predates the proposal-store method".
 * {@link isProposalsUnsupported} folds both so every caller renders the honest state, never a
 * raw refusal.
 *
 * estate MCP stays READ-ONLY: every write below (approve / reject) goes through crew's API, the
 * governed operator path — studio never touches estate directly.
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

// ── The proposal (mirrored from the estate proposal store; DELETE once api-types carries it) ──

/** A proposal's lifecycle state. `pending` is the only one the queue lists by default. */
export type ProposalState = 'pending' | 'approved' | 'rejected';

/**
 * One agent-proposed governed-knowledge item awaiting human review. `kind_type` is the
 * discriminator — `"memory"` for a proposed memory, `"policy:<steering_type>"` for a proposed
 * steering policy (e.g. `"policy:security"`). `payload` is `unknown` because its shape depends
 * on the kind — read it through the narrowing helpers below, never by blind cast.
 */
export interface Proposal {
  id: string;
  /** `"memory"` | `"policy:<steering_type>"` — the type dimension the queue filters on. */
  kind_type: string;
  /** Kind-dependent body — narrow with {@link memoryPayload} / {@link policyPayload}. */
  payload: unknown;
  /** Facet dimensions the proposal is tagged with (project, repo, domain, …). */
  facets: Record<string, string>;
  /** Which run/agent proposed it (run id, agent, source, …). */
  provenance: Record<string, string>;
  state: ProposalState;
  /** Unix-epoch seconds the proposal was created. */
  created_at: number;
}

/** Approve returns the engine's outcome — its exact shape is not in api-types yet, so it is
 *  read permissively (a stored item id, an ok flag). */
export interface ProposalApproveOutcome {
  ok?: boolean;
  id?: string;
  [k: string]: unknown;
}

// ── The type filter (first-class, so more kinds can be added) ─────────────────────────────────

/** The queue's type dimension. `all` is the default view; every other value is a kind the
 *  queue can filter to. New governed-knowledge kinds add a member here and a label below — the
 *  page derives its filter chips from this list, so nothing else changes. */
export const PROPOSAL_KINDS = ['all', 'memory', 'policy'] as const;

export type ProposalKind = (typeof PROPOSAL_KINDS)[number];

export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = {
  all: 'All',
  memory: 'Memory',
  policy: 'Policy',
};

export function isProposalKind(s: string): s is ProposalKind {
  return (PROPOSAL_KINDS as readonly string[]).includes(s);
}

/** The one spelling of the queue's route — bare `/proposals` for `all`, `?type=<kind>` for a
 *  filtered view (deep-linkable, back-button-correct; shared by the page and the rail). */
export function proposalsPath(kind: ProposalKind = 'all'): string {
  return kind === 'all' ? '/proposals' : `/proposals?type=${kind}`;
}

/** The active type filter read from a `location.search` string; an absent or unknown `type`
 *  resolves to `all` — a mangled bookmark shows the whole queue, never an error. */
export function readProposalKind(search: string): ProposalKind {
  const raw = new URLSearchParams(search).get('type');
  return raw !== null && isProposalKind(raw) ? raw : 'all';
}

/**
 * The concrete kind a proposal belongs to, folded from its `kind_type`: `"memory"` → `memory`,
 * anything starting `"policy"` (`"policy:security"`, `"policy"`) → `policy`, everything else →
 * `other`. A proposal whose kind studio does not recognize is still LISTED (under `all`) — a
 * proposal the operator cannot see is a proposal the operator cannot decide.
 */
export function proposalKind(p: Proposal): 'memory' | 'policy' | 'other' {
  const raw = p.kind_type.trim().toLowerCase();
  if (raw === 'memory') return 'memory';
  if (raw === 'policy' || raw.startsWith('policy:')) return 'policy';
  return 'other';
}

/** The steering type a `policy:<steering_type>` proposal carries, or null for a bare `"policy"`
 *  / non-policy kind. Surfaced beside the kind chip so the operator sees which steering page a
 *  policy would land on. */
export function policySteeringType(p: Proposal): string | null {
  const raw = p.kind_type.trim();
  const at = raw.indexOf(':');
  if (at === -1) return null;
  const tail = raw.slice(at + 1).trim();
  return tail === '' ? null : tail;
}

/** Whether a proposal passes the active type filter (`all` matches everything). */
export function proposalMatchesKind(p: Proposal, filter: ProposalKind): boolean {
  return filter === 'all' || proposalKind(p) === filter;
}

// ── Payload narrowing (payload is `unknown`; read it safely, never by blind cast) ─────────────

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

/** A memory proposal's body: the `content` line and its memory `tier`, each read defensively. */
export function memoryPayload(p: Proposal): { content: string | null; tier: string | null } {
  const rec = asRecord(p.payload);
  if (rec === null) return { content: null, tier: null };
  return { content: asString(rec.content), tier: asString(rec.tier) };
}

/** A policy proposal's body: the `rule` statement and its `severity`. The rule text is read
 *  from `rule` first, then `statement` (the steering wire's spelling) — whichever the engine
 *  serializes. */
export function policyPayload(p: Proposal): { rule: string | null; severity: string | null } {
  const rec = asRecord(p.payload);
  if (rec === null) return { rule: null, severity: null };
  return { rule: asString(rec.rule) ?? asString(rec.statement), severity: asString(rec.severity) };
}

// ── Calls (the governed operator path — every write goes through crew's `/api/v1`) ────────────

/**
 * `GET /proposals` — the queue, filtered server-side by `kind_type` and/or `state`. Both are
 * optional; omitting `state` lists every state, so the page passes `state: 'pending'` for its
 * default review view. `kind_type` here is the RAW discriminator (`"memory"`,
 * `"policy:security"`) — the page's coarse type filter (memory vs policy) is applied client-side
 * over the loaded rows, so switching it never re-hits the wire.
 */
export function listProposals(
  query: { kind_type?: string; state?: ProposalState } = {},
): Promise<Proposal[]> {
  const params = new URLSearchParams();
  if (query.kind_type !== undefined && query.kind_type !== '') params.set('kind_type', query.kind_type);
  if (query.state !== undefined) params.set('state', query.state);
  const qs = params.toString();
  return apiFetch<{ proposals: Proposal[] }>(`/proposals${qs === '' ? '' : `?${qs}`}`).then(
    (r) => r.proposals,
  );
}

/** `POST /proposals/:id/approve` — approve a pending proposal; the engine writes the
 *  governed-knowledge item and returns its outcome. */
export function approveProposal(id: string): Promise<ProposalApproveOutcome> {
  return apiFetch<ProposalApproveOutcome>(`/proposals/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
  });
}

/** `POST /proposals/:id/reject` — reject a pending proposal; nothing is written to the store. */
export function rejectProposal(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/proposals/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
  });
}

// ── The adoption seam ─────────────────────────────────────────────────────────────────────────

/**
 * True when this daemon cannot serve the proposal queue yet: a 501 (route present, engine
 * method absent) or Fastify's bare unknown-route 404 (crew predates the proposal routes). A
 * NAMED 404/4xx from a daemon WITH the route is a real answer and surfaces as one.
 */
export function isProposalsUnsupported(e: unknown): boolean {
  return (e instanceof ApiError && e.status === 501) || isRouteAbsent(e);
}

/** The honest in-band copy for {@link isProposalsUnsupported} refusals. */
export const PROPOSALS_UNSUPPORTED_COPY =
  'This daemon predates the proposal queue (its crew/estate slice) — there is nothing to review here yet. Governed-knowledge proposals will appear once the daemon serves them.';
