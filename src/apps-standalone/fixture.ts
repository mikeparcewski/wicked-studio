import type { AppCell, AppFilterComponent, AppSpec } from '../api/types.js';
import { sampleAppData } from '../editors/apps/appData.js';
import { ENVELOPE, PROTOCOL } from '../plugins/_shared/v2.js';
import { cellText } from '../plugins/wicked-apps/runtime/format.js';
import { coerceParam } from '../plugins/wicked-apps/runtime/runtime.js';

interface FixtureInput { spec: AppSpec; cards: Record<string, unknown> | Array<{ action: string }> }
export interface Fixture {
  ready: boolean;
  errors: string[];
  pages(): string[];
  filters(page: string): Array<{ id: string; values: string[] }>;
  actions(page: string): string[];
  show(page: string): Promise<void>;
  setFilter(id: string, value: string): Promise<void>;
  prepare(actionId: string): Promise<void>;
  closeCard(): Promise<void>;
}

declare global {
  interface Window {
    wickedAppsStandalone: { boot(port: MessagePort, hello: Record<string, unknown>): void };
    __wkFixture: Fixture;
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));

/** Generate the same cells for a query and its sorted parameter pairs. */
export async function fixtureRows(spec: AppSpec, query: string, params: Record<string, unknown>) {
  const entries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const key = JSON.stringify([query, entries]);
  let seed = 0;
  for (const c of key) seed = (Math.imul(seed, 31) + c.charCodeAt(0)) >>> 0;
  const q = spec.queries.find((q) => q.id === query);
  const words = entries.map(([, v]) => v).filter((v): v is string => typeof v === 'string').join(' ');
  const rows = [0, 1, 2].map((i) => (q?.output ?? []).map((c): AppCell => {
    const n = (seed % 1_000) + i + 1;
    switch (c.type) {
      case 'number': return n / 10;
      case 'integer': return n;
      case 'boolean': return n % 2 === 0;
      case 'date': return `2026-10-${String(10 + i).padStart(2, '0')}`;
      case 'datetime': return `2026-10-${String(10 + i).padStart(2, '0')}T09:30:00Z`;
      default: return `${words} ${c.name} ${n}`.trim();
    }
  }));
  return sampleAppData(() => spec, { rows: { [query]: rows }, viewer: null }).query(1, query, params);
}

/** A local protocol host. Its only fetch is fixture.json; it never prepares or runs a source operation. */
export async function startFixture(): Promise<void> {
  // Pin only this fixture page; the published runtime keeps the viewer's clock.
  const instant = Date.parse('2026-10-15T12:00:00Z');
  window.Date = new Proxy(Date, {
    construct: (date, args) => Reflect.construct(date, args.length === 0 ? [instant] : args),
    apply: (date) => new date(instant).toString(),
    get: (date, key, receiver) => key === 'now' ? () => instant : Reflect.get(date, key, receiver),
  });
  let input: FixtureInput;
  const filterValues = new Map<string, string | { from: string; to: string }>();
  const queryValues = new Map<string, string[]>();
  let port: MessagePort;
  let activity = 0;
  let reading = 0;
  let seq = 0;
  let card: HTMLElement | null = null;
  const pings = new Map<string, () => void>();
  const recordError = (e: unknown): void => {
    const message = e instanceof Error ? e.message : String(e);
    if (!fixture.errors.includes(message)) fixture.errors.push(message);
  };
  const checked = async (work: () => Promise<void>): Promise<void> => {
    try { await work(); } catch (e) { recordError(e); throw e; }
  };
  const page = (id: string) => {
    const pg = input.spec.pages.find((p) => p.id === id);
    if (pg === undefined) throw new Error(`This app has no page ${id}`);
    return pg;
  };
  const filterNode = (id: string): HTMLElement => {
    const node = [...document.querySelectorAll<HTMLElement>('[data-component]')].find((n) => n.dataset['component'] === id);
    if (node === undefined) throw new Error(`This page has no filter ${id}`);
    return node;
  };
  const values = (c: AppFilterComponent): string[] => {
    if (c.filter === 'search') return ['fixture'];
    if (c.filter === 'date-range') return ['2026-10-01/2026-10-31'];
    if (c.options?.kind === 'values') return c.options.values.map((v) => v.value);
    return [...(queryValues.get(c.id) ?? [])];
  };
  // Populate every page from the same sample responses the runtime receives, before filters() is called.
  const refreshOptions = async (): Promise<void> => {
    for (const pg of input.spec.pages) for (const c of pg.components) {
      if (c.type !== 'filter' || c.options?.kind !== 'query') continue;
      const options = c.options;
      const q = input.spec.queries.find((q) => q.id === options.query.query);
      const params: Record<string, unknown> = {};
      for (const [name, ref] of Object.entries(options.query.params ?? {})) {
        const [kind, id, part] = ref.split('.');
        const filter = kind === 'filter' && id !== undefined ? filterValues.get(id) : undefined;
        const v = typeof filter === 'string' ? (part === undefined ? filter : undefined)
          : part === 'from' ? filter?.from : part === 'to' ? filter?.to : undefined;
        const props = q?.params?.properties ?? {};
        if (v !== undefined && v !== '') params[name] = coerceParam(Object.hasOwn(props, name) ? props[name] : undefined, v);
      }
      const rows = await fixtureRows(input.spec, options.query.query, params);
      if ('error' in rows) throw new Error(rows.message);
      const at = rows.columns.findIndex((col) => col.name === options.value);
      queryValues.set(c.id, rows.rows.slice(0, 200).map((r) => cellText(r[at], undefined, 'en')).filter((v) => v !== ''));
    }
  };
  const ping = (): Promise<void> => new Promise((resolve, reject) => {
    const id = `fixture-${++seq}`;
    const timer = setTimeout(() => { pings.delete(id); reject(new Error('The runtime did not answer')); }, 5_000);
    pings.set(id, () => { clearTimeout(timer); resolve(); });
    port.postMessage({ p: PROTOCOL, v: ENVELOPE, type: 'host.ping', id, payload: {} });
  });
  // A port barrier lets the runtime consume replies and their microtasks; two frames allow a paint. Repeat if
  // processing the barrier triggered another query, so callers never capture a loading or stale result.
  const settled = async (): Promise<void> => {
    const until = performance.now() + 5_000;
    let stable = 0;
    while (stable < 2) {
      const before = activity;
      await ping();
      await frame();
      await frame();
      stable = reading === 0 && before === activity ? stable + 1 : 0;
      if (performance.now() > until) throw new Error('The fixture did not finish rendering');
    }
    for (const e of document.querySelectorAll('.wk-error')) if (e.textContent) recordError(e.textContent);
  };
  const drawCard = (action: string): void => {
    if (!input.spec.actions.some((a) => a.id === action)) throw new Error(`This app has no action ${action}`);
    const given = Array.isArray(input.cards) ? input.cards.find((c) => c.action === action) : Object.hasOwn(input.cards, action) ? input.cards[action] : undefined;
    if (given === undefined) throw new Error(`The fixture has no card for ${action}`);
    card?.remove();
    card = document.createElement('div');
    card.className = 'wk-fixture-card';
    const panel = document.createElement('section');
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', `Prepare ${action}`);
    panel.setAttribute('data-testid', 'apps-card');
    const title = document.createElement('h2');
    title.textContent = `Prepare ${action}`;
    const text = document.createElement('pre');
    text.textContent = typeof given === 'string' ? given : JSON.stringify(given, null, 2);
    const close = document.createElement('button');
    close.type = 'button';
    close.textContent = 'Close';
    close.addEventListener('click', () => { void fixture.closeCard(); });
    panel.append(title, text, close);
    card.append(panel);
    document.body.append(card);
    close.focus();
  };
  const fixture: Fixture = {
    ready: false, errors: [],
    pages: () => input.spec.pages.map((p) => p.id),
    filters: (id) => page(id).components.filter((c): c is AppFilterComponent => c.type === 'filter').map((c) => ({ id: c.id, values: values(c) })),
    actions: (id) => [...new Set(page(id).components.flatMap((c) => c.type === 'button' ? [c.action.action] : c.type === 'form' ? [c.submit.action] : c.type === 'table' ? (c.rowActions ?? []).map((a) => a.action) : []))],
    show: (id) => checked(async () => {
      const index = input.spec.pages.indexOf(page(id));
      const button = document.querySelectorAll<HTMLButtonElement>('.wk-page')[index];
      if (button === undefined) throw new Error(`The runtime did not draw page ${id}`);
      button.click();
      await settled();
    }),
    setFilter: (id, value) => checked(async () => {
      const pg = input.spec.pages.find((p) => p.components.some((c) => c.id === id && c.type === 'filter'));
      if (pg === undefined) throw new Error(`This app has no filter ${id}`);
      await fixture.show(pg.id);
      const node = filterNode(id);
      const select = node.querySelector('select');
      if (select !== null) {
        if (![...select.options].some((o) => o.value === value)) throw new Error(`This filter has no value ${value}`);
        select.value = value;
        filterValues.set(id, value);
        select.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const fields = [...node.querySelectorAll('input')];
        const parts = fields.length === 2 ? value.split('/') : [value];
        if (fields.length === 0 || parts.length !== fields.length) throw new Error('A date range needs from/to');
        for (const [i, field] of fields.entries()) {
          field.value = parts[i]!;
          field.dispatchEvent(new Event(field.type === 'search' ? 'input' : 'change', { bubbles: true }));
        }
        filterValues.set(id, fields.length === 2 ? { from: fields[0]!.value, to: fields[1]!.value } : fields[0]!.value);
        // The runtime's search input debounces reads for 300 ms.
        if (fields[0]?.type === 'search') await new Promise((resolve) => setTimeout(resolve, 310));
      }
      await refreshOptions();
      await settled();
    }),
    prepare: (action) => checked(async () => { drawCard(action); await settled(); }),
    closeCard: () => checked(async () => { card?.remove(); card = null; await settled(); }),
  };
  window.__wkFixture = fixture;
  window.addEventListener('error', (e) => recordError(e.message));
  window.addEventListener('unhandledrejection', (e) => recordError(e.reason));
  try {
    const response = await fetch('./fixture.json', { credentials: 'omit', redirect: 'error' });
    if (!response.ok) throw new Error('The fixture could not be read');
    input = await response.json() as FixtureInput;
    for (const pg of input.spec.pages) for (const c of pg.components) {
      if (c.type !== 'filter') continue;
      if (c.filter === 'date-range') {
        const days = isObj(c.default) && Number.isInteger(c.default['lastDays']) ? Math.min(3_650, Math.max(1, c.default['lastDays'] as number)) : 30;
        filterValues.set(c.id, { from: new Date(instant - days * 86_400_000).toISOString().slice(0, 10), to: new Date(instant).toISOString().slice(0, 10) });
      } else filterValues.set(c.id, typeof c.default === 'string' ? c.default : '');
    }
    await refreshOptions();
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = (m: MessageEvent): void => {
      const d: unknown = m.data;
      if (!isObj(d) || d['p'] !== PROTOCOL || d['v'] !== ENVELOPE) return;
      if (typeof d['re'] === 'string') { pings.get(d['re'])?.(); pings.delete(d['re']); return; }
      if (typeof d['id'] !== 'string') return;
      const id = d['id'];
      const payload = isObj(d['payload']) ? d['payload'] : {};
      const reply = (payload: unknown, error?: { code: string; message: string }): void => {
        port.postMessage({ p: PROTOCOL, v: ENVELOPE, re: id, ok: error === undefined, payload, ...(error === undefined ? {} : { error }) });
      };
      activity += 1;
      switch (d['type']) {
        case 'artifact.read': reply({ version: 1, content: { type: 'app', spec: input.spec, readonly: true } }); return;
        case 'data.query': {
          reading += 1;
          void fixtureRows(input.spec, String(payload['query']), isObj(payload['params']) ? payload['params'] : {}).then((r) => {
            if ('error' in r) { recordError(r.message); reply({}, { code: r.error, message: r.message }); }
            else reply(r);
          }).catch((e: unknown) => { recordError(e); reply({}, { code: 'unavailable', message: 'The fixture query failed' }); }).finally(() => { reading -= 1; activity += 1; });
          return;
        }
        case 'data.action':
          try { drawCard(String(payload['action'])); reply({ state: 'cancelled' }); }
          catch (e) { recordError(e); reply({}, { code: 'refused', message: String(e) }); }
          return;
        default: reply({}, { code: 'unsupported', message: 'The fixture only reads and prepares' }); return;
      }
    };
    window.wickedAppsStandalone.boot(channel.port2, {
      protocol: 2, surface: 'full', size: 'full', grants: ['artifact.read', 'data.read', 'data.write'],
      app: { framed: false, mode: 'preview', url: {} }, prefs: { locale: 'en' }, theme: {},
    });
    await settled();
    if (document.querySelector('.wk-page') === null) throw new Error('The runtime did not draw a page');
    fixture.ready = fixture.errors.length === 0;
  } catch (e) { recordError(e); }
}
