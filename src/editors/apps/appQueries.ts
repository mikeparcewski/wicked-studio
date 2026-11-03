import { apiFetch } from '../../api/client.js';
import type { AppComponent, AppOutputColumn, AppQuery, AppSpec, SourceCatalogRelation, SourceCheckResponse } from '../../api/types.js';
import { applyOps, componentWords } from './appOps.js';

/**
 * THE DATA PANEL'S MODEL (DES-APPS-001 §6.1, §7.2; operator 2026-11-04: "How do I edit the data sources for an app?").
 * Pure functions over an app's spec and query texts, plus the three crew calls the panel makes:
 *
 *  - `POST /sources/:name/check {text}`: crew's read policy, then a prepare/describe at the source. NOTHING RUNS. It
 *    answers the columns the text returns, which become the query's declared output (crew's source stage then checks
 *    exactly that at landing: names, count and, for Postgres, types);
 *  - `GET /sources/:name/catalog`: a source's tables and columns (structure only), for "Add data";
 *  - `POST /sources/:name/ask {question}` (crew#1305, human operator only): a seat drafts one read from the structure,
 *    crew checks it, nothing runs. The person sees the SQL first and saves it through the same check.
 *
 * Saving is never here: the host lands `{spec, query-text}` as ONE version through crew's staged check
 * (`AppSession.landDirect`), and a refusal is crew's findings, shown as they are.
 */

/** A query as the panel lists it. */
export interface QueryRow {
  id: string;
  source: string;
  kind: AppQuery['kind'];
  /** Its text at head (`null`: the store holds none, e.g. a sample query). */
  text: string | null;
  params: Array<{ name: string; type: string; required: boolean }>;
  output: AppOutputColumn[];
  /** The components that read it, in the spec's words. */
  usedBy: Array<{ id: string; words: string }>;
}

function components(spec: AppSpec): AppComponent[] { return spec.pages.flatMap((p) => p.components); }

/** The query a component reads, if any (a table, chart or KPI's `data`; a filter's options). */
function readsOf(c: AppComponent): string[] {
  const out: string[] = [];
  if ('data' in c && c.data !== undefined) out.push((c.data as { query: string }).query);
  if (c.type === 'filter' && c.options?.kind === 'query') out.push(c.options.query.query);
  return out;
}

export function queryRows(spec: AppSpec, queryText: Readonly<Record<string, string>>): QueryRow[] {
  return spec.queries.map((q) => {
    const props = q.params?.properties ?? {};
    const required = new Set(q.params?.required ?? []);
    return {
      id: q.id,
      source: q.source,
      kind: q.kind,
      text: Object.hasOwn(queryText, q.id) ? queryText[q.id]! : null,
      params: Object.entries(props).map(([name, p]) => ({ name, type: p.type, required: required.has(name) })),
      output: q.output,
      usedBy: components(spec).filter((c) => readsOf(c).includes(q.id)).map((c) => ({ id: c.id, words: componentWords(spec, c.id) ?? c.id })),
    };
  });
}

/**
 * The declared type a source column carries, by crew's own fit rules (`apps/exec/source-stage.ts` `outputTypeFits`):
 * Postgres integral types are `integer`, the other numbers `number`, `boolean`, `date`, the two timestamps `datetime`,
 * and anything else `string` (rendered as text, which every column fits). MySQL and SQLite type names map the same way
 * where they say so plainly; crew types those loosely, so `string` is never wrong.
 */
export function outputTypeOf(sourceType: string): AppOutputColumn['type'] {
  const t = sourceType.toLowerCase().replace(/\(.*\)$/u, '').trim();
  if (['smallint', 'integer', 'bigint', 'int', 'int2', 'int4', 'int8', 'tinyint', 'mediumint'].includes(t)) return 'integer';
  if (['numeric', 'real', 'double precision', 'decimal', 'float', 'double', 'float4', 'float8'].includes(t)) return 'number';
  if (t === 'boolean' || t === 'bool') return 'boolean';
  if (t === 'date') return 'date';
  if (t === 'timestamp without time zone' || t === 'timestamp with time zone' || t === 'timestamp' || t === 'timestamptz' || t === 'datetime') return 'datetime';
  return 'string';
}

/** The declared output for the columns crew's check described (at most 200, as crew's schema allows). */
export function outputOf(columns: ReadonlyArray<{ name: string; type: string }>): AppOutputColumn[] {
  return columns.slice(0, 200).map((c) => ({ name: c.name, type: outputTypeOf(c.type) }));
}

/** A column a component names, and where (for "column gone"). */
export interface ColumnUse { id: string; words: string; column: string }

/** Every column a component of `spec` names from `queryId`'s rows: crew's spec check (`unknown_column`) lists the same. */
export function columnUses(spec: AppSpec, queryId: string): ColumnUse[] {
  const out: ColumnUse[] = [];
  for (const c of components(spec)) {
    const words = componentWords(spec, c.id) ?? c.id;
    const note = (column: string | undefined): void => { if (typeof column === 'string' && column !== '') out.push({ id: c.id, words, column }); };
    if ('data' in c && c.data !== undefined && (c.data as { query: string }).query === queryId) {
      if (c.type === 'table') {
        for (const tc of c.columns ?? []) note(tc.column);
        for (const ra of c.rowActions ?? []) for (const ref of Object.values(ra.params ?? {})) if (typeof ref === 'string' && ref.startsWith('row.')) note(ref.slice(4));
      }
      if (c.type === 'chart') { note(c.x); for (const s of c.series) note(s.column); }
      if (c.type === 'kpi') { note(c.value); note(c.delta); }
    }
    if (c.type === 'filter' && c.options?.kind === 'query' && c.options.query.query === queryId) {
      const o = c.options as unknown as Record<string, unknown>;
      for (const key of ['value', 'label']) if (typeof o[key] === 'string') note(o[key] as string);
    }
  }
  return out;
}

/** The uses whose column the new output lacks: what "Check & save" would leave without a column. */
export function columnsGone(spec: AppSpec, queryId: string, output: readonly AppOutputColumn[]): ColumnUse[] {
  const have = new Set(output.map((o) => o.name));
  return columnUses(spec, queryId).filter((u) => !have.has(u.column));
}

/** A Postgres or MySQL identifier as SQL: plain when it is plainly safe, else quoted (quotes doubled). */
export function sqlIdent(name: string, dialect: 'postgres' | 'mysql' | 'sqlite'): string {
  if (/^[a-z_][a-z0-9_]*$/u.test(name)) return name;
  return dialect === 'mysql' ? `\`${name.replace(/`/gu, '``')}\`` : `"${name.replace(/"/gu, '""')}"`;
}

/** The starter read for a table: its columns (at most 40), schema-qualified, `LIMIT 100` (crew's policy then checks it). */
export function starterSql(r: SourceCatalogRelation, dialect: 'postgres' | 'mysql' | 'sqlite'): string {
  const cols = r.columns.slice(0, 40).map((c) => sqlIdent(c.name, dialect));
  const table = r.schema !== null && r.schema !== '' ? `${sqlIdent(r.schema, dialect)}.${sqlIdent(r.name, dialect)}` : sqlIdent(r.name, dialect);
  return `SELECT ${cols.length > 0 ? cols.join(', ') : '*'}\nFROM ${table}\nLIMIT 100`;
}

/** A fresh query id from a table name (crew's id grammar: lower case, digits and `_`, a letter first). */
export function freshQueryId(spec: AppSpec, base: string): string {
  let stem = base.toLowerCase().replace(/[^a-z0-9_]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 40);
  if (!/^[a-z]/u.test(stem)) stem = `q_${stem}`.slice(0, 40);
  const taken = new Set(spec.queries.map((q) => q.id));
  if (!taken.has(stem)) return stem;
  for (let n = 2; n < 1000; n += 1) if (!taken.has(`${stem}_${n}`)) return `${stem}_${n}`;
  return `${stem}_${Date.now() % 100000}`;
}

/** The spec with one query's declaration changed (its source, its output), or a new query added. */
export function withQuery(spec: AppSpec, q: AppQuery): AppSpec {
  const next = structuredClone(spec);
  const at = next.queries.findIndex((x) => x.id === q.id);
  if (at >= 0) next.queries[at] = { ...next.queries[at]!, ...q };
  else next.queries.push(q);
  return next;
}

/** Bind `componentId` to `queryId` (crew's rules: a table takes every column; a chart and a KPI the first that fit). */
export function bindTo(spec: AppSpec, componentId: string, queryId: string): { ok: true; spec: AppSpec } | { ok: false; message: string } {
  const r = applyOps(spec, [{ op: 'bind', id: componentId, query: queryId }]);
  return r.ok ? { ok: true, spec: r.spec } : { ok: false, message: r.message };
}

/** Add a table reading `queryId` below everything on `pageId`. */
export function addTableFor(spec: AppSpec, pageId: string, queryId: string): { ok: true; spec: AppSpec; id: string } | { ok: false; message: string } {
  const page = spec.pages.find((p) => p.id === pageId) ?? spec.pages[0];
  if (page === undefined) return { ok: false, message: 'this app has no page' };
  const y = page.components.reduce((m, c) => Math.max(m, c.box.y + c.box.h), 0);
  const added = applyOps(spec, [{ op: 'component-add', page: page.id, type: 'table', box: { x: 0, y, w: 12, h: 5 } }]);
  if (!added.ok) return { ok: false, message: added.message };
  const id = added.added[0]!;
  const bound = applyOps(added.spec, [{ op: 'bind', id, query: queryId }, { op: 'component-set', id, prop: 'title', value: queryId.replace(/_/gu, ' ') }]);
  return bound.ok ? { ok: true, spec: bound.spec, id } : { ok: false, message: bound.message };
}

// ── crew's calls ────────────────────────────────────────────────────────────────────────────

const at = (name: string, rest: string): string => `/sources/${encodeURIComponent(name)}/${rest}`;

/** `POST /sources/:name/check`: the read policy and a describe; never runs the text. */
export function checkText(source: string, text: string): Promise<SourceCheckResponse> {
  return apiFetch<SourceCheckResponse>(at(source, 'check'), { method: 'POST', body: JSON.stringify({ text }) });
}

/** crew#1305's answer (api-types 0.179.0, not yet published: the fields the panel reads). */
export interface AskAnswer {
  sql: string;
  explanation: string;
  seat: string;
  check: SourceCheckResponse | null;
}

/** `POST /sources/:name/ask` (human operator only): a seat's draft, checked; nothing ran. */
export function askSource(source: string, question: string): Promise<AskAnswer> {
  return apiFetch<AskAnswer>(at(source, 'ask'), { method: 'POST', body: JSON.stringify({ question }) });
}
