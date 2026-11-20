import { apiFetch } from '../../api/client.js';
import { ApiError } from '../../api/errors.js';
import type { AppAction, AppActionCard, AppActionCardValue, AppActionPrepareResponse, AppActionRunResponse, AppCell, AppOutputColumn, AppQueryResponse, AppSpec, AppValue, AppsCapabilities } from '../../api/types.js';

/**
 * THE DATA SEAM (DES-APPS-001 §7.2-§7.3; slice K4). Every live value an app shows, and every write it asks for, goes
 * through ONE {@link AppDataPort}, picked once by {@link appDataFor}:
 *
 *  - {@link crewAppData}: crew's routes. `POST /api/v1/apps/:app/query {version, query, params}` (api-types 0.173.0
 *    `AppQueryBody` / `AppQueryResponse`), `POST …/actions/:id/prepare {version, params}` → `{record, card, expiresAt}`
 *    and `POST …/actions/:id/run {record}` → `{state, reason?}` (DES §7.3). Chosen when crew's health says it runs them:
 *    `capabilities.apps.query` / `capabilities.apps.actions`.
 *  - {@link sampleAppData}: the stub. Rows for the declared columns (the sample's own rows when it has them), a card
 *    drawn locally from the action's declaration and labelled a sample, and a run that writes nothing but the
 *    sample's rows in this tab.
 *
 * Crew's prepare/run responses use the published wire contract. {@link parseCard} validates the whole
 * {@link AppActionCard} before mapping it into the host's display rows; an incomplete card offers no action.
 */

export interface AppRows { columns: AppOutputColumn[]; rows: AppCell[][]; truncated: boolean; hasMore: boolean; ms: number; cachedAt: number | null; sample: boolean }
export type DataError = { error: 'refused' | 'unavailable' | 'rate_limited' | 'not_granted'; message: string };

/** One line of the card: what it is, its value as text, and where the value comes from. */
export interface CardRow { label: string; value: string; from: string | null }
/** The host's display of a resolved operation, mapped from crew's published card (DES §7.3). */
export interface ActionCard {
  action: string;
  kind: 'api' | 'row-write';
  /** `support-pg-writer (postgres)` / `finance-api (rest)`. */
  source: string;
  /** `UPDATE support.tickets` / `POST /refunds/{id}/approve`. */
  operation: string;
  /** Every argument or column, literals included. */
  rows: CardRow[];
  /** A row write's key (`id = 4821`) and its promise (`exactly 1 row, verified`). */
  key: string | null;
  checks: string | null;
  /** The request or statement exactly as it will be sent. */
  request: string;
  /** The action's own description, shown as "The app says". */
  says: string | null;
  /** True when the stub drew it: the host says so on the card. */
  sample: boolean;
}
export interface PreparedAction { record: string; card: ActionCard; expiresAt: number }
export interface ActionOutcome { state: 'succeeded' | 'failed' | 'unknown'; reason: string | null; sample: boolean }

export interface Viewer { email: string | null; sample: boolean }

export interface AppDataPort {
  /** Where rows come from and where actions go: each half is `crew` (live) or `sample` (the stub), said on screen. */
  readonly kind: { queries: 'crew' | 'sample'; actions: 'crew' | 'sample' };
  query(version: number, query: string, params: Record<string, unknown>): Promise<AppRows | DataError>;
  prepare(version: number, action: string, params: Record<string, unknown>): Promise<PreparedAction | DataError>;
  run(action: string, record: string): Promise<ActionOutcome>;
  viewer(): Viewer;
}

/**
 * The seam's one choice. `caps` is `GET /health` `capabilities.apps` (absent on a daemon without the app store).
 * Live actions need live rows too: an action is never offered against a made-up row (a sample id would become a real
 * write target). So `query` on alone gives live rows and sample actions; `actions` on alone gives samples for both.
 */
export function appDataFor(caps: AppsCapabilities | undefined, slug: string | null, sample: () => AppDataPort): AppDataPort {
  const liveQuery = slug !== null && caps?.query === true;
  const liveActions = liveQuery && caps?.actions === true;
  if (!liveQuery) return sample();
  const crew = crewAppData(slug!);
  if (liveActions) return crew;
  const stub = sample();
  return { kind: { queries: 'crew', actions: 'sample' }, query: crew.query, prepare: stub.prepare, run: stub.run, viewer: stub.viewer };
}

// ── crew (the live path) ────────────────────────────────────────────────────────────────────

const line = (v: unknown, max: number): string | null => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/gu, ' ').slice(0, max) : null);

/** The most a card may hold: above the published limits (a GraphQL mutation is 16 KB, 50 arguments, 200 columns),
 *  so a valid card always fits, and an oversized one is refused rather than cropped. */
export const CARD_LIMITS = { request: 64_000, value: 16_000, label: 200, rows: 260, line: 1_000 } as const;

/**
 * Crew's published card, read WHOLE or not at all: a missing, mistyped or oversized field refuses the action.
 * The host shows every resolved value. Control characters are shown as spaces, as on the other host cards.
 */
export function parseCard(raw: unknown, action: string): ActionCard | null {
  const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
  const required = (v: unknown, max: number = CARD_LIMITS.line): v is string => str(v, max) && v !== '';
  const scalar = (v: unknown): v is string | number | boolean => typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v));
  const valueText = (v: AppActionCardValue['value']): string => Array.isArray(v) ? v.join(', ') : String(v);
  const values = (v: unknown): v is AppActionCardValue[] => Array.isArray(v) && v.length <= CARD_LIMITS.rows && v.every((r: unknown) => {
    if (typeof r !== 'object' || r === null) return false;
    const o = r as Record<string, unknown>;
    const val = o['value'];
    return required(o['name'], CARD_LIMITS.label) && str(o['label'], CARD_LIMITS.label)
      && ['param', 'app', 'viewer', 'crew'].includes(o['from'] as string)
      && (val === null || scalar(val) || (Array.isArray(val) && val.every(scalar)))
      && valueText(val as AppActionCardValue['value']).length <= CARD_LIMITS.value;
  });
  const published = (v: unknown): v is AppActionCard => {
    if (typeof v !== 'object' || v === null) return false;
    const c = v as Record<string, unknown>;
    if (!required(c['app']) || !required(c['action']) || c['action'] !== action || !required(c['source'])
      || (c['appSays'] !== undefined && !str(c['appSays'], CARD_LIMITS.line))) return false;
    if (c['kind'] === 'api') return required(c['sourceKind']) && required(c['operation']) && values(c['args']) && required(c['request'], CARD_LIMITS.request);
    return c['kind'] === 'row-write' && required(c['login']) && ['INSERT', 'UPDATE', 'DELETE'].includes(c['verb'] as string)
      && required(c['table']) && values(c['columns']) && c['columns'].length + 1 <= CARD_LIMITS.rows && values(c['key'])
      && required(c['rows']) && required(c['checks']) && required(c['statement'], CARD_LIMITS.request);
  };
  if (!published(raw)) return null;
  const text = (v: string): string => v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ');
  const row = (v: AppActionCardValue): CardRow => ({ label: line(v.name, CARD_LIMITS.label)!, value: text(valueText(v.value)), from: line(v.label, CARD_LIMITS.label)! });
  const source = raw.kind === 'api' ? `${raw.source} (${raw.sourceKind})` : raw.source;
  const operation = raw.kind === 'api' ? raw.operation : `${raw.verb} ${raw.table}`;
  // An insert has no key (crew sends `key: []`): no Row line rather than an empty one.
  const key = raw.kind === 'api' || raw.key.length === 0 ? null : raw.key.map((v) => `${v.name} = ${valueText(v.value)}`).join(' and ');
  const checks = raw.kind === 'api' ? null : `${raw.rows}. ${raw.checks}`;
  // Combined display fields must fit too: never crop away any part of a resolved operation.
  if (!str(source, CARD_LIMITS.line) || !str(operation, CARD_LIMITS.line)
    || (key !== null && !str(key, CARD_LIMITS.line)) || (checks !== null && !str(checks, CARD_LIMITS.line))) return null;
  return {
    action: raw.action, kind: raw.kind, source: line(source, CARD_LIMITS.line)!, operation: line(operation, CARD_LIMITS.line)!,
    rows: raw.kind === 'api' ? raw.args.map(row) : [{ label: 'Runs as', value: line(raw.login, CARD_LIMITS.line)!, from: null }, ...raw.columns.map(row)],
    key: key === null ? null : line(key, CARD_LIMITS.line), checks: checks === null ? null : text(checks),
    request: text(raw.kind === 'api' ? raw.request : raw.statement), says: raw.appSays === undefined ? null : text(raw.appSays), sample: false,
  };
}

function dataError(e: unknown): DataError {
  if (e instanceof ApiError) {
    const code = (e.body as { code?: unknown } | undefined)?.code;
    const message = e.message;
    if (e.status === 429) return { error: 'rate_limited', message };
    if (e.status === 403 || e.status === 404 || e.status === 409 || e.status === 422) return { error: 'refused', message: typeof code === 'string' ? `${message} (${code})` : message };
    return { error: 'unavailable', message };
  }
  return { error: 'unavailable', message: e instanceof Error ? e.message : String(e) };
}

export function crewAppData(slug: string): AppDataPort {
  const base = `/apps/${encodeURIComponent(slug)}`;
  return {
    kind: { queries: 'crew', actions: 'crew' },
    async query(version, query, params) {
      try {
        const r = await apiFetch<AppQueryResponse>(`${base}/query`, { method: 'POST', body: JSON.stringify({ version, query, params }) });
        return { ...r, sample: false };
      } catch (e) { return dataError(e); }
    },
    async prepare(version, action, params) {
      try {
        const r = await apiFetch<AppActionPrepareResponse>(`${base}/actions/${encodeURIComponent(action)}/prepare`, { method: 'POST', body: JSON.stringify({ version, params }) });
        const card = parseCard(r.card, action);
        if (typeof r.record !== 'string' || r.record === '' || card === null || typeof r.expiresAt !== 'number') return { error: 'unavailable', message: 'crew answered without a card studio can show; nothing was run' };
        return { record: r.record, card, expiresAt: r.expiresAt };
      } catch (e) { return dataError(e); }
    },
    async run(action, record) {
      try {
        const r = await apiFetch<AppActionRunResponse>(`${base}/actions/${encodeURIComponent(action)}/run`, { method: 'POST', body: JSON.stringify({ record }) });
        const state = r.state === 'succeeded' || r.state === 'failed' ? r.state : 'unknown';
        return { state, reason: line(r.reason, 400), sample: false };
      } catch (e) {
        // crew refusing the run (a 4xx: an expired, replayed or revoked record, a source that changed) happens before
        // the record moves to `running`, so nothing ran. Anything else — the answer lost, a 5xx — may have written:
        // never "failed", always "not known" (§7.3 `unknown`).
        if (e instanceof ApiError && e.status >= 400 && e.status < 500) return { state: 'failed', reason: e.message, sample: false };
        return { state: 'unknown', reason: e instanceof Error ? e.message : String(e), sample: false };
      }
    },
    viewer: () => ({ email: null, sample: false }),
  };
}

// ── the stub ────────────────────────────────────────────────────────────────────────────────

export interface SampleData { rows: Record<string, AppCell[][]>; viewer: string | null }

const valueText = (v: unknown): string => (v === null || v === undefined ? 'null' : typeof v === 'string' ? v : JSON.stringify(v));

function sampleCell(col: AppOutputColumn, i: number): AppCell {
  switch (col.type) {
    case 'number': return Math.round((i + 1) * 13.7 * 10) / 10;
    case 'integer': return (i + 1) * 7;
    case 'boolean': return i % 2 === 0;
    case 'date': return `2026-10-${String(10 + i).padStart(2, '0')}`;
    case 'datetime': return `2026-10-${String(10 + i).padStart(2, '0')}T09:30:00Z`;
    default: return `${col.name.replace(/_/g, ' ')} ${i + 1}`;
  }
}

/**
 * The stub port: the sample's rows for each query id it holds (else three made-up rows of the declared columns),
 * search/filter parameters applied as a plain substring match so a filter visibly works, and a card built here from
 * the action's own declaration. Nothing leaves the tab.
 */
export function sampleAppData(spec: () => AppSpec, data: SampleData | null): AppDataPort {
  // A null-prototype map: a query named `constructor` or `toString` is just a query.
  const rows: Record<string, AppCell[][]> = Object.assign(Object.create(null) as Record<string, AppCell[][]>, structuredClone(data?.rows ?? {}));
  const viewer = data?.viewer ?? null;
  const signedIn = viewer ?? 'you';
  const prepared = new Map<string, { action: AppAction; params: Record<string, unknown>; expiresAt: number }>();
  let seq = 0;
  const valueOf = (v: AppValue, params: Record<string, unknown>): { value: unknown; from: string } => {
    if (v.kind === 'param') return { value: params[v.name] ?? null, from: 'from the app' };
    if (v.kind === 'literal') return { value: v.value, from: 'fixed by the app' };
    if (v.kind === 'viewer') return { value: v.claim === 'name' ? signedIn.split('@')[0] : signedIn, from: 'your sign-in' };
    return { value: v.value === 'now' ? new Date().toISOString() : 'a new uuid', from: `filled by studio: ${v.value}` };
  };
  return {
    kind: { queries: 'sample', actions: 'sample' },
    async query(_version, query, params) {
      const q = spec().queries.find((x) => x.id === query);
      if (q === undefined) return { error: 'refused', message: `this version has no query ${query}` };
      // Made-up rows are kept once made, so a sample action's change shows when the app reads them again.
      if (!Object.hasOwn(rows, query)) rows[query] = [0, 1, 2].map((i) => q.output.map((c) => sampleCell(c, i)));
      let out = rows[query]!;
      const needles = Object.values(params).filter((v): v is string => typeof v === 'string' && v.trim() !== '' && v !== 'all');
      if (needles.length > 0) out = out.filter((r) => needles.every((n) => r.some((cell) => typeof cell === 'string' && cell.toLowerCase().includes(n.toLowerCase()))));
      return { columns: q.output, rows: structuredClone(out), truncated: false, hasMore: false, ms: 1, cachedAt: null, sample: true };
    },
    async prepare(_version, actionId, params) {
      const a = spec().actions.find((x) => x.id === actionId);
      if (a === undefined) return { error: 'refused', message: `this version has no action ${actionId}` };
      const rowsOf: CardRow[] = [];
      let operation: string;
      let request: string;
      let key: string | null = null;
      let checks: string | null = null;
      if (a.kind === 'row-write') {
        const set = Object.entries(a.set ?? {});
        for (const [col, v] of set) { const r = valueOf(v, params); rowsOf.push({ label: col, value: valueText(r.value), from: r.from }); }
        const keys = Object.entries(a.key).map(([col, v]) => `${col} = ${valueText(params[v.name])}`);
        key = `${keys.join(', ')} (exactly 1 row)`;
        checks = 'Sample: no table was checked. A real run checks a plain table (no triggers, rules, inheritance or row security) just before it writes.';
        operation = `${a.op.toUpperCase()} ${a.table}`;
        const n = set.length;
        request = a.op === 'update'
          ? `UPDATE ONLY ${a.table} AS w SET ${set.map(([c], i) => `${c} = $${i + 1}`).join(', ')} WHERE ${Object.keys(a.key).map((c, i) => `w.${c} = $${n + i + 1}`).join(' AND ')}`
          : a.op === 'delete' ? `DELETE FROM ONLY ${a.table} AS w WHERE ${Object.keys(a.key).map((c, i) => `w.${c} = $${i + 1}`).join(' AND ')}`
            : `INSERT INTO ${a.table} (${set.map(([c]) => c).join(', ')}) VALUES (${set.map((_, i) => `$${i + 1}`).join(', ')})`;
      } else {
        for (const [arg, v] of Object.entries(a.args)) { const r = valueOf(v, params); rowsOf.push({ label: arg, value: valueText(r.value), from: r.from }); }
        operation = a.call.kind === 'tool' ? a.call.tool : `mutation ${a.call.mutation.slice(0, 60)}`;
        request = `${operation}\n${JSON.stringify(Object.fromEntries(rowsOf.map((r) => [r.label, r.value])), null, 1)}`;
      }
      seq += 1;
      const record = `sample-${seq}`;
      const expiresAt = Date.now() + 120_000;
      prepared.set(record, { action: a, params, expiresAt });
      return {
        record, expiresAt,
        card: { action: a.id, kind: a.kind, source: `${a.source} (sample)`, operation, rows: rowsOf, key, checks, request, says: a.description ?? null, sample: true },
      };
    },
    async run(actionId, record) {
      const p = prepared.get(record);
      prepared.delete(record);
      if (p === undefined || p.action.id !== actionId) return { state: 'failed', reason: 'this card was not prepared here', sample: true };
      if (Date.now() > p.expiresAt) return { state: 'failed', reason: 'the card expired; nothing was written', sample: true };
      // The sample's own rows take an update, so the table visibly changes; no source exists to touch.
      if (p.action.kind === 'row-write' && p.action.op === 'update') {
        const a = p.action;
        for (const q of spec().queries) {
          const cols = q.output.map((c) => c.name);
          const keyCols = Object.entries(a.key);
          const table = Object.hasOwn(rows, q.id) ? rows[q.id] : undefined;
          if (table === undefined || !keyCols.every(([k]) => cols.includes(k))) continue;
          for (const r of table) {
            if (!keyCols.every(([k, v]) => valueText(r[cols.indexOf(k)]) === valueText(p.params[v.name]))) continue;
            for (const [col, v] of Object.entries(a.set ?? {})) if (cols.includes(col)) r[cols.indexOf(col)] = valueOf(v, p.params).value as AppCell;
          }
        }
      }
      const changed = p.action.kind === 'row-write' && p.action.op === 'update';
      return { state: 'succeeded', reason: changed ? 'Sample data: the sample rows in this tab changed; no source was touched' : 'Sample data: nothing was written and no rows changed', sample: true };
    },
    viewer: () => ({ email: viewer, sample: true }),
  };
}
