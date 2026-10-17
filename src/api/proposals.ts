/**
 * The proposal-queue wire (DES-MEM-FACETED-001) — types and calls for the review queue where
 * agent-proposed items wait, each `pending`, for a person to approve or reject. Two pages read it:
 * Steer reviews the POLICY proposals (`/steering/proposals`), Memory the MEMORY proposals
 * (`/memory?view=proposals`); the Desk's Needs you lists both.
 *
 * ── CONTRACT (faceted-memory build) ───────────────────────────────────────────────────────────
 * `Proposal`, `ProposalState` and `FileProposalBody` come from `wicked-crew-api-types` (pin 0.92.0,
 * ASK-S1) — the engine's serde output, verbatim. `ProposalApproveOutcome` below is
 * studio's own reading.
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

// ── The proposal (from the contract package) ─────────────────────────────────────────────────

/** Approve returns the engine's outcome — its exact shape is not in api-types yet, so it is
 *  read permissively (a stored item id, an ok flag). */
import type { ApproveProposalBody, ProposalState, Proposal, FileProposalBody } from 'wicked-crew-api-types';
export type { ApproveProposalBody, ProposalState, Proposal, FileProposalBody };

export interface ProposalApproveOutcome {
  ok?: boolean;
  id?: string;
  [k: string]: unknown;
}

// ── The kind a proposal is ───────────────────────────────────────────────────────────────────

/**
 * The concrete kind a proposal belongs to, folded from its `kind_type`: `"memory"` → `memory`,
 * anything starting `"policy"` (`"policy:security"`, `"policy"`) → `policy`, everything else →
 * `other`. A proposal whose kind studio does not recognize is still counted in Needs you, so it is
 * never silently dropped.
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
 *  governed-knowledge item and returns its outcome. `content` approves a MEMORY proposal with an
 *  edit: crew files the edited copy, approves it and rejects the original (api-types 0.49.0). */
export function approveProposal(id: string, body?: ApproveProposalBody): Promise<ProposalApproveOutcome> {
  return apiFetch<ProposalApproveOutcome>(`/proposals/${encodeURIComponent(id)}/approve`, {
    method: 'POST',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

/** `POST /proposals` — file one memory into the review queue (crew files it as a pending
 *  `semantic` memory proposal); answers the pending id. Memory's Add memory files then approves. */
export function fileProposal(body: FileProposalBody): Promise<{ id: string }> {
  return apiFetch<{ id: string }>('/proposals', {
    method: 'POST',
    body: JSON.stringify(body),
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
