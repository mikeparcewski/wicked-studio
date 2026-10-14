import { api } from '../../api/client.js';

export type DocumentRequirement = { id: string; title: string };
const cache = new Map<string, { at: number; rows: Promise<DocumentRequirement[] | null> }>();
const FRESH_MS = 30_000;

/** Host-owned repository lookup. Only requirement ids and titles cross the plugin port. */
export function requirementsFor(repoId: string | null | undefined): () => Promise<DocumentRequirement[] | null> {
  return () => {
    if (!repoId) return Promise.resolve(null);
    const hit = cache.get(repoId);
    if (hit !== undefined && Date.now() - hit.at < FRESH_MS) return hit.rows;
    const rows = api.listRequirements(repoId, { limit: 50 })
      .then((page) => page.items.map((r) => ({ id: r.reqId, title: r.title })))
      .catch(() => { if (cache.get(repoId)?.rows === rows) cache.delete(repoId); return null; });
    cache.set(repoId, { at: Date.now(), rows });
    return rows;
  };
}
