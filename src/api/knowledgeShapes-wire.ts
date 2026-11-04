/**
 * Data shapes and the Knowledge map (DES-KNOWLEDGE-DATA-001 §10, §19 B4): the wire of `POST /sources/:name/profile`
 * and `GET /knowledge/map`, and the `payload.shape` record a data-shape proposal carries.
 *
 * A VERBATIM mirror of the contract block in `wicked-crew-api-types` 0.186.0 while studio's pin lags it (it is not
 * published yet), so `src/api/knowledgeShapes.ts` reads every answer defensively and never trusts these shapes to
 * hold.
 *
 * TODO(api-types >= 0.186.0): once studio pins `wicked-crew-api-types` 0.186.0 or later, these become re-exports
 * from the package, and this mirror goes.
 */

/**
 * (api-types 0.186.0, DES-KNOWLEDGE-DATA-001 §10.2) One column of a value-free profile: bands, never a value.
 * `nullPct` is the null fraction to the nearest 5 % (`null` for an empty relation); `hasNulls` says a few nulls
 * the band rounded to 0 are there.
 */
export interface SourceProfileColumn {
  name: string;
  type: string;
  nullPct: number | null;
  hasNulls: boolean;
  cardinality: 'none' | 'single' | 'low' | 'high' | 'unique' | 'unknown';
  keyCandidate: boolean;
}

/** (api-types 0.186.0) A relation's value-free profile; `rows` is an order-of-magnitude band, `null` when it was not read (`error` = a class). */
export interface SourceProfileRelation {
  /** `schema.table`, the catalog document's key. */
  key: string;
  rows: '0' | '1-99' | '100-9,999' | '10,000-999,999' | '1,000,000+' | null;
  columns: SourceProfileColumn[];
  error: string | null;
  /** Columns not profiled (more than the profiler reads per relation). */
  columnsNotListed?: number;
}

/** (api-types 0.186.0) A join the profiler found: a declared foreign key, or a name-and-type match the overlap band confirmed. */
export interface SourceProfileJoin {
  from: string;
  columns: string[];
  to: string;
  references: string[];
  basis: 'fk' | 'name_type';
  /** How many of the referencing side's distinct values the other side holds (one-column joins); measured at the source. */
  overlap: 'empty' | 'none' | 'some' | 'most' | 'all' | null;
}

/**
 * (api-types 0.186.0) `POST /sources/:name/profile`, a human operator's only (403 `profile_human_only`). The
 * value-free profile of a described native Postgres source, through the data gate's person read, and the data shapes
 * it filed as `knowledge` proposals for the review (one per relation; an identical shape already in the queue is not
 * filed again). 409 `not_in_knowledge`: estate holds no structure for the source yet.
 */
export interface SourceProfileResponse {
  name: string;
  /** The registry id. */
  sourceId: string;
  profiledAt: string;
  relations: SourceProfileRelation[];
  joins: SourceProfileJoin[];
  /** Code entities named exactly like a relation, in the repos' code graphs. */
  describes: Array<{ relation: string; repo: string; name: string; kind: string; file: string }>;
  proposed: Array<{ id: string; relation: string }>;
  alreadyProposed: number;
  codeSearch: { searched: string[]; notSearched: string[] };
  /** Catalog documents estate holds that crew's own catalog does not (or a view not allowed): not profiled. */
  notInKnowledge?: number;
  /** Relations beyond what one profile reads (too many): not profiled. */
  notListed?: number;
  /** Estate holds more catalog pages than one read takes: the rest were not profiled. */
  catalogTruncated?: true;
}

/**
 * (api-types 0.186.0) The crew-owned record a data-shape proposal carries in `payload.shape` (a `knowledge`
 * proposal filed by the profiler). The review shows it; estate stores it as given.
 */
export interface KnowledgeShapeRecord {
  format: 1;
  sourceId: string;
  source: string;
  relation: string;
  profile: SourceProfileRelation;
  joins: SourceProfileJoin[];
  describes: Array<{ repo: string; symbolId: string; name: string; kind: string; file: string }>;
}

/** (api-types 0.186.0) A node of the Knowledge map. `key` is `<store>:<id>` (`source:`, `repo:`, `knowledge:`, `estate:`). */
export interface KnowledgeMapNode {
  key: string;
  kind: 'source' | 'table' | 'shape' | 'code' | 'repo' | 'knowledge';
  label: string;
  /** A table's source name. */
  source?: string;
  /** A code entity's repo id. */
  repo?: string;
  /** A shape's proposal id. */
  proposalId?: string;
  /** A shape's value-free summary. */
  summary?: string;
}

/**
 * (api-types 0.186.0) A typed edge of the Knowledge map (`describes`, `joins`, `governed_by`, `derived_from`, …;
 * `contains` is drawn structure). A `joins` edge's evidence is `{basis, on: [{columns, references, basis, overlap?,
 * cut?}], more?}`: every condition between the two tables, held under estate's 1 KiB evidence bound.
 */
export interface KnowledgeMapEdge {
  rel: string;
  from: string;
  to: string;
  confidence: number | null;
  evidence: Record<string, unknown> | null;
  /** The node of the shape that asserts it (`kconcept synthetic proposal:<id>:`, estate's id); `null` for drawn structure. */
  owner: string | null;
}

/**
 * (api-types 0.186.0) `GET /knowledge/map`, a human operator's only. The source catalogs and the APPROVED data shapes
 * estate holds live, with their typed edges; a pending or declined shape is never in it. Every source and repo is in
 * the read's visible set; a repo is drawn when a shape links into it. A catalog estate replaced while it was read is
 * left out with a note, never drawn half.
 */
export interface KnowledgeMapResponse {
  nodes: KnowledgeMapNode[];
  edges: KnowledgeMapEdge[];
  sources: Array<{ id: string; name: string; described: boolean; inKnowledge: boolean; tables: number }>;
  shapes: number;
  /** Approved shapes estate no longer holds, or hides. */
  skipped: number;
  truncated: boolean;
  notes: string[];
}
