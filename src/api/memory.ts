/**
 * The memory wire — types and calls for the Memory page (`/memory`, a Desk tab beside Steer):
 * browse the estate memory store, filter by tier and facet, read the store's real totals, add a
 * memory, and retire one memory or a scope subtree. Memory is what helpers REMEMBER (witnessed or
 * told context they recall); Steering is the rules they are HELD to (operator 2026-10-17: "memories
 * and steering are separate"). Memory PROPOSALS ride the shared proposal wire in `./proposals.ts`.
 *
 * ── CONTRACT (faceted-memory build) ───────────────────────────────────────────────────────────
 * `MemoryItem` comes from `wicked-crew-api-types` (pin 0.92.0, ASK-S1) — the engine's serde output,
 * verbatim. `MemoryBrowseQuery` below is studio's TYPED input to {@link listMemories}; it serializes
 * to the contract's `ListMemoriesQuery` wire (`facets` as ONE JSON-encoded object, which is what
 * crew parses — codex on #519 caught the old `facet.<key>=<value>` spelling, which no caller used
 * and crew never read; the exact-`scope` parameter went the same way, crew reads `scope_prefix`
 * only). `MemoryCoverage` is studio's own reading.
 *
 * The support probe is the same two-layer adoption seam as the wiki/steering/proposal reads: a
 * bare 404 (Fastify's unknown-route answer) means "this crew daemon predates the memory routes";
 * a 501 means "the route exists but the embedded engine predates the memory-store method".
 * {@link isMemoryUnsupported} folds both so every caller renders the honest state, never a raw
 * refusal.
 *
 * crew has no direct memory write: a new memory is FILED as a proposal (`POST /proposals`) and
 * then approved (`POST /proposals/:id/approve`) — {@link addMemory}. Every write goes through
 * crew's API, the governed operator path; studio never touches estate directly.
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';
import { approveProposal, fileProposal } from './proposals.js';

// ── The page's addresses ─────────────────────────────────────────────────────────────────────

/** The Memory page's views: the memories kept, and the memory proposals waiting on review. */
export type MemoryView = 'memories' | 'proposals';

export const MEMORY_PATH = '/memory';

/** The Memory page's address — bare for the memories, `?view=proposals` for the proposals. */
export function memoryPath(view: MemoryView = 'memories'): string {
  return view === 'proposals' ? `${MEMORY_PATH}?view=proposals` : MEMORY_PATH;
}

/** The view a Memory address names (anything but `proposals` is the memories). */
export function readMemoryView(search: string): MemoryView {
  return new URLSearchParams(search).get('view') === 'proposals' ? 'proposals' : 'memories';
}

// ── The memory item (from the contract package) ───────────────────────────────────────────────

/** Coverage over a scope subtree — how much memory the store holds there. Read permissively: the
 *  exact shape is not in api-types yet, so extra fields are tolerated and absent ones degrade. */
import type { ListMemoriesQuery, MemoryItem } from 'wicked-crew-api-types';
export type { ListMemoriesQuery, MemoryItem };

export interface MemoryCoverage {
  total?: number;
  /** Per-tier counts (`session | project | global | …`). */
  by_tier?: Record<string, number>;
  [k: string]: unknown;
}

// ── Calls (the governed operator path — every write goes through crew's `/api/v1`) ────────────

/**
 * `GET /memory` — the memory store, optionally recall-queried / scope-scoped / facet-filtered.
 * Unwraps `{ memories }`, but tolerates a bare array so a slightly different serialization still
 * reads rather than throwing.
 */
export interface MemoryBrowseQuery {
  /** A content substring filter over the complete in-scope set (crew post-filters; not a recall). */
  query?: string;
  /** Scope PREFIX to read a subtree. */
  scope_prefix?: string;
  /** Facet equality filters — sent as the contract's ONE JSON-encoded `facets` object. */
  facets?: Record<string, string>;
  /** Cap on rows returned. */
  limit?: number;
}

/** The query as it rides the wire — the contract's {@link ListMemoriesQuery}, built from the typed input. */
export function memoryBrowseParams(query: MemoryBrowseQuery): URLSearchParams {
  const params = new URLSearchParams();
  const wire: ListMemoriesQuery = {
    ...(query.query !== undefined && query.query !== '' ? { query: query.query } : {}),
    ...(query.scope_prefix !== undefined && query.scope_prefix !== '' ? { scope_prefix: query.scope_prefix } : {}),
    ...(query.limit !== undefined ? { limit: String(query.limit) } : {}),
    ...(query.facets !== undefined && Object.keys(query.facets).length > 0 ? { facets: JSON.stringify(query.facets) } : {}),
  };
  for (const [k, v] of Object.entries(wire)) if (typeof v === 'string') params.set(k, v);
  return params;
}

export function listMemories(query: MemoryBrowseQuery = {}): Promise<MemoryItem[]> {
  const params = memoryBrowseParams(query);
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
 * report how many rows were removed. This reaches the whole subtree, so the caller must say so;
 * to remove ONE row use {@link retireMemoryItem}.
 */
export function retireMemory(body: { scope_prefix: string }): Promise<{ erased: number }> {
  return apiFetch<{ erased: number }>('/memory/retire', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * `POST /memory/retire-item` (studio#206; crew api-types 0.59.0) — erase exactly ONE memory by its
 * id. 404 = no memory with that id; 501 with `code: "estate_upgrade_required"` = the daemon's estate
 * cannot erase by id yet (nothing was deleted — see {@link isEraseByIdUnsupported}).
 */
export function retireMemoryItem(body: { memory_id: string }): Promise<{ erased: number }> {
  return apiFetch<{ erased: number }>('/memory/retire-item', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * True when a one-memory retire was refused because this daemon cannot do it: its estate predates
 * erase-by-id (a 501), or the crew predates the route (Fastify's bare unknown-route 404). Nothing
 * was deleted either way — the panel says so and never falls back to a subtree erase.
 */
export function isEraseByIdUnsupported(e: unknown): boolean {
  return (e instanceof ApiError && e.status === 501) || isRouteAbsent(e);
}

/**
 * Add a memory. crew has no direct memory write, so this is two calls: `POST /proposals` files the
 * words as a pending memory proposal (crew makes it a `semantic` memory; `project` becomes its
 * `project` facet, so it is recalled on that project only), then `POST /proposals/:id/approve`
 * approves it, which writes the memory. When the approve fails the proposal stays pending —
 * {@link AddMemoryApproveError} names it, so the page can say it waits under Proposals.
 */
export async function addMemory(body: { content: string; project?: string }): Promise<{ proposalId: string; memoryId: string | null }> {
  const { id } = await fileProposal(body.project !== undefined ? { content: body.content, project: body.project } : { content: body.content });
  try {
    const out = await approveProposal(id);
    const active = (out as { active_id?: unknown }).active_id;
    return { proposalId: id, memoryId: typeof active === 'string' ? active : null };
  } catch (e) {
    throw new AddMemoryApproveError(id, e);
  }
}

/** The memory was filed as a proposal but approving it failed: it is pending, nothing was written. */
export class AddMemoryApproveError extends Error {
  constructor(readonly proposalId: string, readonly reason: unknown) {
    super(reason instanceof Error ? reason.message : String(reason));
    this.name = 'AddMemoryApproveError';
  }
}

/**
 * `POST /memory/edit` (crew, the memory-edit route) — change one memory's words. estate has no
 * in-place update, so crew writes the new words as a new memory with the old one's tier, scope and
 * facets, then retires the old one; if the retire fails it takes the new one back out, so an edit
 * lands whole or not at all. Answers the new memory's id.
 *
 * The body and answer are mirrored here until the contract package publishes them (crew's
 * `EditMemoryBody` / `EditMemoryResponse`); a daemon without the route answers the bare 404
 * {@link isMemoryEditUnsupported} reads, and nothing changes.
 */
export interface EditMemoryBody { memory_id: string; content: string }
export interface EditMemoryResponse { memory_id: string; retired: string }

export function editMemory(body: EditMemoryBody): Promise<EditMemoryResponse> {
  return apiFetch<EditMemoryResponse>('/memory/edit', { method: 'POST', body: JSON.stringify(body) });
}

/** True when this daemon cannot edit a memory: crew predates the route, or its estate cannot. */
export function isMemoryEditUnsupported(e: unknown): boolean {
  return (e instanceof ApiError && e.status === 501) || isRouteAbsent(e);
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
