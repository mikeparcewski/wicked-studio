/**
 * What an app in a project can be built on (DES-KNOWLEDGE-DATA-001 §9.1): crew's `GET /knowledge/summary?project=`,
 * a human operator's read of counts and registry names only (never a row, a document's text or a memory's words). The
 * apps builder gets the SAME summary in its knowledge package, so a suggestion made from it names nothing the builder
 * cannot use.
 *
 * The wire is mirrored here (api-types 0.189.0 is not published yet), and every answer is read defensively: a field of
 * the wrong shape is dropped, a name outside crew's registry grammar is dropped, and an answer that cannot be read is
 * `null` (no knowledge suggestion), never a guess.
 */

import { apiFetch } from './client.js';

/**
 * The steering types, mirroring api-types `SteeringType` (until 0.189.0 is published): a closed list, so a type crew
 * adds later is dropped here (no suggestion names it) until this list carries it. That fails safe: fewer suggestions,
 * never a wrong one.
 */
export const STEERING_TYPES = ['architecture', 'development', 'security', 'testing', 'operations', 'compliance', 'design-ux'] as const;
export type SteeringTypeName = (typeof STEERING_TYPES)[number];

/** Mirrors api-types 0.189.0 `KnowledgeSummaryResponse`. */
export interface KnowledgeSummary {
  projectId: string;
  /** `shapes`: `null` = crew could not establish the count (its review queue was not read). */
  sources: Array<{ name: string; described: boolean; query: boolean; shapes: number | null }>;
  memories: { project: number; shared: number } | null;
  steering: { total: number; byType: Partial<Record<SteeringTypeName, number>> } | null;
}

/** crew's registry name grammar (`mcp/classify.ts` `MCP_SERVER_NAME_RE`): a name can never carry a sentence. */
const SERVER_NAME = /^[a-z0-9][a-z0-9_-]{0,62}$/u;
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const count = (v: unknown): number => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0);

/** The summary as crew answered it, checked; `null` when it is not one. */
export function readKnowledgeSummary(raw: unknown, projectId: string): KnowledgeSummary | null {
  if (!isObj(raw) || raw['projectId'] !== projectId || !Array.isArray(raw['sources'])) return null;
  const sources: KnowledgeSummary['sources'] = [];
  for (const s of raw['sources']) {
    if (!isObj(s) || typeof s['name'] !== 'string' || !SERVER_NAME.test(s['name']) || sources.some((x) => x.name === s['name'])) continue;
    sources.push({ name: s['name'], described: s['described'] === true, query: s['query'] === true, shapes: s['shapes'] === null ? null : count(s['shapes']) });
  }
  const m = raw['memories'];
  const memories = isObj(m) ? { project: count(m['project']), shared: count(m['shared']) } : null;
  const st = raw['steering'];
  let steering: KnowledgeSummary['steering'] = null;
  if (isObj(st) && isObj(st['byType'])) {
    const byType: Partial<Record<SteeringTypeName, number>> = {};
    let total = 0;
    for (const t of STEERING_TYPES) {
      const n = count((st['byType'] as Record<string, unknown>)[t]);
      if (n > 0) {
        byType[t] = n;
        total += n;
      }
    }
    steering = { total, byType };
  }
  return { projectId, sources, memories, steering };
}

/** `GET /knowledge/summary?project=<id>`; `null` when crew has none (an older crew, a refusal, no plane). */
export async function fetchKnowledgeSummary(projectId: string): Promise<KnowledgeSummary | null> {
  try {
    return readKnowledgeSummary(await apiFetch<unknown>(`/knowledge/summary?project=${encodeURIComponent(projectId)}`), projectId);
  } catch {
    return null;
  }
}
