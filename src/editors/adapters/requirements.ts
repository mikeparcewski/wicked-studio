import { api } from '../../api/client.js';
import { registerAdapter } from '../hostApi.js';
import { InteractiveDocSurfaceAdapter } from './interactiveDoc.js';

export type DocumentRequirement = { id: string; title: string };
export type DocumentRequirements = { rows: DocumentRequirement[]; total: number };
const cache = new Map<string, { at: number; rows: Promise<DocumentRequirements> }>();
const FRESH_MS = 30_000;

/** Host-owned repository lookup. Only requirement ids and titles cross the plugin port. */
export function requirementsFor(repoId: string | null | undefined): () => Promise<DocumentRequirements> {
  return () => {
    if (!repoId) return Promise.reject(new Error('no repository for this artifact'));
    const hit = cache.get(repoId);
    if (hit !== undefined && Date.now() - hit.at < FRESH_MS) return hit.rows;
    const rows = api.listRequirements(repoId, { limit: 50 })
      .then((page) => ({ rows: page.items.map((r) => ({ id: r.reqId, title: r.title })), total: page.total }))
      .catch((error: unknown) => { if (cache.get(repoId)?.rows === rows) cache.delete(repoId); throw error; });
    cache.set(repoId, { at: Date.now(), rows });
    return rows;
  };
}

registerAdapter('interactive-doc', (b) => new InteractiveDocSurfaceAdapter(b, { requirements: requirementsFor(b.repoId) }));
