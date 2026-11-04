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

const NODE_KINDS = new Set(['source', 'table', 'shape', 'code', 'repo', 'knowledge', 'tracker', 'project', 'issue', 'run', 'pr']);

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
      // (api-types 0.187.0) A tracker's source and key, only whole.
      ...(isObj(n['tracker']) && str(n['tracker']['source']) !== null && str(n['tracker']['key']) !== null ? { tracker: { source: str(n['tracker']['source'])!, key: str(n['tracker']['key'])! } } : {}),
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

/** crew answered something that is not a profile: said, never shown as an empty profile. */
export class ProfileWireError extends Error {}

const BANDS = new Set(['0', '1-99', '100-9,999', '10,000-999,999', '1,000,000+']);
const CARDS = new Set(['none', 'single', 'low', 'high', 'unique', 'unknown']);
const OVERLAPS = new Set(['empty', 'none', 'some', 'most', 'all']);

/** A profile as crew answered it, checked field by field; the lists it needs must be there, the rest is dropped. */
export function readSourceProfile(raw: unknown): SourceProfileResponse {
  const r = isObj(raw) ? raw : null;
  if (r === null || str(r['name']) === null || !Array.isArray(r['relations']) || !Array.isArray(r['proposed'])) {
    throw new ProfileWireError('crew answered the profile in a form this studio does not read: update studio or crew');
  }
  const relations = (r['relations'] as unknown[]).flatMap((x): SourceProfileResponse['relations'] => {
    if (!isObj(x) || str(x['key']) === null) return [];
    const columns = (Array.isArray(x['columns']) ? x['columns'] : []).flatMap((c): SourceProfileResponse['relations'][number]['columns'] => {
      if (!isObj(c) || str(c['name']) === null) return [];
      return [{
        name: str(c['name'])!,
        type: str(c['type']) ?? '',
        nullPct: typeof c['nullPct'] === 'number' ? c['nullPct'] : null,
        hasNulls: c['hasNulls'] === true,
        cardinality: typeof c['cardinality'] === 'string' && CARDS.has(c['cardinality']) ? (c['cardinality'] as SourceProfileResponse['relations'][number]['columns'][number]['cardinality']) : 'unknown',
        keyCandidate: c['keyCandidate'] === true,
      }];
    });
    const rows = typeof x['rows'] === 'string' && BANDS.has(x['rows']) ? (x['rows'] as SourceProfileResponse['relations'][number]['rows']) : null;
    return [{ key: str(x['key'])!, rows, columns, error: rows === null ? str(x['error']) ?? 'unreadable' : null, ...(typeof x['columnsNotListed'] === 'number' ? { columnsNotListed: x['columnsNotListed'] } : {}) }];
  });
  const joins = (Array.isArray(r['joins']) ? r['joins'] : []).flatMap((j): SourceProfileJoin[] => {
    if (!isObj(j) || str(j['from']) === null || str(j['to']) === null) return [];
    return [{ from: str(j['from'])!, to: str(j['to'])!, columns: strs(j['columns']), references: strs(j['references']), basis: j['basis'] === 'fk' ? 'fk' : 'name_type', overlap: typeof j['overlap'] === 'string' && OVERLAPS.has(j['overlap']) ? (j['overlap'] as SourceProfileJoin['overlap']) : null }];
  });
  const describes = (Array.isArray(r['describes']) ? r['describes'] : []).flatMap((d): SourceProfileResponse['describes'] => (isObj(d) && str(d['relation']) !== null && str(d['name']) !== null ? [{ relation: str(d['relation'])!, repo: str(d['repo']) ?? '', name: str(d['name'])!, kind: str(d['kind']) ?? '', file: str(d['file']) ?? '' }] : []));
  const proposed = (r['proposed'] as unknown[]).flatMap((p): SourceProfileResponse['proposed'] => (isObj(p) && str(p['id']) !== null ? [{ id: str(p['id'])!, relation: str(p['relation']) ?? '' }] : []));
  const cs = isObj(r['codeSearch']) ? r['codeSearch'] : {};
  const n = (v: unknown): number | undefined => (typeof v === 'number' && v > 0 ? v : undefined);
  return {
    name: str(r['name'])!,
    sourceId: str(r['sourceId']) ?? '',
    profiledAt: str(r['profiledAt']) ?? '',
    relations,
    joins,
    describes,
    proposed,
    alreadyProposed: typeof r['alreadyProposed'] === 'number' ? r['alreadyProposed'] : 0,
    codeSearch: { searched: strs(cs['searched']), notSearched: strs(cs['notSearched']) },
    ...(n(r['notInKnowledge']) !== undefined ? { notInKnowledge: n(r['notInKnowledge'])! } : {}),
    ...(n(r['notListed']) !== undefined ? { notListed: n(r['notListed'])! } : {}),
    ...(r['catalogTruncated'] === true ? { catalogTruncated: true as const } : {}),
  };
}

export async function profileSource(name: string): Promise<SourceProfileResponse> {
  return readSourceProfile(await apiFetch<unknown>(`/sources/${encodeURIComponent(name)}/profile`, { method: 'POST' }));
}

/**
 * What a `knowledge` proposal is (journey 2026-11-04: every one was labelled "Data shape"). A DATA SHAPE links what it
 * is about: crew's profiler and garden's shapes pass both file `relate`/`relate_code` (one of them may be empty), and
 * crew's map draws exactly the approved proposals that carry them (crew `knowledge/shapes/map.ts`), so a shape's card
 * may promise the map. Anything else is a knowledge NOTE an agent filed about a repository (`{content, class, source:
 * "<repo>:<path>", source_rev}`, no link keys at all, as the test rig holds them): the map never draws it.
 */
export function knowledgeKind(p: Proposal): 'shape' | 'note' {
  const payload = (p as { payload?: unknown }).payload;
  if (!isObj(payload)) return 'note';
  return Array.isArray(payload['relate']) || Array.isArray(payload['relate_code']) ? 'shape' : 'note';
}

/** A data-shape proposal's crew record (`payload.shape`), or `null` when it carries none (a garden-proposed shape). */
export function shapeRecordOf(p: Proposal): KnowledgeShapeRecord | null {
  const payload = (p as { payload?: unknown }).payload;
  if (!isObj(payload) || !isObj(payload['shape'])) return null;
  const s = payload['shape'];
  if (str(s['relation']) === null || str(s['source']) === null) return null;
  return { ...(s as unknown as KnowledgeShapeRecord), relation: str(s['relation'])!, source: str(s['source'])! };
}

/** What a knowledge proposal says, for its card: its content, the relation it is about, and its typed links in words. */
export function knowledgePayload(p: Proposal): { content: string | null; relation: string | null; source: string | null; links: Array<{ rel: string; text: string }> } {
  const payload = (p as { payload?: unknown }).payload;
  const pl = isObj(payload) ? payload : {};
  const rec = shapeRecordOf(p);
  const links: Array<{ rel: string; text: string }> = [];
  if (rec !== null) {
    for (const j of Array.isArray(rec.joins) ? (rec.joins as unknown[]) : []) {
      if (!isObj(j) || str(j['to']) === null) continue;
      const basis = j['basis'] === 'fk' ? 'a foreign key' : 'matching name and type';
      const overlap = str(j['overlap']);
      const self = j['to'] === rec.relation;
      links.push({ rel: 'joins', text: `joins ${self ? 'itself' : str(j['to'])!} on ${strs(j['columns']).join(', ')} = ${strs(j['references']).join(', ')} (${basis}${overlap !== null ? `; ${overlap === 'all' ? 'every value matches' : overlap === 'most' ? 'most values match' : `${overlap} match`}` : ''})` });
    }
    for (const d of Array.isArray(rec.describes) ? (rec.describes as unknown[]) : []) {
      if (!isObj(d) || str(d['name']) === null) continue;
      links.push({ rel: 'describes', text: `describes ${str(d['name'])!}${str(d['kind']) !== null ? ` (${str(d['kind'])!})` : ''}${str(d['repo']) !== null ? ` in ${str(d['repo'])!}` : ''}` });
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
