/**
 * Data shapes and the Knowledge map (DES-KNOWLEDGE-DATA-001 §10): crew's `POST /sources/:name/profile` (a person
 * profiles a source; crew files its data shapes for review) and `GET /knowledge/map` (the approved shapes and the
 * source catalogs, for Understand's Knowledge view). Both are a human operator's only.
 *
 * The wire is mirrored in `knowledgeShapes-wire.ts` (api-types 0.186.0 is not published yet), so every answer is read
 * defensively here: a field of the wrong shape is dropped, never trusted.
 */

import { apiFetch } from './client.js';
import type { Proposal } from './proposals.js';
import type { KnowledgeMapEdge, KnowledgeMapNode, KnowledgeMapResponse, KnowledgeShapeRecord, SourceProfileJoin, SourceProfileResponse } from './knowledgeShapes-wire.js';

export type { KnowledgeMapEdge, KnowledgeMapNode, KnowledgeMapResponse, KnowledgeShapeRecord, SourceProfileJoin, SourceProfileResponse };

/** Understand's Knowledge view (the review of data shapes and the map). */
export const KNOWLEDGE_VIEW_PATH = '/understand?view=knowledge';

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

const NODE_KINDS = new Set(['source', 'table', 'shape', 'code', 'repo', 'knowledge']);

/** The map as crew answered it, every node and edge checked; one of the wrong shape is dropped. */
export function readKnowledgeMap(raw: unknown): KnowledgeMapResponse {
  const r = isObj(raw) ? raw : {};
  const nodes: KnowledgeMapNode[] = (Array.isArray(r['nodes']) ? r['nodes'] : []).flatMap((n): KnowledgeMapNode[] => {
    if (!isObj(n)) return [];
    const key = str(n['key']);
    const kind = str(n['kind']);
    const label = str(n['label']);
    if (key === null || kind === null || !NODE_KINDS.has(kind) || label === null) return [];
    return [{
      key,
      kind: kind as KnowledgeMapNode['kind'],
      label,
      ...(str(n['source']) !== null ? { source: str(n['source'])! } : {}),
      ...(str(n['repo']) !== null ? { repo: str(n['repo'])! } : {}),
      ...(str(n['proposalId']) !== null ? { proposalId: str(n['proposalId'])! } : {}),
      ...(str(n['summary']) !== null ? { summary: str(n['summary'])! } : {}),
    }];
  });
  const keys = new Set(nodes.map((n) => n.key));
  const edges: KnowledgeMapEdge[] = (Array.isArray(r['edges']) ? r['edges'] : []).flatMap((e): KnowledgeMapEdge[] => {
    if (!isObj(e)) return [];
    const rel = str(e['rel']);
    const from = str(e['from']);
    const to = str(e['to']);
    if (rel === null || from === null || to === null || !keys.has(from) || !keys.has(to)) return [];
    return [{ rel, from, to, confidence: typeof e['confidence'] === 'number' ? e['confidence'] : null, evidence: isObj(e['evidence']) ? e['evidence'] : null, owner: str(e['owner']) }];
  });
  const sources = (Array.isArray(r['sources']) ? r['sources'] : []).flatMap((s): KnowledgeMapResponse['sources'] => {
    if (!isObj(s) || str(s['id']) === null || str(s['name']) === null) return [];
    return [{ id: str(s['id'])!, name: str(s['name'])!, described: s['described'] === true, inKnowledge: s['inKnowledge'] === true, tables: typeof s['tables'] === 'number' ? s['tables'] : 0 }];
  });
  return {
    nodes,
    edges,
    sources,
    shapes: typeof r['shapes'] === 'number' ? r['shapes'] : nodes.filter((n) => n.kind === 'shape').length,
    skipped: typeof r['skipped'] === 'number' ? r['skipped'] : 0,
    truncated: r['truncated'] === true,
    notes: strs(r['notes']),
  };
}

export async function getKnowledgeMap(): Promise<KnowledgeMapResponse> {
  return readKnowledgeMap(await apiFetch<unknown>('/knowledge/map'));
}

export function profileSource(name: string): Promise<SourceProfileResponse> {
  return apiFetch<SourceProfileResponse>(`/sources/${encodeURIComponent(name)}/profile`, { method: 'POST' });
}

/** A data-shape proposal's crew record (`payload.shape`), or `null` when it carries none (a garden-proposed shape). */
export function shapeRecordOf(p: Proposal): KnowledgeShapeRecord | null {
  const payload = (p as { payload?: unknown }).payload;
  if (!isObj(payload) || !isObj(payload['shape'])) return null;
  const s = payload['shape'];
  if (str(s['relation']) === null || str(s['source']) === null) return null;
  return s as unknown as KnowledgeShapeRecord;
}

/** What a knowledge proposal says, for its card: its content, the relation it is about, and its typed links in words. */
export function knowledgePayload(p: Proposal): { content: string | null; relation: string | null; source: string | null; links: Array<{ rel: string; text: string }> } {
  const payload = (p as { payload?: unknown }).payload;
  const pl = isObj(payload) ? payload : {};
  const rec = shapeRecordOf(p);
  const links: Array<{ rel: string; text: string }> = [];
  if (rec !== null) {
    for (const j of Array.isArray(rec.joins) ? rec.joins : []) {
      if (!isObj(j)) continue;
      const basis = j['basis'] === 'fk' ? 'a foreign key' : 'matching name and type';
      const overlap = str(j['overlap']);
      links.push({ rel: 'joins', text: `joins ${String(j['to'])} on ${strs(j['columns']).join(', ')} = ${strs(j['references']).join(', ')} (${basis}${overlap !== null ? `; ${overlap === 'all' ? 'every value matches' : overlap === 'most' ? 'most values match' : `${overlap} match`}` : ''})` });
    }
    for (const d of Array.isArray(rec.describes) ? rec.describes : []) {
      if (!isObj(d)) continue;
      links.push({ rel: 'describes', text: `describes ${String(d['name'])} (${String(d['kind'])}) in ${String(d['repo'])}` });
    }
  } else {
    // A shape proposed by an agent (garden's data skill): its links, named by their own words.
    for (const l of [...(Array.isArray(pl['relate']) ? pl['relate'] : []), ...(Array.isArray(pl['relate_code']) ? pl['relate_code'] : [])]) {
      if (!isObj(l) || str(l['rel']) === null || l['rel'] === 'derived_from') continue;
      const target = str(l['code_id']) ?? str(l['to']) ?? '';
      const ev = isObj(l['evidence']) ? str(l['evidence']['label']) ?? str(l['evidence']['name']) : null;
      links.push({ rel: str(l['rel'])!, text: `${str(l['rel'])!.replace('_', ' ')} ${ev ?? target.split(/[/#:]/).filter((x) => x !== '').pop() ?? target}${str(l['repo']) !== null ? ` in ${str(l['repo'])!}` : ''}` });
    }
  }
  return { content: str(pl['content']), relation: rec?.relation ?? null, source: rec?.source ?? null, links };
}
