import type { KnowledgeMapNode } from 'wicked-crew-api-types';
import { apiFetch } from './client.js';
import { ApiError } from './errors.js';

/**
 * KNOWLEDGE FORGET (crew#1697, estate `knowledge.forget`): hard-delete document knowledge. Served when
 * `GET /health` `capabilities.knowledgeForget` is true (`useCapabilities().knowledgeForget`).
 *
 * The body and answer are mirrored from crew's contract (`ForgetKnowledgeBody`, `ForgetKnowledgeResponse`) until the
 * wicked-crew-api-types release that carries them. A live data source's structure is never forgotten: named by `id`,
 * crew answers 409 (it is refreshed through its source); a 501 means the estate predates forget and nothing was
 * deleted.
 */
export interface ForgetKnowledgeBody {
  id?: string;
  source?: string;
  scope_prefix?: string;
  confirm_erase_all?: boolean;
}

export interface ForgetKnowledgeResponse {
  forgotten: number;
  skipped_live_source: number;
}

/** `POST /knowledge/forget` — exactly one target (studio sends `id` only). */
export function forgetKnowledge(body: ForgetKnowledgeBody): Promise<ForgetKnowledgeResponse> {
  return apiFetch<ForgetKnowledgeResponse>('/knowledge/forget', { method: 'POST', body: JSON.stringify(body) });
}

/**
 * The estate knowledge id a map node can be forgotten by, or `null` when it is not forgettable here. Only an "Other
 * knowledge" node (crew `knowledge/shapes/map.ts` keys it `knowledge:<id>`, kind `knowledge`) is: a table is a data
 * source's live structure (refreshed through its source), a shape is an approved proposal, and code, repositories and
 * the tracker trail are not document knowledge.
 */
export function forgettableKnowledgeId(node: Pick<KnowledgeMapNode, 'key' | 'kind'>): string | null {
  if (node.kind !== 'knowledge' || !node.key.startsWith('knowledge:')) return null;
  const id = node.key.slice('knowledge:'.length);
  return id === '' ? null : id;
}

/** What a refused or failed forget means, in words (nothing was deleted in any of these). */
export function forgetFailureWords(e: unknown): string {
  if (e instanceof ApiError && e.status === 409) return 'This is a live data source’s structure: it is refreshed through its source, not forgotten. Nothing was deleted.';
  if (e instanceof ApiError && e.status === 501) return 'This daemon’s knowledge store can’t forget yet, so nothing was deleted.';
  if (e instanceof ApiError && e.status === 404) return 'The knowledge store no longer holds this, so nothing was deleted.';
  return `Couldn’t forget it: ${e instanceof Error ? e.message : String(e)}`;
}
