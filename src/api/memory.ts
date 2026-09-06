/**
 * The memory-management wire — types and calls for the Memories sub-section of the Steering
 * surface (`/steering/memories`): browse the estate memory store, filter by facet, and retire a
 * scope subtree. The read/decide twin (memory PROPOSALS) rides the shared proposal wire in
 * `./proposals.ts` — this module is only the "manage existing memories" half.
 *
 * ── INTEGRATION POINT (faceted-memory build, paired estate/crew lane) ─────────────────────────
 * The `MemoryItem` shape is hand-mirrored from the engine that PRODUCES it — the estate memory
 * store, surfaced through crew's `/api/v1/memory*` slice (built in a parallel lane) — because
 * that crew slice is not yet in studio's installed `wicked-crew-api-types`. Like the wiki shapes
 * in `./wiki.ts`, the steering shapes in `./steering.ts`, and the proposal shapes in
 * `./proposals.ts`, every declaration here is TEMPORARY: **delete this block and re-export from
 * `wicked-crew-api-types`** the moment studio bumps to the api-types version that carries the
 * memory contract. Field names are the engine's serde output, verbatim.
 *
 * The support probe is the same two-layer adoption seam as the wiki/steering/proposal reads: a
 * bare 404 (Fastify's unknown-route answer) means "this crew daemon predates the memory routes";
 * a 501 means "the route exists but the embedded engine predates the memory-store method".
 * {@link isMemoryUnsupported} folds both so every caller renders the honest state, never a raw
 * refusal.
 *
 * estate MCP stays READ-ONLY: the retire write below goes through crew's API, the governed
 * operator path — studio never touches estate directly.
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

// ── The memory item (mirrored from the estate memory store; DELETE once api-types carries it) ──

/**
 * One stored memory. `scope` is the store's addressing key (`brain:<project>/doc:<id>`,
 * `data/users/<id>/…`) — retire targets a scope PREFIX, so retiring by an item's own scope
 * erases that item and everything filed deeper under it (be honest about that granularity in the
 * UI). `facets` are the dimensions it is tagged with (project, repo, domain, …); `score` is the
 * recall relevance, present only on a queried read.
 */
export interface MemoryItem {
  id: string;
  content: string;
  tier: string;
  scope: string;
  facets: Record<string, string>;
  score?: number;
}

/** Coverage over a scope subtree — how much memory the store holds there. Read permissively: the
 *  exact shape is not in api-types yet, so extra fields are tolerated and absent ones degrade. */
export interface MemoryCoverage {
  total?: number;
  /** Per-tier counts (`session | project | global | …`). */
  by_tier?: Record<string, number>;
  [k: string]: unknown;
}

export interface ListMemoriesQuery {
  /** A recall query — when present the read is a relevance search (scored), else a plain browse. */
  query?: string;
  /** Exact scope to read. */
  scope?: string;
  /** Scope PREFIX to read a subtree. */
  scope_prefix?: string;
  /** Facet equality filters, sent as `facet.<key>=<value>`. */
  facets?: Record<string, string>;
  /** Cap on rows returned. */
  limit?: number;
}

// ── Calls (the governed operator path — every write goes through crew's `/api/v1`) ────────────

/**
 * `GET /memory` — the memory store, optionally recall-queried / scope-scoped / facet-filtered.
 * Unwraps `{ memories }`, but tolerates a bare array so a slightly different serialization still
 * reads rather than throwing.
 */
export function listMemories(query: ListMemoriesQuery = {}): Promise<MemoryItem[]> {
  const params = new URLSearchParams();
  if (query.query !== undefined && query.query !== '') params.set('query', query.query);
  if (query.scope !== undefined && query.scope !== '') params.set('scope', query.scope);
  if (query.scope_prefix !== undefined && query.scope_prefix !== '') params.set('scope_prefix', query.scope_prefix);
  if (query.limit !== undefined) params.set('limit', String(query.limit));
  if (query.facets !== undefined) {
    for (const [k, v] of Object.entries(query.facets)) params.set(`facet.${k}`, v);
  }
  const qs = params.toString();
  return apiFetch<{ memories?: MemoryItem[] } | MemoryItem[]>(`/memory${qs === '' ? '' : `?${qs}`}`).then(
    (r) => (Array.isArray(r) ? r : r.memories ?? []),
  );
}

/** `GET /memory/coverage` — how much memory the store holds under a scope prefix (all of it when
 *  omitted). */
export function memoryCoverage(query: { scope_prefix?: string } = {}): Promise<MemoryCoverage> {
  const params = new URLSearchParams();
  if (query.scope_prefix !== undefined && query.scope_prefix !== '') params.set('scope_prefix', query.scope_prefix);
  const qs = params.toString();
  return apiFetch<MemoryCoverage>(`/memory/coverage${qs === '' ? '' : `?${qs}`}`);
}

/**
 * `POST /memory/retire` — erase a scope SUBTREE (everything filed at or under `scope_prefix`) and
 * report how many rows were removed. Retire is by prefix: there is no single-item delete on the
 * wire, so the caller must be honest that this reaches the whole subtree.
 */
export function retireMemory(body: { scope_prefix: string }): Promise<{ erased: number }> {
  return apiFetch<{ erased: number }>('/memory/retire', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── The adoption seam ─────────────────────────────────────────────────────────────────────────

/**
 * True when this daemon cannot serve the memory-management wire yet: a 501 (route present, engine
 * method absent) or Fastify's bare unknown-route 404 (crew predates the memory routes). A NAMED
 * 404/4xx from a daemon WITH the route is a real answer and surfaces as one.
 */
export function isMemoryUnsupported(e: unknown): boolean {
  return (e instanceof ApiError && e.status === 501) || isRouteAbsent(e);
}

/** The honest in-band copy for {@link isMemoryUnsupported} refusals. */
export const MEMORY_UNSUPPORTED_COPY =
  'This daemon predates memory management (its crew/estate slice) — the memory store cannot be browsed or retired here yet. Memory proposals will still appear once the daemon serves them.';
