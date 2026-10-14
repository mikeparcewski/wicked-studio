import { api } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import { registerAdapter } from '../hostApi.js';
import { InteractiveDocSurfaceAdapter } from './interactiveDoc.js';

export type DocumentRequirement = { id: string; title: string };
export type DocumentRequirements = { rows: DocumentRequirement[]; total: number };
const cache = new Map<string, { at: number; rows: Promise<DocumentRequirements> }>();
const FRESH_MS = 30_000;

const NONE: DocumentRequirements = { rows: [], total: 0 };

/** Host-owned repository lookup. Only requirement ids and titles cross the plugin port. A document with no repository,
 *  or a repository with no requirements read (crew's 404), has no requirements — an answer, not a failed read: the
 *  Coverage tab says "No requirements", never "Couldn't read" with a retry that cannot help. */
export function requirementsFor(repoId: string | null | undefined): () => Promise<DocumentRequirements> {
  return () => {
    if (!repoId) return Promise.resolve(NONE);
    const hit = cache.get(repoId);
    if (hit !== undefined && Date.now() - hit.at < FRESH_MS) return hit.rows;
    const rows = api.listRequirements(repoId, { limit: 50 })
      .then((page) => ({ rows: page.items.map((r) => ({ id: r.reqId, title: r.title })), total: page.total }))
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return NONE;
        if (cache.get(repoId)?.rows === rows) cache.delete(repoId);
        throw error;
      });
    cache.set(repoId, { at: Date.now(), rows });
    return rows;
  };
}

registerAdapter('interactive-doc', (b) => new InteractiveDocSurfaceAdapter(b, { requirements: requirementsFor(b.repoId) }));
