import type {
  AppAction, AppActionBinding, AppBindingRef, AppComponent, AppComponentType, AppOutputColumn, AppQuery, AppQueryBinding, AppSpec,
} from '../../api/types.js';
import { COMPONENT_ID, isSpecOp } from '../protocol.js';

/**
 * The app host's component inventory and spec ops (DES-APPS-001 §6.2, §7.1; slice K4). Pure.
 *
 * The runtime in the frame PROPOSES ops by component id; the host applies them to ITS copy of the spec at the version
 * the runtime said it was looking at, and nothing else: an op naming a component, page or query the host's inventory
 * of that version does not hold is refused, the host names new components itself, and a property is set only when it
 * is one of the few this component's type lists. The result is one whole spec, which crew checks again (422) when the
 * edit burst lands as `POST /apps/:app/edits {base, ops: [{op: 'spec', spec}]}`.
 */

export type SpecOp =
  | { op: 'component-add'; page: string; type: AppComponentType; box: { x: number; y: number; w: number; h: number } }
  | { op: 'component-move'; id: string; x: number; y: number }
  | { op: 'component-resize'; id: string; w: number; h: number }
  | { op: 'component-set'; id: string; prop: string; value: string | number | boolean | null }
  | { op: 'component-remove'; id: string }
  | { op: 'bind'; id: string; query: string };

export interface InventoryItem { id: string; page: string; type: AppComponentType; index: number }
export interface AppInventory {
  components: Map<string, InventoryItem>;
  pages: Set<string>;
  queries: Map<string, AppQuery>;
  actions: Map<string, AppAction>;
}

export function inventoryOf(spec: AppSpec): AppInventory {
  const components = new Map<string, InventoryItem>();
  for (const page of spec.pages) {
    page.components.forEach((c, index) => components.set(c.id, { id: c.id, page: page.id, type: c.type, index }));
  }
  return {
    components,
    pages: new Set(spec.pages.map((p) => p.id)),
    queries: new Map(spec.queries.map((q) => [q.id, q])),
    actions: new Map(spec.actions.map((a) => [a.id, a])),
  };
}

export type OpsResult =
  | { ok: true; spec: AppSpec; added: string[]; touched: string[] }
  | { ok: false; code: 'bad_request' | 'refused'; message: string };

const TYPE_WORDS: Record<AppComponentType, string> = {
  table: 'table', chart: 'chart', kpi: 'KPI', text: 'text', filter: 'filter', form: 'form', button: 'button', image: 'image', link: 'link',
};

/** The host's words for a component on a chip or a line: its type and title, from the spec (never the runtime's). */
export function componentWords(spec: AppSpec, id: string): string | null {
  for (const p of spec.pages) {
    const c = p.components.find((x) => x.id === id);
    if (c === undefined) continue;
    const kind = c.type === 'chart' ? `${c.chart} chart` : TYPE_WORDS[c.type];
    const title = typeof c.title === 'string' && c.title.trim() !== '' ? c.title.trim() : null;
    const short = title === null ? null : title.length > 40 ? `${title.slice(0, 39)}…` : title;
    return short === null ? `${kind} ${id}` : `${kind} “${short}”`;
  }
  return null;
}

// ── defaults for a new component ────────────────────────────────────────────────────────────

const NUMERIC = new Set(['number', 'integer']);
const firstOf = (cols: readonly AppOutputColumn[], ok: (c: AppOutputColumn) => boolean): string | undefined => cols.find(ok)?.name;

/** A 1×1 transparent PNG: a new image component's placeholder until the person picks one. */
export const PLACEHOLDER_IMAGE = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function chartColumns(q: AppQuery): { x: string; series: string } | null {
  const x = firstOf(q.output, (c) => !NUMERIC.has(c.type)) ?? q.output[0]?.name;
  const series = firstOf(q.output, (c) => NUMERIC.has(c.type) && c.name !== x);
  return x !== undefined && series !== undefined ? { x, series } : null;
}

/** The data a component of `type` would read: the first query that has the columns it needs. */
function defaultData(spec: AppSpec, type: 'table' | 'chart' | 'kpi'): { query: AppQuery; chart?: { x: string; series: string }; value?: string } | null {
  for (const q of spec.queries) {
    if (type === 'table' && q.output.length > 0) return { query: q };
    if (type === 'chart') { const c = chartColumns(q); if (c !== null) return { query: q, chart: c }; }
    if (type === 'kpi') { const v = firstOf(q.output, (c) => NUMERIC.has(c.type)); if (v !== undefined) return { query: q, value: v }; }
  }
  return null;
}

function newComponent(spec: AppSpec, id: string, type: AppComponentType, box: AppComponent['box']): AppComponent | string {
  switch (type) {
    case 'table': {
      const d = defaultData(spec, 'table');
      return d === null ? 'a table reads a query: add one first' : { id, type, box, title: d.query.id.replace(/_/g, ' '), data: { query: d.query.id } };
    }
    case 'chart': {
      const d = defaultData(spec, 'chart');
      return d?.chart === undefined ? 'a chart reads a query with a category and a number column: add one first'
        : { id, type, box, chart: 'bar', title: d.query.id.replace(/_/g, ' '), data: { query: d.query.id }, x: d.chart.x, series: [{ column: d.chart.series }] };
    }
    case 'kpi': {
      const d = defaultData(spec, 'kpi');
      return d?.value === undefined ? 'a KPI reads a query with a number column: add one first'
        : { id, type, box, title: d.query.id.replace(/_/g, ' '), data: { query: d.query.id }, value: d.value };
    }
    case 'text': return { id, type, box, text: 'Text', style: 'body' };
    case 'filter': return { id, type, box, filter: 'search', label: 'Search' };
    case 'button': {
      const a = spec.actions[0];
      return a === undefined ? 'a button runs an action: add one first' : { id, type, box, action: { label: 'Run', action: a.id } };
    }
    case 'form': {
      const a = spec.actions[0];
      return a === undefined ? 'a form submits an action: add one first'
        : { id, type, box, fields: [{ name: 'note', label: 'Note', input: 'text' }], submit: { label: 'Submit', action: a.id } };
    }
    case 'image': return { id, type, box, src: PLACEHOLDER_IMAGE, alt: 'Image' };
    case 'link': return { id, type, box, label: 'Link', to: { kind: 'page', page: spec.pages[0]!.id } };
  }
}

/** A fresh id the spec does not use: `<type><n>`, unique across the whole app (crew's rule). */
function freshId(spec: AppSpec, type: AppComponentType, taken: Set<string>): string {
  for (let n = 1; ; n += 1) {
    const id = `${type}${n}`;
    if (!taken.has(id) && !spec.pages.some((p) => p.id === id)) return id;
  }
}

// ── component-set: the listed properties per type ───────────────────────────────────────────

type Setter = (c: AppComponent, value: unknown, spec: AppSpec) => string | null;
const str = (max: number, min = 0) => (v: unknown): v is string => typeof v === 'string' && v.length >= min && v.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(v);
const optionalText = (max: number, key: 'title' | 'caption'): Setter => (c, v) => {
  if (v === null || v === '') { delete (c as unknown as Record<string, unknown>)[key]; return null; }
  if (!str(max)(v)) return `${key} is text of at most ${max} characters`;
  (c as unknown as Record<string, unknown>)[key] = v;
  return null;
};
const columnOf = (spec: AppSpec, c: AppComponent): AppOutputColumn[] => {
  const q = 'data' in c ? spec.queries.find((x) => x.id === (c.data as AppQueryBinding).query) : undefined;
  return q?.output ?? [];
};

const COMMON: Record<string, Setter> = {
  title: optionalText(120, 'title'),
  hideOnPhone: (c, v) => {
    if (typeof v !== 'boolean') return 'hideOnPhone is true or false';
    if (v) c.hideOnPhone = true; else delete c.hideOnPhone;
    return null;
  },
};

const BY_TYPE: Partial<Record<AppComponentType, Record<string, Setter>>> = {
  table: {
    pageSize: (c, v) => { if (!Number.isInteger(v) || (v as number) < 5 || (v as number) > 500) return 'pageSize is 5 to 500'; (c as { pageSize?: number }).pageSize = v as number; return null; },
  },
  chart: {
    chart: (c, v) => {
      if (v !== 'line' && v !== 'bar' && v !== 'area' && v !== 'pie') return 'chart is line, bar, area or pie';
      const ch = c as Extract<AppComponent, { type: 'chart' }>;
      ch.chart = v;
      if (v === 'pie') { ch.series = ch.series.slice(0, 1); delete ch.stacked; }
      return null;
    },
    stacked: (c, v) => { if (typeof v !== 'boolean') return 'stacked is true or false'; const ch = c as Extract<AppComponent, { type: 'chart' }>; if (v && ch.chart !== 'pie') ch.stacked = true; else delete ch.stacked; return null; },
    x: (c, v, spec) => { if (!columnOf(spec, c).some((col) => col.name === v)) return 'x is a column of the chart’s query'; (c as Extract<AppComponent, { type: 'chart' }>).x = v as string; return null; },
  },
  kpi: {
    value: (c, v, spec) => { if (!columnOf(spec, c).some((col) => col.name === v)) return 'value is a column of the KPI’s query'; (c as Extract<AppComponent, { type: 'kpi' }>).value = v as string; return null; },
    caption: optionalText(120, 'caption'),
  },
  text: {
    text: (c, v) => { if (!str(4_000)(v)) return 'text is at most 4,000 characters'; (c as Extract<AppComponent, { type: 'text' }>).text = v; return null; },
    style: (c, v) => { if (v !== 'heading' && v !== 'body' && v !== 'caption') return 'style is heading, body or caption'; (c as Extract<AppComponent, { type: 'text' }>).style = v; return null; },
  },
  filter: {
    label: (c, v) => { if (!str(120, 1)(v)) return 'label is 1 to 120 characters'; (c as Extract<AppComponent, { type: 'filter' }>).label = v; return null; },
  },
  button: {
    label: (c, v) => { if (!str(60, 1)(v)) return 'label is 1 to 60 characters'; (c as Extract<AppComponent, { type: 'button' }>).action.label = v; return null; },
  },
  link: {
    label: (c, v) => { if (!str(120, 1)(v)) return 'label is 1 to 120 characters'; (c as Extract<AppComponent, { type: 'link' }>).label = v; return null; },
  },
  image: {
    alt: (c, v) => { if (!str(300)(v)) return 'alt is at most 300 characters'; (c as Extract<AppComponent, { type: 'image' }>).alt = v; return null; },
  },
};

/** The properties `component-set` may change on a component of `type` (Properties draws exactly these). */
export function settableProps(type: AppComponentType): string[] {
  return [...Object.keys(COMMON), ...Object.keys(BY_TYPE[type] ?? {})];
}

// ── what a component uses (component-remove's sweep) ────────────────────────────────────────

function queriesOf(c: AppComponent): string[] {
  const out: string[] = [];
  if ('data' in c && c.data !== undefined) out.push((c.data as AppQueryBinding).query);
  if (c.type === 'filter' && c.options?.kind === 'query') out.push(c.options.query.query);
  return out;
}
function actionsOf(c: AppComponent): string[] {
  const out: string[] = [];
  if (c.type === 'table') for (const r of c.rowActions ?? []) out.push(r.action);
  if (c.type === 'button') out.push(c.action.action);
  if (c.type === 'form') out.push(c.submit.action);
  return out;
}
function bindingMaps(c: AppComponent): Array<Record<string, AppBindingRef> | undefined> {
  const maps: Array<Record<string, AppBindingRef> | undefined> = [];
  if ('data' in c && c.data !== undefined) maps.push((c.data as AppQueryBinding).params);
  if (c.type === 'filter' && c.options?.kind === 'query') maps.push(c.options.query.params);
  const actionMaps = (b: AppActionBinding): void => { maps.push(b.params); };
  if (c.type === 'table') (c.rowActions ?? []).forEach(actionMaps);
  if (c.type === 'button') actionMaps(c.action);
  if (c.type === 'form') actionMaps(c.submit);
  if (c.type === 'link' && c.to.kind === 'page') maps.push(c.to.params);
  return maps;
}

function each(spec: AppSpec): AppComponent[] { return spec.pages.flatMap((p) => p.components); }

// ── apply ───────────────────────────────────────────────────────────────────────────────────

/**
 * Apply `ops` (already shape-checked by the protocol parser, checked again here) to `spec`, the host's copy of the
 * version the runtime named. Never mutates `spec`. One refusal refuses the whole edit.
 */
export function applyOps(spec: AppSpec, ops: readonly unknown[]): OpsResult {
  const next = structuredClone(spec) as AppSpec;
  const added: string[] = [];
  const touched = new Set<string>();
  const ids = new Set(each(next).map((c) => c.id));
  const find = (id: string): { c: AppComponent; page: AppSpec['pages'][number]; at: number } | null => {
    for (const page of next.pages) {
      const at = page.components.findIndex((c) => c.id === id);
      if (at >= 0) return { c: page.components[at]!, page, at };
    }
    return null;
  };
  for (const raw of ops) {
    if (!isSpecOp(raw)) return { ok: false, code: 'bad_request', message: 'an op has the wrong shape' };
    const op = raw as SpecOp;
    if (op.op === 'component-add') {
      const page = next.pages.find((p) => p.id === op.page);
      if (page === undefined) return { ok: false, code: 'refused', message: `this app has no page ${op.page}` };
      if (page.components.length >= 100) return { ok: false, code: 'refused', message: 'a page holds at most 100 components' };
      const id = freshId(next, op.type, ids);
      const w = Math.min(op.box.w, 12 - op.box.x);
      const made = newComponent(next, id, op.type, { x: op.box.x, y: op.box.y, w, h: op.box.h });
      if (typeof made === 'string') return { ok: false, code: 'refused', message: made };
      page.components.push(made);
      ids.add(id);
      added.push(id);
      touched.add(id);
      continue;
    }
    const hit = find(op.id);
    if (hit === null || !COMPONENT_ID.test(op.id)) return { ok: false, code: 'refused', message: `this version has no component ${op.id}` };
    const { c } = hit;
    touched.add(c.id);
    switch (op.op) {
      case 'component-move':
        c.box = { ...c.box, x: Math.min(op.x, 12 - c.box.w), y: op.y };
        break;
      case 'component-resize':
        c.box = { ...c.box, w: Math.min(op.w, 12 - c.box.x), h: op.h };
        break;
      case 'component-set': {
        const setter = COMMON[op.prop] ?? BY_TYPE[c.type]?.[op.prop];
        if (setter === undefined || !Object.hasOwn(COMMON, op.prop) && !Object.hasOwn(BY_TYPE[c.type] ?? {}, op.prop)) {
          return { ok: false, code: 'refused', message: `a ${TYPE_WORDS[c.type]} has no property ${op.prop} that can be set here` };
        }
        const why = setter(c, op.value, next);
        if (why !== null) return { ok: false, code: 'refused', message: why };
        break;
      }
      case 'component-remove': {
        hit.page.components.splice(hit.at, 1);
        ids.delete(c.id);
        // §6.2: the queries and actions THAT component used and nothing else uses go with it, in the same version.
        const rest = each(next);
        const qUsed = new Set(rest.flatMap(queriesOf));
        const aUsed = new Set(rest.flatMap(actionsOf));
        next.queries = next.queries.filter((q) => !queriesOf(c).includes(q.id) || qUsed.has(q.id));
        next.actions = next.actions.filter((a) => !actionsOf(c).includes(a.id) || aUsed.has(a.id));
        // A removed filter no longer feeds anything: its bindings go too (a required parameter left unbound is
        // crew's check to refuse, with its reason).
        if (c.type === 'filter') {
          const mine = (ref: string): boolean => ref === `filter.${c.id}` || ref.startsWith(`filter.${c.id}.`);
          for (const other of rest) for (const m of bindingMaps(other)) if (m !== undefined) for (const [k, ref] of Object.entries(m)) if (mine(ref)) delete m[k];
        }
        break;
      }
      case 'bind': {
        if (c.type !== 'table' && c.type !== 'chart' && c.type !== 'kpi') return { ok: false, code: 'refused', message: `a ${TYPE_WORDS[c.type]} does not read a query` };
        const q = next.queries.find((x) => x.id === op.query);
        if (q === undefined) return { ok: false, code: 'refused', message: `this version has no query ${op.query}` };
        const declared = new Set(Object.keys(q.params?.properties ?? {}));
        const kept = Object.fromEntries(Object.entries(c.data.params ?? {}).filter(([k]) => declared.has(k)));
        c.data = Object.keys(kept).length > 0 ? { query: q.id, params: kept } : { query: q.id };
        if (c.type === 'table') delete c.columns;
        if (c.type === 'chart') {
          const cols = chartColumns(q);
          if (cols === null) return { ok: false, code: 'refused', message: `${q.id} has no category and number columns for a chart` };
          c.x = cols.x;
          c.series = [{ column: cols.series }];
        }
        if (c.type === 'kpi') {
          const v = firstOf(q.output, (col) => NUMERIC.has(col.type));
          if (v === undefined) return { ok: false, code: 'refused', message: `${q.id} has no number column for a KPI` };
          c.value = v;
          delete c.delta;
        }
        break;
      }
    }
  }
  return { ok: true, spec: next, added, touched: [...touched] };
}

/** The host's one line for an edit burst ("Moved chart “Breaches by region”"), from ITS spec, never the runtime's. */
export function opsSummary(before: AppSpec, after: AppSpec, ops: readonly SpecOp[]): string {
  const [first] = ops;
  if (first === undefined) return 'Changed the app';
  const verb = ops.every((o) => o.op === first.op) ? ({
    'component-add': 'Added', 'component-move': 'Moved', 'component-resize': 'Resized', 'component-set': 'Changed', 'component-remove': 'Removed', bind: 'Bound',
  } as const)[first.op] : 'Changed';
  const ids = [...new Set(ops.map((o) => ('id' in o ? o.id : null)).filter((x): x is string => x !== null))];
  const named = ids.length === 1 ? componentWords(first.op === 'component-remove' ? before : after, ids[0]!) : null;
  if (named !== null) return `${verb} ${named}`.slice(0, 200);
  if (first.op === 'component-add' && ops.length === 1) return `Added a ${TYPE_WORDS[first.type]}`;
  return `${verb} ${ids.length > 1 ? `${ids.length} components` : 'the app'}`;
}
