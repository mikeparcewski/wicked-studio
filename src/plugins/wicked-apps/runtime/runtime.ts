import type {
  AppActionBinding, AppBindingRef, AppCell, AppComponent, AppComponentType, AppFilterComponent, AppFormComponent, AppOutputColumn, AppPage, AppParamSchema,
  AppParamsSchema, AppSpec, AppTableColumn, AppTableComponent,
} from '../../../api/types.js';
import { ENVELOPE, PROTOCOL, announceReady } from '../../_shared/v2.js';
import { drawChart } from './chart.js';
import { cellText, lineOf } from './format.js';
import { Sheet, type Box } from './sheet.js';

/**
 * `wicked-apps`, the Apps runtime (DES-APPS-001 §7.1; slice K4). It interprets an app's spec and nothing else: no
 * agent code runs, every value is text, it reaches data only through its host (`data.query`, `data.action`), and it
 * styles itself only through its one stylesheet's CSSOM (never a `style` attribute: {@link Sheet}).
 *
 *  - PREVIEW is the app as a viewer gets it: filters, tables, charts, KPIs, forms, buttons and links. A button or a
 *    row action asks the host (`data.action`); the HOST draws the card outside this frame and runs it only on the
 *    person's click there. A framed host (`host.hello.app.framed`) gets no action at all: "Open to make changes".
 *  - EDIT draws outlines, handles and drop targets: the palette adds, a drag moves, the corner resizes, Properties
 *    sets — each gesture is ONE spec op sent at its end (`spec.edit {base, ops}`), on the version shown. Nothing writes
 *    to a source in Edit.
 */

type Mode = 'edit' | 'preview';
type Reply = { ok: true; payload: Record<string, unknown> } | { ok: false; code: string; message: string; payload: Record<string, unknown> };
interface Rows { columns: AppOutputColumn[]; rows: AppCell[][]; sample: boolean; hasMore: boolean; truncated: boolean }
type Result = { state: 'loading' } | { state: 'rows'; rows: Rows } | { state: 'error'; message: string };
type DateRange = { from: string; to: string };

/** The grid's row height and gap (the template's `--row` / `--gap`; `compact` density is the smaller pair). */
const ROW = { comfortable: 44, compact: 36 } as const;
const GAP = { comfortable: 12, compact: 8 } as const;
/** Rows a chart draws; a longer answer says so under the chart. */
export const CHART_ROWS = 500;
const PARAM_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/u;
/** A null-prototype dictionary: a spec id `constructor` or `toString` is just a key (codex r1). */
const dict = <T,>(): Record<string, T> => Object.create(null) as Record<string, T>;

/**
 * A bound value as its parameter's declared type (§7.2 step 3 is crew's check; this sends what a person typed in the
 * type it is declared): numbers and integers from text, booleans from a checkbox or `true`/`false`, text from a number.
 * A value that does not convert is sent as it is, so crew refuses it with its reason.
 */
export function coerceParam(schema: AppParamSchema | undefined, v: unknown): unknown {
  if (schema === undefined || v === null || v === undefined) return v;
  if ((schema.type === 'number' || schema.type === 'integer') && typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    if (Number.isFinite(n) && (schema.type === 'number' || Number.isInteger(n))) return n;
    return v;
  }
  if (schema.type === 'boolean' && typeof v === 'string' && (v === 'true' || v === 'false')) return v === 'true';
  if (schema.type === 'string' && (typeof v === 'number' || typeof v === 'boolean')) return String(v);
  return v;
}
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const IMAGE = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/u;
const DEFAULT_SIZE: Record<AppComponentType, { w: number; h: number }> = {
  table: { w: 12, h: 5 }, chart: { w: 6, h: 5 }, kpi: { w: 3, h: 2 }, text: { w: 6, h: 1 }, filter: { w: 3, h: 1 },
  form: { w: 4, h: 6 }, button: { w: 2, h: 1 }, image: { w: 3, h: 3 }, link: { w: 2, h: 1 },
};
const PALETTE: Array<{ type: AppComponentType; label: string }> = [
  { type: 'table', label: 'Table' }, { type: 'chart', label: 'Chart' }, { type: 'kpi', label: 'KPI' }, { type: 'filter', label: 'Filter' },
  { type: 'form', label: 'Form' }, { type: 'button', label: 'Button' }, { type: 'text', label: 'Text' }, { type: 'link', label: 'Link' },
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls !== undefined) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function isoDay(d: Date): string { return d.toISOString().slice(0, 10); }

export function startRuntime(cfg: { editor: string; surfaces: unknown }): void {
  const styleEl = document.getElementById('wk-apps-sheet');
  if (!(styleEl instanceof HTMLStyleElement)) return;
  const sheet = new Sheet(styleEl);
  const root = el('div', 'wk-app');
  root.setAttribute('data-testid', 'apps-runtime');
  document.body.append(root);

  let port: MessagePort | null = null;
  let grants = new Set<string>();
  let framed = true; // until the host says otherwise: no action is ever offered before the handshake
  let mode: Mode = 'preview';
  let surface: 'card' | 'full' = 'full';
  let locale = 'en';
  let version = 0;
  let spec: AppSpec | null = null;
  let readonly = false;
  let pageId: string | null = null;
  let selected: string | null = null;
  const filters = dict<string | DateRange>();
  const forms = dict<Record<string, string | boolean>>();
  const url = dict<string>();
  const results = new Map<string, Result>();
  /** The binding (query + parameters) each component's result was read with: a result for another binding is stale. */
  const resultKey = new Map<string, string>();
  /** The generation of each component's newest read. */
  const compGen = new Map<string, number>();
  const lines = new Map<string, string>();
  const tablePage = new Map<string, number>();
  let gen = 0;
  let seq = 0;
  const pending = new Map<string, (r: Reply) => void>();
  let notice: string | null = null;
  /** `every N s` refresh, one timer per query (§7.2), re-reading only the components bound to it. */
  const timers = new Map<string, ReturnType<typeof setInterval>>();
  let closed = false;

  // ── the port ────────────────────────────────────────────────────────────────────────────
  const post = (m: Record<string, unknown>): void => { port?.postMessage({ p: PROTOCOL, v: ENVELOPE, ...m }); };
  const request = (type: string, payload: Record<string, unknown>): Promise<Reply> => {
    seq += 1;
    const id = `a${seq}`;
    post({ type, id, payload });
    return new Promise((resolve) => pending.set(id, resolve));
  };
  const say = (type: string, payload: Record<string, unknown>): void => post({ type, payload });

  const onPort = (m: MessageEvent): void => {
    const d = m.data as Record<string, unknown> | null;
    if (!isObj(d) || d['p'] !== PROTOCOL || d['v'] !== ENVELOPE) return;
    const p = isObj(d['payload']) ? d['payload'] : {};
    if (typeof d['re'] === 'string') {
      const r = pending.get(d['re']);
      if (r === undefined) return;
      pending.delete(d['re']);
      const e = isObj(d['error']) ? d['error'] : {};
      r(d['ok'] === true ? { ok: true, payload: p } : { ok: false, code: String(e['code'] ?? 'unavailable'), message: lineOf(e['message'], 300), payload: p });
      return;
    }
    if (closed) return;
    switch (d['type']) {
      case 'host.ping': if (typeof d['id'] === 'string') post({ re: d['id'], ok: true, payload: {} }); return;
      case 'host.theme': if (isObj(p['theme'])) hostTheme = p['theme']; draw(); return;
      case 'artifact.changed': void read(); return;
      case 'app.mode': if (p['mode'] === 'edit' || p['mode'] === 'preview') { mode = p['mode']; if (mode === 'preview') selected = null; draw(); } return;
      case 'data.invalidate': queryAll(); return;
      case 'host.surface': if (p['surface'] === 'card' || p['surface'] === 'full') { surface = p['surface']; draw(); } return;
      case 'selection.cleared': selected = null; draw(); return;
      case 'host.teardown':
        closed = true;
        for (const t of timers.values()) clearInterval(t);
        timers.clear();
        document.removeEventListener('keydown', onKey);
        port?.close();
        port = null;
        root.replaceChildren(el('p', 'wk-empty', 'Closed'));
        return;
      default: return;
    }
  };

  let hostTheme: Record<string, unknown> = {};
  const applyTheme = (t: unknown): void => {
    if (isObj(t)) hostTheme = t;
    sheet.theme(hostTheme, { accent: spec?.theme?.accent, palette: spec?.theme?.palette, density: spec?.theme?.density });
  };
  const density = (): 'comfortable' | 'compact' => (spec?.theme?.density === 'compact' ? 'compact' : 'comfortable');

  window.addEventListener('message', (e: MessageEvent) => {
    const d = e.data as Record<string, unknown> | null;
    // The one handshake: from the parent only, once, with the port. After it, the window is never read again.
    if (port !== null || e.source !== parent || !isObj(d) || d['p'] !== PROTOCOL || d['type'] !== 'host.hello' || e.ports[0] === undefined) return;
    port = e.ports[0];
    port.onmessage = onPort;
    const p = isObj(d['payload']) ? d['payload'] : {};
    grants = new Set(Array.isArray(p['grants']) ? (p['grants'] as unknown[]).filter((g): g is string => typeof g === 'string') : []);
    const app = isObj(p['app']) ? p['app'] : {};
    framed = app['framed'] !== false;
    mode = app['mode'] === 'edit' ? 'edit' : 'preview';
    surface = p['surface'] === 'card' || p['size'] === 'inline' ? 'card' : 'full';
    // The page's URL parameters, as the HOST read them for this app (`url.<name>` bindings).
    if (isObj(app['url'])) {
      for (const [k, v] of Object.entries(app['url']).slice(0, 30)) if (PARAM_NAME.test(k) && typeof v === 'string' && v.length <= 1_000) url[k] = v;
    }
    const prefs = isObj(p['prefs']) ? p['prefs'] : {};
    locale = typeof prefs['locale'] === 'string' && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/u.test(prefs['locale']) ? prefs['locale'] : 'en';
    applyTheme(p['theme']);
    void read();
  });

  // ── reading the app ─────────────────────────────────────────────────────────────────────
  const read = async (): Promise<void> => {
    const r = await request('artifact.read', {});
    if (!r.ok) { notice = r.message; draw(); return; }
    const c = isObj(r.payload['content']) ? r.payload['content'] : {};
    if (c['type'] !== 'app' || !isObj(c['spec'])) { notice = 'This is not an app'; draw(); return; }
    const before = version;
    version = typeof r.payload['version'] === 'number' ? r.payload['version'] : 0;
    spec = c['spec'] as unknown as AppSpec;
    readonly = c['readonly'] === true;
    if (pageId === null || !spec.pages.some((pg) => pg.id === pageId)) pageId = spec.pages[0]?.id ?? null;
    if (selected !== null && !components().some((x) => x.id === selected)) selected = null;
    notice = null;
    // Filters take their declared defaults BEFORE anything is drawn or read, so a control shows what is sent.
    initFilters();
    // A result read for another binding (a refused edit put an older spec back at the same version) is dropped.
    const stale = invalidate();
    draw();
    if (before !== version || stale || results.size === 0) queryAll();
  };

  /** Drop every result whose component now reads another query or other parameters. True when one was dropped. */
  const invalidate = (): boolean => {
    const now = new Map<string, string>();
    for (const pg of spec?.pages ?? []) for (const c of pg.components) { const d = dataOf(c); if (d !== null) now.set(c.id, bindingKey(d)); }
    let dropped = false;
    for (const id of [...results.keys()]) if (resultKey.get(id) !== now.get(id)) { results.delete(id); resultKey.delete(id); dropped = true; }
    return dropped;
  };
  const bindingKey = (d: { query: string; params: Record<string, unknown> }): string => `${d.query}\u0000${JSON.stringify(d.params)}`;

  const page = (): AppPage | null => spec?.pages.find((pg) => pg.id === pageId) ?? null;
  const components = (): AppComponent[] => page()?.components ?? [];

  // ── bindings ────────────────────────────────────────────────────────────────────────────
  const filterValue = (id: string, part: string | undefined): string | undefined => {
    const v = filters[id];
    if (v === undefined) return undefined;
    if (typeof v === 'string') return part === undefined ? v : undefined;
    return part === 'from' ? v.from : part === 'to' ? v.to : undefined;
  };
  const resolve = (map: Record<string, AppBindingRef> | undefined, ctx: { row?: Record<string, AppCell>; form?: string }, schema?: AppParamsSchema): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    const props = schema?.properties ?? {};
    for (const [param, ref] of Object.entries(map ?? {})) {
      const [kind, name, part] = ref.split('.');
      let v: unknown;
      if (kind === 'filter' && name !== undefined) v = filterValue(name, part);
      else if (kind === 'row' && name !== undefined && ctx.row !== undefined && Object.hasOwn(ctx.row, name)) v = ctx.row[name];
      else if (kind === 'form' && name !== undefined && ctx.form !== undefined) { const f = forms[ctx.form]; v = f !== undefined && Object.hasOwn(f, name) ? f[name] : undefined; }
      else if (kind === 'url' && name !== undefined) v = url[name];
      if (v !== undefined && v !== '') out[param] = coerceParam(Object.hasOwn(props, param) ? props[param] : undefined, v);
    }
    return out;
  };
  const initFilters = (): void => {
    for (const pg of spec?.pages ?? []) for (const c of pg.components) {
      if (c.type !== 'filter' || filters[c.id] !== undefined) continue;
      if (c.filter === 'date-range') {
        const days = isObj(c.default) && Number.isInteger(c.default['lastDays']) ? Math.min(3_650, Math.max(1, c.default['lastDays'] as number)) : 30;
        const to = new Date();
        filters[c.id] = { from: isoDay(new Date(to.getTime() - days * 86_400_000)), to: isoDay(to) };
      } else filters[c.id] = typeof c.default === 'string' ? c.default : '';
    }
  };

  // ── data ────────────────────────────────────────────────────────────────────────────────
  const querySchema = (id: string): AppParamsSchema | undefined => spec?.queries.find((q) => q.id === id)?.params;
  const dataOf = (c: AppComponent): { query: string; params: Record<string, unknown> } | null => {
    if (c.type === 'table' || c.type === 'chart' || c.type === 'kpi') return { query: c.data.query, params: resolve(c.data.params, {}, querySchema(c.data.query)) };
    if (c.type === 'filter' && c.filter === 'select' && c.options?.kind === 'query') return { query: c.options.query.query, params: resolve(c.options.query.params, {}, querySchema(c.options.query.query)) };
    return null;
  };
  /** Read every data component on the page (or only those bound to `only`, a refresh timer's query). */
  const queryAll = (only?: string): void => {
    if (closed || !grants.has('data.read') || spec === null) return;
    initFilters();
    gen += 1;
    const mine = gen;
    const asked = new Map<string, Promise<Result>>();
    for (const c of components()) {
      const d = dataOf(c);
      if (d === null || (only !== undefined && d.query !== only)) continue;
      const key = bindingKey(d);
      let job = asked.get(key);
      if (job === undefined) {
        job = request('data.query', { query: d.query, params: d.params }).then((r): Result => {
          if (!r.ok) return { state: 'error', message: r.message };
          const cols = Array.isArray(r.payload['columns']) ? r.payload['columns'] as AppOutputColumn[] : [];
          const rows = Array.isArray(r.payload['rows']) ? (r.payload['rows'] as unknown[]).filter(Array.isArray) as AppCell[][] : [];
          return { state: 'rows', rows: { columns: cols, rows, sample: r.payload['sample'] === true, hasMore: r.payload['hasMore'] === true, truncated: r.payload['truncated'] === true } };
        });
        asked.set(key, job);
      }
      if (!results.has(c.id)) results.set(c.id, { state: 'loading' });
      // Each component lands only the answer to its newest read: a later read of it (a filter change, a new binding)
      // makes this one obsolete; a refresh of another query does not.
      compGen.set(c.id, mine);
      void job.then((res) => { if (!closed && compGen.get(c.id) === mine) { results.set(c.id, res); resultKey.set(c.id, key); redraw(c.id); } });
    }
    if (only === undefined) schedule();
  };
  /** One timer per `every N s` query on this page, only while the frame is visible. `events` (the built-in crew source
   *  only) reads on load and when the host invalidates; the crew source arrives with K1's sources. */
  const schedule = (): void => {
    const want = new Map<string, number>();
    for (const c of components()) {
      const d = dataOf(c);
      const q = d === null ? undefined : spec?.queries.find((x) => x.id === d.query);
      if (q?.refresh?.mode === 'every') want.set(q.id, Math.max(15, q.refresh.seconds));
    }
    for (const [id, t] of [...timers]) {
      const [q, secs] = id.split('\u0000');
      if (want.get(q!) !== Number(secs)) { clearInterval(t); timers.delete(id); }
    }
    for (const [q, secs] of want) {
      const id = `${q}\u0000${secs}`;
      if (!timers.has(id)) timers.set(id, setInterval(() => { if (document.visibilityState === 'visible') queryAll(q); }, secs * 1000));
    }
  };

  // ── actions ─────────────────────────────────────────────────────────────────────────────
  const runAction = async (owner: string, b: AppActionBinding, ctx: { row?: Record<string, AppCell>; form?: string }): Promise<void> => {
    if (framed || mode !== 'preview' || !grants.has('data.write')) return;
    // A table or a form has room for its line; a one-row button says it at the top of the page.
    const roomy = components().find((x) => x.id === owner)?.type !== 'button';
    const say = (text: string): void => { if (roomy) { lines.set(owner, text); redraw(owner); } else flash(`${lineOf(b.label, 60)}: ${text}`); };
    say('Waiting for you in studio…');
    const r = await request('data.action', { action: b.action, params: resolve(b.params, ctx, spec?.actions.find((x) => x.id === b.action)?.params) });
    const state = r.ok ? String(r.payload['state']) : 'refused';
    const reason = r.ok ? lineOf(r.payload['reason'], 200) : r.message;
    say(state === 'succeeded' ? `Done${reason !== '' ? `: ${reason}` : ''}` : state === 'cancelled' ? 'Not run' : state === 'unknown' ? `Not known whether it ran: ${reason}` : `Not run: ${reason}`);
  };

  const actionButton = (owner: string, b: AppActionBinding, ctx: { row?: Record<string, AppCell>; form?: string }, cls = 'wk-btn wk-btn--sm'): HTMLElement => {
    if (framed) return el('span', 'wk-muted', 'Open to make changes');
    const btn = el('button', cls, lineOf(b.label, 60));
    btn.type = 'button';
    btn.setAttribute('data-action', b.action);
    if (mode !== 'preview' || !grants.has('data.write')) {
      btn.disabled = true;
      btn.title = mode === 'edit' ? 'Actions run in Preview' : 'This app may not ask to run actions here';
    } else btn.addEventListener('click', (e) => { e.stopPropagation(); void runAction(owner, b, ctx); });
    return btn;
  };

  // ── drawing ─────────────────────────────────────────────────────────────────────────────
  const index = new Map<string, number>();
  const bodies = new Map<string, HTMLElement>();

  const drawBody = (c: AppComponent, body: HTMLElement): void => {
    body.replaceChildren();
    const res = results.get(c.id);
    const needsData = c.type === 'table' || c.type === 'chart' || c.type === 'kpi';
    if (needsData) {
      if (!grants.has('data.read')) { body.append(el('p', 'wk-muted', 'Live rows are not shown here')); return; }
      if (res === undefined || res.state === 'loading') { body.append(el('p', 'wk-muted', 'Loading…')); return; }
      if (res.state === 'error') { body.append(el('p', 'wk-error', `${'data' in c ? c.data.query : ''}: ${res.message}`)); return; }
    }
    const rows = res?.state === 'rows' ? res.rows : null;
    switch (c.type) {
      case 'kpi': {
        const at = (n: string | undefined): number => (n === undefined ? -1 : rows!.columns.findIndex((col) => col.name === n));
        const first = rows!.rows[0];
        body.append(el('div', 'wk-kpi-value', first === undefined ? '—' : cellText(first[at(c.value)], c.format, locale)));
        const sub = el('div', 'wk-kpi-caption');
        if (first !== undefined && c.delta !== undefined && at(c.delta) >= 0) {
          const dv = first[at(c.delta)];
          const down = (typeof dv === 'number' && dv < 0) || (typeof dv === 'string' && dv.trim().startsWith('-'));
          sub.append(el('span', down ? 'wk-delta wk-delta--down' : 'wk-delta wk-delta--up', `${down ? '▼' : '▲'} ${cellText(dv, undefined, locale).replace(/^\s*-/u, '')}`));
          sub.append(document.createTextNode(' '));
        }
        if (c.caption !== undefined) sub.append(document.createTextNode(lineOf(c.caption, 120)));
        body.append(sub);
        return;
      }
      case 'chart':
        drawChart(body, c, rows!, locale);
        // A partial answer never looks complete (§7.5): the source's cut, or the chart's own.
        if (rows!.truncated || rows!.rows.length > CHART_ROWS) body.append(el('p', 'wk-muted', rows!.truncated ? `Only part of the source’s rows: the answer was cut at the app’s limit` : `The first ${CHART_ROWS} of ${rows!.rows.length} rows`));
        return;
      case 'table': { drawTable(c, body, rows!); return; }
      case 'text': body.append(el(c.style === 'heading' ? 'h2' : 'p', `wk-text wk-text--${c.style ?? 'body'}`, c.text.slice(0, 4_000))); return;
      case 'filter': { drawFilter(c, body); return; }
      case 'form': { drawForm(c, body); return; }
      case 'button': body.append(actionButton(c.id, c.action, {}, 'wk-btn')); return;
      case 'image': {
        if (!IMAGE.test(c.src)) { body.append(el('p', 'wk-muted', 'This image is not one the app can show')); return; }
        const img = el('img', 'wk-image');
        img.alt = lineOf(c.alt, 300);
        img.src = c.src;
        body.append(img);
        return;
      }
      case 'link': {
        const a = el('button', 'wk-link', lineOf(c.label, 120));
        a.type = 'button';
        if (c.to.kind === 'page') {
          const target = c.to;
          a.addEventListener('click', () => {
            if (mode !== 'preview') return;
            notice = null;
            for (const [k, ref] of Object.entries(resolve(target.params, {}))) url[k] = String(ref);
            if (spec?.pages.some((pg) => pg.id === target.page)) { pageId = target.page; selected = null; draw(); queryAll(); }
          });
        } else {
          const href = c.to.href;
          a.title = href.slice(0, 300);
          a.addEventListener('click', async () => {
            if (mode !== 'preview') return;
            const r = await request('link.open', { href });
            if (!r.ok) flash(`${lineOf(c.label, 60)} not opened: ${r.message}`);
          });
        }
        body.append(a);
        return;
      }
    }
  };

  const drawTable = (c: AppTableComponent, body: HTMLElement, rows: Rows): void => {
    const at = (n: string): number => rows.columns.findIndex((col) => col.name === n);
    const shown: AppTableColumn[] = (c.columns ?? rows.columns.map((col): AppTableColumn => ({ column: col.name }))).filter((col) => at(col.column) >= 0);
    const size = Math.min(500, Math.max(5, c.pageSize ?? 10));
    const pages = Math.max(1, Math.ceil(rows.rows.length / size));
    const pg = Math.min(tablePage.get(c.id) ?? 0, pages - 1);
    const table = el('table', 'wk-table');
    const head = el('tr');
    for (const col of shown) head.append(el('th', undefined, lineOf(col.label ?? col.column, 80)));
    if ((c.rowActions ?? []).length > 0) head.append(el('th', 'wk-th-actions', ''));
    table.append(el('thead'));
    table.tHead!.append(head);
    const tbody = el('tbody');
    for (const r of rows.rows.slice(pg * size, pg * size + size)) {
      const tr = el('tr');
      const record = dict<AppCell>();
      rows.columns.forEach((col, i) => { record[col.name] = r[i] ?? null; });
      for (const col of shown) {
        const v = r[at(col.column)];
        tr.append(el('td', typeof v === 'number' ? 'wk-num' : undefined, cellText(v, col.format, locale)));
      }
      if ((c.rowActions ?? []).length > 0) {
        const td = el('td', 'wk-td-actions');
        for (const b of (c.rowActions ?? []).slice(0, 4)) td.append(actionButton(c.id, b, { row: record }));
        tr.append(td);
      }
      tbody.append(tr);
    }
    table.append(tbody);
    body.append(table);
    if (rows.rows.length === 0) body.append(el('p', 'wk-muted', 'No rows'));
    const foot = el('div', 'wk-table-foot');
    if (pages > 1) {
      const prev = el('button', 'wk-btn wk-btn--sm', 'Previous');
      const next = el('button', 'wk-btn wk-btn--sm', 'Next');
      prev.type = 'button'; next.type = 'button';
      prev.disabled = pg === 0; next.disabled = pg >= pages - 1;
      prev.addEventListener('click', () => { tablePage.set(c.id, pg - 1); redraw(c.id); });
      next.addEventListener('click', () => { tablePage.set(c.id, pg + 1); redraw(c.id); });
      foot.append(prev, el('span', 'wk-muted', `${pg + 1} of ${pages}`), next);
    }
    if (rows.truncated) foot.append(el('span', 'wk-muted', `Only the first ${rows.rows.length} rows: the answer was cut at the app’s limit`));
    else if (rows.hasMore) foot.append(el('span', 'wk-muted', 'First page of the source’s rows'));
    const ln = lines.get(c.id);
    if (ln !== undefined) foot.append(el('span', 'wk-status', ln));
    if (foot.childNodes.length > 0) body.append(foot);
  };

  const drawFilter = (c: AppFilterComponent, body: HTMLElement): void => {
    const label = el('label', 'wk-filter');
    label.append(el('span', 'wk-filter-label', lineOf(c.label ?? (c.filter === 'search' ? 'Search' : c.filter === 'date-range' ? 'Dates' : 'Filter'), 60)));
    const changed = (): void => { queryAll(); };
    if (c.filter === 'search') {
      const input = el('input', 'wk-input');
      input.type = 'search';
      input.value = typeof filters[c.id] === 'string' ? filters[c.id] as string : '';
      let t: ReturnType<typeof setTimeout> | null = null;
      input.addEventListener('input', () => {
        filters[c.id] = input.value.slice(0, 200);
        if (t !== null) clearTimeout(t);
        t = setTimeout(changed, 300);
      });
      label.append(input);
    } else if (c.filter === 'select') {
      const select = el('select', 'wk-input');
      const opts: Array<{ value: string; label: string }> = [{ value: '', label: 'All' }];
      if (c.options?.kind === 'values') for (const o of c.options.values.slice(0, 200)) opts.push({ value: lineOf(o.value, 200), label: lineOf(o.label ?? o.value, 200) });
      if (c.options?.kind === 'query') {
        const res = results.get(c.id);
        if (res?.state === 'rows') {
          const vi = res.rows.columns.findIndex((col) => col.name === (c.options as { value: string }).value);
          const li = res.rows.columns.findIndex((col) => col.name === ((c.options as { label?: string }).label ?? ''));
          for (const r of res.rows.rows.slice(0, 200)) if (vi >= 0) opts.push({ value: cellText(r[vi], undefined, locale), label: cellText(r[li >= 0 ? li : vi], undefined, locale) });
        }
      }
      for (const o of opts) { const opt = el('option', undefined, o.label); opt.value = o.value; select.append(opt); }
      select.value = typeof filters[c.id] === 'string' ? filters[c.id] as string : '';
      select.addEventListener('change', () => { filters[c.id] = select.value; changed(); });
      label.append(select);
    } else {
      const v = (filters[c.id] ?? { from: '', to: '' }) as DateRange;
      const from = el('input', 'wk-input wk-input--date');
      const to = el('input', 'wk-input wk-input--date');
      from.type = 'date'; to.type = 'date';
      from.value = v.from; to.value = v.to;
      const set = (): void => { filters[c.id] = { from: from.value, to: to.value }; changed(); };
      from.addEventListener('change', set);
      to.addEventListener('change', set);
      label.append(from, el('span', 'wk-muted', '–'), to);
    }
    body.append(label);
  };

  const drawForm = (c: AppFormComponent, body: HTMLElement): void => {
    const values = (forms[c.id] ??= dict<string | boolean>());
    const box = el('div', 'wk-form');
    for (const f of c.fields.slice(0, 30)) {
      const label = el('label', 'wk-field');
      label.append(el('span', 'wk-filter-label', lineOf(f.label ?? f.name, 80)));
      let input: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
      if (f.input === 'textarea') input = el('textarea', 'wk-input');
      else if (f.input === 'select') {
        input = el('select', 'wk-input');
        for (const o of f.options ?? []) { const opt = el('option', undefined, lineOf(o.label ?? o.value, 200)); opt.value = lineOf(o.value, 200); input.append(opt); }
      } else {
        input = el('input', 'wk-input');
        input.type = f.input === 'number' ? 'number' : f.input === 'date' ? 'date' : f.input === 'checkbox' ? 'checkbox' : 'text';
      }
      if (input instanceof HTMLInputElement && input.type === 'checkbox') {
        input.checked = values[f.name] === true;
        input.addEventListener('change', () => { values[f.name] = (input as HTMLInputElement).checked; });
      } else {
        input.value = typeof values[f.name] === 'string' ? values[f.name] as string : '';
        input.addEventListener('input', () => { values[f.name] = input.value.slice(0, 1_000); });
      }
      input.disabled = mode !== 'preview';
      label.append(input);
      box.append(label);
    }
    const row = el('div', 'wk-form-foot');
    row.append(actionButton(c.id, c.submit, { form: c.id }, 'wk-btn'));
    const ln = lines.get(c.id);
    row.append(el('span', 'wk-muted', ln ?? (framed ? '' : 'Studio asks before it writes')));
    box.append(row);
    body.append(box);
  };

  /** One line at the top of the page (a link's or a button's answer): a one-row cell has no room for it. */
  let noticeEl: HTMLElement | null = null;
  const flash = (text: string): void => {
    notice = text;
    if (noticeEl !== null) { noticeEl.textContent = text; noticeEl.hidden = false; } else draw();
  };

  const redraw = (id: string): void => {
    const c = components().find((x) => x.id === id);
    const body = bodies.get(id);
    if (c !== undefined && body !== undefined) drawBody(c, body);
  };

  // ── Edit: the canvas, the palette and Properties ────────────────────────────────────────
  const editing = (): boolean => mode === 'edit' && surface === 'full' && !readonly && grants.has('artifact.write');
  let grid: HTMLElement | null = null;

  const cellSize = (): { col: number; row: number; left: number; top: number } => {
    const r = grid!.getBoundingClientRect();
    const d = density();
    return { col: (r.width + GAP[d]) / 12, row: ROW[d] + GAP[d], left: r.left, top: r.top };
  };
  const cellAt = (clientX: number, clientY: number): { x: number; y: number } => {
    const s = cellSize();
    return { x: Math.min(11, Math.max(0, Math.floor((clientX - s.left) / s.col))), y: Math.min(999, Math.max(0, Math.floor((clientY - s.top) / s.row))) };
  };

  const edit = async (ops: Array<Record<string, unknown>>): Promise<string[] | null> => {
    const r = await request('spec.edit', { base: version, ops });
    if (!r.ok) {
      notice = r.code === 'head_moved' ? 'The app changed meanwhile: showing the newest version' : `Not changed: ${r.message}`;
      if (r.code === 'head_moved') await read(); else draw();
      return null;
    }
    if (isObj(r.payload['spec'])) spec = r.payload['spec'] as unknown as AppSpec;
    notice = null;
    initFilters();
    invalidate();
    const added = Array.isArray(r.payload['added']) ? (r.payload['added'] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    if (added[0] !== undefined) select(added[0]);
    draw();
    queryAll();
    return added;
  };

  const select = (id: string | null): void => {
    selected = id;
    if (id !== null && grants.has('selection.chip')) say('selection.set', { anchors: [{ kind: 'element', id }] });
  };

  /** A move or a resize: the box follows the pointer (CSSOM), and ONE op is sent when the pointer comes up. */
  const startDrag = (e: PointerEvent, c: AppComponent, kind: 'move' | 'resize', cell: HTMLElement): void => {
    if (!editing() || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    // preventDefault keeps the page from selecting text, and in Firefox and WebKit it also keeps focus out of this
    // frame. The host takes a change only from a gesture IN this frame (focus here), so focus moves here explicitly.
    ((cell.closest('.wk-cell') as HTMLElement | null) ?? cell).focus({ preventScroll: true });
    const n = index.get(c.id)!;
    const s = cellSize();
    const start = { x: e.clientX, y: e.clientY };
    let box: Box = { ...c.box };
    let moved = false;
    cell.setPointerCapture(e.pointerId);
    cell.classList.add('is-dragging');
    const onMove = (ev: PointerEvent): void => {
      const dx = Math.round((ev.clientX - start.x) / s.col);
      const dy = Math.round((ev.clientY - start.y) / s.row);
      if (dx === 0 && dy === 0 && !moved) return;
      moved = true;
      box = kind === 'move'
        ? { ...c.box, x: Math.min(12 - c.box.w, Math.max(0, c.box.x + dx)), y: Math.max(0, c.box.y + dy) }
        : { ...c.box, w: Math.min(12 - c.box.x, Math.max(1, c.box.w + dx)), h: Math.min(50, Math.max(1, c.box.h + dy)) };
      sheet.place(n, box);
    };
    const onUp = (): void => {
      cell.removeEventListener('pointermove', onMove);
      cell.removeEventListener('pointerup', onUp);
      cell.removeEventListener('pointercancel', onUp);
      cell.classList.remove('is-dragging');
      const changed = kind === 'move' ? box.x !== c.box.x || box.y !== c.box.y : box.w !== c.box.w || box.h !== c.box.h;
      if (!moved || !changed) { sheet.place(n, c.box); if (!moved) { select(c.id); draw(); } return; }
      void edit([kind === 'move' ? { op: 'component-move', id: c.id, x: box.x, y: box.y } : { op: 'component-resize', id: c.id, w: box.w, h: box.h }]);
    };
    cell.addEventListener('pointermove', onMove);
    cell.addEventListener('pointerup', onUp);
    cell.addEventListener('pointercancel', onUp);
  };

  const nextRow = (): number => components().reduce((m, c) => Math.max(m, c.box.y + c.box.h), 0);

  /** A palette tile: a click adds below everything; a drag shows where it lands and adds it there. */
  const startAdd = (e: PointerEvent, type: AppComponentType, tile: HTMLElement): void => {
    if (!editing() || e.button !== 0 || grid === null || pageId === null) return;
    e.preventDefault();
    tile.focus({ preventScroll: true }); // as startDrag: the gesture is in this frame
    const size = DEFAULT_SIZE[type];
    const drop = el('div', 'wk-drop wk-c9999');
    drop.setAttribute('data-testid', 'apps-drop-target');
    let at: { x: number; y: number } | null = null;
    tile.setPointerCapture(e.pointerId);
    const onMove = (ev: PointerEvent): void => {
      const r = grid!.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top) { drop.remove(); at = null; return; }
      at = cellAt(ev.clientX, ev.clientY);
      at.x = Math.min(at.x, 12 - size.w);
      sheet.place(9999, { x: at.x, y: at.y, w: size.w, h: size.h });
      if (drop.parentNode === null) grid!.append(drop);
    };
    const onUp = (ev: PointerEvent): void => {
      tile.removeEventListener('pointermove', onMove);
      tile.removeEventListener('pointerup', onUp);
      tile.removeEventListener('pointercancel', onUp);
      drop.remove();
      const travelled = Math.abs(ev.clientX - e.clientX) + Math.abs(ev.clientY - e.clientY) > 6;
      if (travelled && at === null) return; // dropped outside the canvas: nothing added
      const box = at ?? { x: 0, y: nextRow() };
      void edit([{ op: 'component-add', page: pageId!, type, box: { x: box.x, y: box.y, w: Math.min(size.w, 12 - box.x), h: size.h } }]);
    };
    tile.addEventListener('pointermove', onMove);
    tile.addEventListener('pointerup', onUp);
    tile.addEventListener('pointercancel', onUp);
  };

  /**
   * A typed field commits on every keystroke, while focus is still in this frame (the host's edit burst makes the
   * keystrokes one version), and on Enter and change. The host takes a change only from a gesture in this frame, and
   * a commit made on the blur caused by a click in studio's own chrome arrives after focus has left (Firefox fires no
   * event the host could time that by), so nothing waits for the blur.
   */
  const typed = (input: HTMLInputElement | HTMLTextAreaElement, commit: () => void, multiline = false): void => {
    let sent = input.value;
    const go = (): void => {
      if (input.value === sent) return;
      sent = input.value;
      commit();
    };
    input.addEventListener('input', go);
    input.addEventListener('change', go);
    input.addEventListener('keydown', (e: Event) => {
      const k = e as KeyboardEvent;
      if (k.key === 'Enter' && (!multiline || k.metaKey || k.ctrlKey)) { k.preventDefault(); go(); }
    });
  };

  const prop = (label: string, input: HTMLElement): HTMLElement => {
    const row = el('label', 'wk-prop');
    row.append(el('span', 'wk-prop-label', label), input);
    return row;
  };
  const textProp = (c: AppComponent, label: string, name: string, value: string | undefined, max: number, area = false): HTMLElement => {
    const input = area ? el('textarea', 'wk-input') : el('input', 'wk-input');
    input.value = value ?? '';
    input.maxLength = max;
    input.setAttribute('data-prop', name);
    typed(input, () => { void edit([{ op: 'component-set', id: c.id, prop: name, value: input.value }]); }, area);
    return prop(label, input);
  };
  const selectProp = (c: AppComponent, label: string, name: string, value: string, options: readonly string[], op: 'set' | 'bind' = 'set'): HTMLElement => {
    const s = el('select', 'wk-input');
    for (const o of options) { const opt = el('option', undefined, o); opt.value = o; s.append(opt); }
    s.value = value;
    s.setAttribute('data-prop', name);
    s.addEventListener('change', () => { void edit([op === 'bind' ? { op: 'bind', id: c.id, query: s.value } : { op: 'component-set', id: c.id, prop: name, value: s.value }]); });
    return prop(label, s);
  };
  const checkProp = (c: AppComponent, label: string, name: string, value: boolean): HTMLElement => {
    const i = el('input', 'wk-check');
    i.type = 'checkbox';
    i.checked = value;
    i.setAttribute('data-prop', name);
    i.addEventListener('change', () => { void edit([{ op: 'component-set', id: c.id, prop: name, value: i.checked }]); });
    return prop(label, i);
  };
  const numProp = (c: AppComponent, label: string, name: 'x' | 'y' | 'w' | 'h', min: number, max: number): HTMLElement => {
    const i = el('input', 'wk-input wk-input--num');
    i.type = 'number';
    i.min = String(min); i.max = String(max);
    i.value = String(name === 'x' ? c.box.x + 1 : name === 'y' ? c.box.y + 1 : c.box[name]);
    i.setAttribute('data-prop', `box-${name}`);
    typed(i, () => {
      const v = Math.round(Number(i.value));
      if (!Number.isFinite(v)) return;
      if (name === 'x' || name === 'y') {
        const x = name === 'x' ? Math.min(12 - c.box.w, Math.max(0, v - 1)) : c.box.x;
        const y = name === 'y' ? Math.max(0, v - 1) : c.box.y;
        void edit([{ op: 'component-move', id: c.id, x, y }]);
      } else {
        const w = name === 'w' ? Math.min(12 - c.box.x, Math.max(1, v)) : c.box.w;
        const h = name === 'h' ? Math.min(50, Math.max(1, v)) : c.box.h;
        void edit([{ op: 'component-resize', id: c.id, w, h }]);
      }
    });
    return prop(label, i);
  };

  const drawProps = (c: AppComponent): HTMLElement => {
    const box = el('aside', 'wk-props');
    box.setAttribute('aria-label', 'Properties');
    box.setAttribute('data-testid', 'apps-properties');
    box.append(el('h3', 'wk-props-title', 'Properties'));
    box.append(el('p', 'wk-muted', `${c.type === 'chart' ? `${c.chart} chart` : c.type} · ${c.id}`));
    box.append(textProp(c, 'Title', 'title', c.title, 120));
    const queries = (spec?.queries ?? []).map((q) => q.id);
    const cols = (q: string): string[] => spec?.queries.find((x) => x.id === q)?.output.map((o) => o.name) ?? [];
    if (c.type === 'table' || c.type === 'chart' || c.type === 'kpi') box.append(selectProp(c, 'Data', 'query', c.data.query, queries, 'bind'));
    if (c.type === 'table') {
      const i = el('input', 'wk-input wk-input--num');
      i.type = 'number';
      i.min = '5'; i.max = '500';
      i.value = String(c.pageSize ?? 10);
      i.setAttribute('data-prop', 'pageSize');
      typed(i, () => { const v = Math.round(Number(i.value)); if (Number.isFinite(v)) void edit([{ op: 'component-set', id: c.id, prop: 'pageSize', value: Math.min(500, Math.max(5, v)) }]); });
      box.append(prop('Rows per page', i));
    }
    if (c.type === 'chart') {
      box.append(selectProp(c, 'Chart', 'chart', c.chart, ['bar', 'line', 'area', 'pie']));
      box.append(selectProp(c, 'Category', 'x', c.x, cols(c.data.query)));
      if (c.chart === 'bar' || c.chart === 'area') box.append(checkProp(c, 'Stacked', 'stacked', c.stacked === true));
    }
    if (c.type === 'kpi') {
      box.append(selectProp(c, 'Figure', 'value', c.value, cols(c.data.query)));
      box.append(textProp(c, 'Caption', 'caption', c.caption, 120));
    }
    if (c.type === 'text') {
      box.append(textProp(c, 'Text', 'text', c.text, 4_000, true));
      box.append(selectProp(c, 'Style', 'style', c.style ?? 'body', ['heading', 'body', 'caption']));
    }
    if (c.type === 'filter') box.append(textProp(c, 'Label', 'label', c.label, 120));
    if (c.type === 'button') box.append(textProp(c, 'Label', 'label', c.action.label, 60));
    if (c.type === 'link') box.append(textProp(c, 'Label', 'label', c.label, 120));
    if (c.type === 'image') box.append(textProp(c, 'Description', 'alt', c.alt, 300));
    const place = el('div', 'wk-prop-box');
    place.append(numProp(c, 'Column', 'x', 1, 12), numProp(c, 'Row', 'y', 1, 1000), numProp(c, 'Width', 'w', 1, 12), numProp(c, 'Height', 'h', 1, 50));
    box.append(place);
    box.append(checkProp(c, 'Hide on phones', 'hideOnPhone', c.hideOnPhone === true));
    const rm = el('button', 'wk-btn wk-btn--danger', 'Delete this component');
    rm.type = 'button';
    rm.setAttribute('data-testid', 'apps-remove');
    rm.addEventListener('click', () => { const id = c.id; selected = null; void edit([{ op: 'component-remove', id }]); });
    box.append(rm);
    return box;
  };

  const drawPalette = (): HTMLElement => {
    const box = el('aside', 'wk-palette');
    box.setAttribute('aria-label', 'Components');
    box.append(el('h3', 'wk-props-title', 'Components'));
    box.append(el('p', 'wk-muted', 'Drag onto the canvas, or click to add'));
    const tiles = el('div', 'wk-tiles');
    for (const t of PALETTE) {
      const b = el('button', 'wk-tile', t.label);
      b.type = 'button';
      b.setAttribute('data-palette', t.type);
      b.addEventListener('pointerdown', (e) => startAdd(e, t.type, b));
      // Enter or Space on a focused tile (a click with no pointer behind it) adds it below everything.
      b.addEventListener('click', (e) => {
        if (e.detail !== 0 || !editing() || pageId === null) return;
        const size = DEFAULT_SIZE[t.type];
        void edit([{ op: 'component-add', page: pageId, type: t.type, box: { x: 0, y: nextRow(), w: size.w, h: size.h } }]);
      });
      tiles.append(b);
    }
    box.append(tiles);
    return box;
  };

  // ── the whole surface ───────────────────────────────────────────────────────────────────
  const draw = (): void => {
    // A Properties field being typed in keeps its focus, its caret and what is typed in it across the redraw.
    const was = document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLTextAreaElement ? document.activeElement : null;
    const keep = was !== null && root.contains(was) ? { prop: was.getAttribute('data-prop'), value: was.value, at: (() => { try { return [was.selectionStart, was.selectionEnd] as const; } catch { return null; } })() } : null;
    drawNow();
    if (keep === null || keep.prop === null) return;
    const now = [...root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-prop]')].find((e) => e.getAttribute('data-prop') === keep.prop);
    if (now === undefined) return;
    now.value = keep.value;
    now.focus({ preventScroll: true });
    try { if (keep.at !== null && keep.at[0] !== null) now.setSelectionRange(keep.at[0], keep.at[1]); } catch { /* a number input has no caret to set */ }
  };
  const drawNow = (): void => {
    root.replaceChildren();
    bodies.clear();
    index.clear();
    // Every draw rebuilds the runtime's rules from scratch: nothing of the last page or version (a series colour, a
    // hidden-on-phones rule) carries over to the next.
    sheet.reset();
    applyTheme(undefined);
    root.setAttribute('data-mode', editing() ? 'edit' : 'preview');
    root.setAttribute('data-surface', surface);
    if (spec === null) { root.append(el('p', 'wk-empty', notice ?? 'Loading the app…')); return; }
    if (editing()) root.append(drawPalette());
    const main = el('main', 'wk-main');
    const nav = el('nav', 'wk-pages');
    nav.setAttribute('aria-label', 'Pages');
    for (const pg of spec.pages) {
      const b = el('button', pg.id === pageId ? 'wk-page is-on' : 'wk-page', lineOf(pg.title, 80));
      b.type = 'button';
      b.setAttribute('aria-current', pg.id === pageId ? 'page' : 'false');
      b.addEventListener('click', () => { if (pageId !== pg.id) { pageId = pg.id; selected = null; draw(); queryAll(); } });
      nav.append(b);
    }
    main.append(nav);
    noticeEl = el('p', 'wk-notice', notice ?? '');
    noticeEl.setAttribute('data-testid', 'apps-notice');
    noticeEl.setAttribute('aria-live', 'polite');
    noticeEl.hidden = notice === null;
    main.append(noticeEl);
    if (readonly && mode === 'edit') main.append(el('p', 'wk-notice', 'A chat turn is changing this app: it is read-only until the turn ends'));
    grid = el('div', 'wk-grid');
    const list = components();
    const order = [...list].sort((a, b) => a.box.y - b.box.y || a.box.x - b.box.x);
    list.forEach((c, i) => {
      index.set(c.id, i);
      sheet.place(i, c.box);
      sheet.phoneOrder(i, order.indexOf(c), c.hideOnPhone === true);
      if (c.type === 'chart') c.series.slice(0, 12).forEach((s, k) => sheet.seriesColour(i, k, s.color));
      const cell = el('section', `wk-cell wk-cell--${c.type} wk-c${i}${c.id === selected && editing() ? ' is-selected' : ''}`);
      cell.setAttribute('data-component', c.id);
      if (c.title !== undefined && c.type !== 'text') cell.append(el('h3', 'wk-cell-title', lineOf(c.title, 120)));
      const body = el('div', 'wk-cell-body');
      bodies.set(c.id, body);
      drawBody(c, body);
      cell.append(body);
      if (editing()) {
        cell.classList.add('is-editable');
        cell.tabIndex = 0;
        cell.setAttribute('aria-label', `${c.type === 'chart' ? `${c.chart} chart` : c.type} ${lineOf(c.title ?? c.id, 80)}: Enter to select`);
        cell.append(el('span', 'wk-tag', `${c.type === 'chart' ? `${c.chart} chart` : c.type}${'data' in c && c.data !== undefined ? ` · ${(c.data as { query: string }).query}` : ''}`));
        const handle = el('span', 'wk-handle');
        handle.setAttribute('aria-hidden', 'true');
        handle.addEventListener('pointerdown', (e) => startDrag(e, c, 'resize', handle));
        cell.append(handle);
        cell.addEventListener('pointerdown', (e) => {
          if ((e.target as HTMLElement).closest('input, select, textarea, button, .wk-handle') !== null) return;
          startDrag(e, c, 'move', cell);
        });
      }
      grid!.append(cell);
    });
    if (list.length === 0) grid.append(el('p', 'wk-empty', editing() ? 'Drag a component here from the palette' : 'This page is empty'));
    main.append(grid);
    root.append(main);
    const sel = editing() && selected !== null ? list.find((c) => c.id === selected) : undefined;
    if (sel !== undefined) root.append(drawProps(sel));
  };

  // ── keys: delete, undo, redo, Escape ────────────────────────────────────────────────────
  function onKey(e: KeyboardEvent): void {
    if (port === null || spec === null) return;
    // Enter or Space on a focused component selects it (its Properties open) without a pointer.
    const cell = (e.target as HTMLElement | null)?.closest?.('.wk-cell.is-editable') as HTMLElement | null;
    if (cell !== null && (e.key === 'Enter' || e.key === ' ') && e.target === cell) {
      e.preventDefault();
      const id = cell.getAttribute('data-component');
      if (id !== null) { select(id); draw(); (root.querySelector(`.wk-props input, .wk-props select`) as HTMLElement | null)?.focus(); }
      return;
    }
    const inField = (e.target as HTMLElement | null)?.closest('input, textarea, select') != null;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && !e.altKey && e.key.toLowerCase() === 'z' && !inField && editing()) {
      e.preventDefault();
      void request('app.history', { move: e.shiftKey ? 'redo' : 'undo', base: version }).then((r) => {
        if (r.ok) return;
        notice = r.message;
        if (r.code === 'head_moved') void read(); else draw();
      });
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && !inField && editing() && selected !== null) {
      e.preventDefault();
      const id = selected;
      selected = null;
      void edit([{ op: 'component-remove', id }]);
      return;
    }
    if (e.key === 'Escape' && selected !== null && !inField) { selected = null; draw(); }
  }
  document.addEventListener('keydown', onKey);

  root.append(el('p', 'wk-empty', 'Loading the app…'));
  announceReady(cfg.editor, cfg.surfaces);
}
