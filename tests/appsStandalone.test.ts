import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { externalReferences } from '../scripts/build-editors.mjs';
import type { AppSpec } from '../src/api/types.js';
import { fixtureRows, startFixture } from '../src/apps-standalone/fixture.js';
import { boot } from '../src/plugins/wicked-apps/runtime/standalone.js';

const SPEC: AppSpec = {
  schema: 'wicked.apps/v1', name: 'Fixture app', linkHosts: [],
  pages: [
    { id: 'first', title: 'First page', components: [
      { id: 'search', type: 'filter', filter: 'search', box: { x: 0, y: 0, w: 4, h: 1 } },
      { id: 'pick', type: 'filter', filter: 'select', options: { kind: 'values', values: [{ value: 'open' }, { value: 'closed' }] }, box: { x: 4, y: 0, w: 4, h: 1 } },
      { id: 'dates', type: 'filter', filter: 'date-range', box: { x: 8, y: 0, w: 4, h: 1 } },
      { id: 'rows', type: 'table', data: { query: 'tickets', params: { search: 'filter.search', status: 'filter.pick' } }, rowActions: [{ label: 'Assign', action: 'assign', params: { id: 'row.id' } }], box: { x: 0, y: 1, w: 12, h: 5 } },
    ] },
    { id: 'second', title: 'Second page', components: [{ id: 'note', type: 'text', text: 'Second page content', box: { x: 0, y: 0, w: 12, h: 1 } }] },
  ],
  queries: [{ id: 'tickets', source: 'source', kind: 'sql', output: [{ name: 'id', type: 'integer' }, { name: 'subject', type: 'string' }] }],
  actions: [{ id: 'assign', kind: 'row-write', source: 'writer', table: 'public.tickets', op: 'update', key: { id: { kind: 'param', name: 'id' } }, set: { owner: { kind: 'viewer', claim: 'email' } } }],
};
const CARD = { action: 'assign', kind: 'row-write', statement: 'UPDATE ONLY public.tickets SET owner = $1 WHERE id = $2', columns: [{ name: 'owner', value: '<b>viewer@example.com</b>', from: 'viewer', label: 'your sign-in' }] };
const HELLO = { protocol: 2, surface: 'full', size: 'full', grants: ['artifact.read', 'data.read', 'data.write'], app: { framed: false, mode: 'preview', url: {} }, prefs: { locale: 'en' }, theme: {} };
const ports: MessagePort[] = [];
let out: string;

beforeAll(() => {
  out = mkdtempSync(join(process.cwd(), 'tests/.apps-standalone-'));
  execFileSync(process.execPath, ['scripts/build-editors.mjs', out], { cwd: process.cwd(), timeout: 180_000 });
}, 180_000);
afterAll(() => rmSync(out, { recursive: true, force: true }));
beforeEach(() => {
  // startFixture pins the page's Date; restore the test realm after every fixture.
  vi.stubGlobal('Date', Date);
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  const style = document.createElement('style');
  style.id = 'wk-apps-sheet';
  // jsdom cannot parse the template's nested phone rules; an empty sheet still exercises all CSSOM writes.
  document.head.append(style);
  window.wickedAppsStandalone = { boot };
});
afterEach(() => {
  for (const p of ports.splice(0)) p.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function host(start: typeof boot): { port: MessagePort; seen: Array<Record<string, unknown>> } {
  const channel = new MessageChannel();
  ports.push(channel.port1, channel.port2);
  const seen: Array<Record<string, unknown>> = [];
  channel.port1.onmessage = (m) => {
    const d = m.data as Record<string, unknown>;
    seen.push(d);
    if (typeof d['id'] !== 'string') return;
    const payload = d['type'] === 'artifact.read'
      ? { version: 1, content: { type: 'app', spec: SPEC, readonly: true } }
      : d['type'] === 'data.query' ? { columns: SPEC.queries[0]!.output, rows: [[7, 'Ticket seven']] } : { state: 'cancelled' };
    channel.port1.postMessage({ p: 'wicked.editor', v: 1, re: d['id'], ok: true, payload });
  };
  start(channel.port2, HELLO);
  return { port: channel.port1, seen };
}

async function fixture(cards: unknown = { assign: CARD }, spec = SPEC): Promise<void> {
  const Channel = MessageChannel;
  vi.stubGlobal('MessageChannel', class extends Channel {
    constructor() { super(); ports.push(this.port1, this.port2); }
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ spec: structuredClone(spec), cards }) }));
  await startFixture();
  expect(window.__wkFixture.errors).toEqual([]);
  expect(window.__wkFixture.ready).toBe(true);
}

describe('standalone port entry', () => {
  it('emits an IIFE global with boot, renders the first page, queries, answers ping and handles actions like the frame entry', async () => {
    const js = readFileSync(join(out, 'apps-standalone/runtime.js'), 'utf8');
    const standalone = new Function(`${js}; return typeof wickedAppsStandalone === 'undefined' ? undefined : wickedAppsStandalone;`)() as typeof window.wickedAppsStandalone | undefined;
    expect(standalone?.boot).toBeTypeOf('function');
    const listen = vi.spyOn(window, 'addEventListener');
    const clock = Date;
    const { port, seen } = host(standalone!.boot);
    expect(listen.mock.calls.some(([name]) => name === 'message')).toBe(false);
    await vi.waitFor(() => expect(document.querySelector('.wk-table')?.textContent).toContain('Ticket seven'));
    expect(Date).toBe(clock);
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('First page');
    port.postMessage({ p: 'wicked.editor', v: 1, type: 'host.ping', id: 'ping', payload: {} });
    await vi.waitFor(() => expect(seen).toContainEqual({ p: 'wicked.editor', v: 1, re: 'ping', ok: true, payload: {} }));
    (document.querySelector('[data-action="assign"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(seen).toContainEqual(expect.objectContaining({ type: 'data.action', payload: { action: 'assign', params: { id: 7 } } })));
    port.postMessage({ p: 'wicked.editor', v: 1, type: 'host.teardown', payload: {} });
    await vi.waitFor(() => expect(document.querySelector('.wk-app')?.textContent).toBe('Closed'));
  });

  it('accepts the site host stylesheet link without requiring the frame template id', async () => {
    const style = document.querySelector('style')!;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './runtime.css';
    Object.defineProperty(link, 'sheet', { value: style.sheet });
    style.remove();
    document.head.append(link);
    host(boot);
    await vi.waitFor(() => expect(document.querySelector('.wk-table')?.textContent).toContain('Ticket seven'));
  });

  it('ships only local fixture resources and the runtime stylesheet alongside the existing editors', () => {
    const dir = join(out, 'apps-standalone');
    expect(readdirSync(dir).sort()).toEqual(['fixture.html', 'fixture.js', 'runtime.css', 'runtime.js']);
    const html = readFileSync(join(dir, 'fixture.html'), 'utf8');
    expect(externalReferences(html)).toEqual([]);
    const resources = [...html.matchAll(/(?:src|href)="([^"]+)"/gu)].map((m) => m[1]);
    expect(resources).toEqual(['./runtime.css', './runtime.js', './fixture.js']);
    expect(readFileSync(join(dir, 'runtime.css'), 'utf8')).toContain('.wk-app');
    expect(readFileSync(join(out, 'editors/wicked-apps/index.html'), 'utf8')).toContain('plugin.ready');
  });
});

describe('publish fixture host', () => {
  it('seeds sample rows by query and parameters, independent of order and prior calls', async () => {
    const first = await fixtureRows(SPEC, 'tickets', { search: 'open', status: 'urgent', n: 2 });
    expect(first).toEqual(await fixtureRows(structuredClone(SPEC), 'tickets', { n: 2, status: 'urgent', search: 'open' }));
    expect(first).not.toEqual(await fixtureRows(SPEC, 'tickets', { search: 'closed', status: 'urgent', n: 2 }));
    expect('rows' in first && first.rows).toHaveLength(3);
    expect(await fixtureRows(SPEC, 'missing', {})).toMatchObject({ error: 'refused' });
  });

  it('pins default date ranges and date-bound query rows to the fixture clock', async () => {
    const future = Date.parse('2040-06-15T00:00:00Z');
    vi.stubGlobal('Date', new Proxy(Date, {
      construct: (date, args) => Reflect.construct(date, args.length === 0 ? [future] : args),
      get: (date, key, receiver) => key === 'now' ? () => future : Reflect.get(date, key, receiver),
    }));
    const spec = structuredClone(SPEC);
    const table = spec.pages[0]!.components.find((c) => c.type === 'table')!;
    table.data.params = { from: 'filter.dates.from', to: 'filter.dates.to' };
    await fixture({ assign: CARD }, spec);
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="date"]')].map((i) => i.value)).toEqual(['2026-09-15', '2026-10-15']);
    expect(window.__wkFixture.filters('first').find((f) => f.id === 'dates')?.values).not.toContain('2026-09-15/2026-10-15');
    expect(new Date().toISOString()).toBe('2026-10-15T12:00:00.000Z');
    expect(Date.now()).toBe(Date.parse('2026-10-15T12:00:00Z'));
    const rows = await fixtureRows(spec, 'tickets', { from: '2026-09-15', to: '2026-10-15' });
    if (!('rows' in rows)) throw new Error('Expected sample rows');
    expect([...document.querySelectorAll('.wk-table tbody tr')].map((r) => [...r.querySelectorAll('td')].slice(0, 2).map((c) => c.textContent))).toEqual(rows.rows.map((r) => r.map(String)));
  });

  it('enumerates query-backed selects on an unrendered page from sample data, then selects those values', async () => {
    const spec = structuredClone(SPEC);
    const pick = spec.pages[0]!.components.find((c) => c.id === 'pick')!;
    if (pick.type !== 'filter') throw new Error('Expected filter');
    pick.default = 'open';
    spec.pages[1]!.components.push(...(['subject', 'id'] as const).map((value) => ({
      id: `query-${value}`, type: 'filter' as const, filter: 'select' as const,
      options: { kind: 'query' as const, query: { query: 'tickets', params: { status: 'filter.pick', from: 'filter.dates.from', to: 'filter.dates.to' } as const }, value },
      box: { x: 0, y: value === 'subject' ? 1 : 2, w: 4, h: 1 },
    })));
    await fixture({ assign: CARD }, spec);
    const api = window.__wkFixture;
    const rows = await fixtureRows(spec, 'tickets', { status: 'open', from: '2026-09-15', to: '2026-10-15' });
    if (!('rows' in rows)) throw new Error('Expected sample rows');
    const expected = [
      { id: 'query-subject', values: rows.rows.map((r) => String(r[1])) },
      { id: 'query-id', values: rows.rows.map((r) => String(r[0])) },
    ];
    expect(document.querySelector('[data-component="query-subject"]')).toBeNull();
    expect(api.filters('second')).toEqual(expected);
    expect(document.querySelector('[aria-current="page"]')?.textContent).toBe('First page');
    await api.show('second');
    for (const filter of expected) {
      expect([...document.querySelectorAll<HTMLOptionElement>(`[data-component="${filter.id}"] option`)].map((o) => o.value).filter(Boolean)).toEqual(filter.values);
      await api.setFilter(filter.id, filter.values[0]!);
      expect(document.querySelector<HTMLSelectElement>(`[data-component="${filter.id}"] select`)?.value).toBe(filter.values[0]);
    }
    await api.setFilter('pick', 'closed');
    const changed = api.filters('second');
    expect(changed).not.toEqual(expected);
    await api.show('second');
    expect([...document.querySelectorAll<HTMLOptionElement>('[data-component="query-subject"] option')].map((o) => o.value).filter(Boolean)).toEqual(changed[0]!.values);
  });

  it('records a failed options query on an unrendered page and leaves the fixture unready', async () => {
    const spec = structuredClone(SPEC);
    spec.pages[1]!.components.push({
      id: 'query-pick', type: 'filter', filter: 'select',
      options: { kind: 'query', query: { query: 'missing' }, value: 'id' },
      box: { x: 0, y: 1, w: 4, h: 1 },
    });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ spec, cards: {} }) }));
    await startFixture();
    expect(window.__wkFixture.ready).toBe(false);
    expect(window.__wkFixture.errors).toEqual(['this version has no query missing']);
  });

  it('reads fixture.json once, exposes the exact API, and resolves show after the new page paints', async () => {
    await fixture();
    expect(fetch).toHaveBeenCalledExactlyOnceWith('./fixture.json', { credentials: 'omit', redirect: 'error' });
    const api = window.__wkFixture;
    expect(Object.keys(api).sort()).toEqual(['ready', 'errors', 'pages', 'filters', 'actions', 'show', 'setFilter', 'prepare', 'closeCard'].sort());
    expect(api.pages()).toEqual(['first', 'second']);
    expect(api.filters('first')).toEqual([{ id: 'search', values: ['fixture'] }, { id: 'pick', values: ['open', 'closed'] }, { id: 'dates', values: ['2026-10-01/2026-10-31'] }]);
    expect(api.actions('first')).toEqual(['assign']);
    await api.show('second');
    expect(document.querySelector('.wk-text')?.textContent).toBe('Second page content');
    await api.show('first');
    expect(document.querySelectorAll('.wk-table tbody tr')).toHaveLength(3);
    await expect(api.show('missing')).rejects.toThrow('no page');
    expect(api.errors).toContain('This app has no page missing');
  });

  it('setFilter re-queries with the new select and search params before resolving; date ranges change both ends', async () => {
    await fixture();
    const api = window.__wkFixture;
    const before = document.querySelector('.wk-table')!.textContent;
    await api.setFilter('pick', 'open');
    expect(document.querySelector('.wk-table')!.textContent).not.toBe(before);
    expect(document.querySelector('.wk-table')!.textContent).toContain('open subject');
    await api.setFilter('search', 'needle');
    const rows = await fixtureRows(SPEC, 'tickets', { search: 'needle', status: 'open' });
    if (!('rows' in rows)) throw new Error('Expected sample rows');
    expect(document.querySelector('.wk-table tbody td')!.textContent).toBe(String(rows.rows[0]![0]));
    expect(document.querySelector('.wk-table')!.textContent).toContain('needle open subject');
    await api.setFilter('dates', '2026-09-01/2026-09-30');
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="date"]')].map((i) => i.value)).toEqual(['2026-09-01', '2026-09-30']);
    await expect(api.setFilter('pick', 'missing')).rejects.toThrow('no value');
    await expect(api.setFilter('missing', 'x')).rejects.toThrow('no filter');
    await expect(api.setFilter('dates', '2026-09-01')).rejects.toThrow('from/to');
  });

  it('prepare and a runtime action show only the supplied card as text, and never fetch or run anything', async () => {
    await fixture();
    const api = window.__wkFixture;
    const rows = document.querySelector('.wk-table')!.textContent;
    await api.prepare('assign');
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(JSON.stringify(CARD, null, 2));
    expect(document.querySelector('[role="dialog"] b')).toBeNull();
    expect([...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent)).toEqual(['Close']);
    await api.closeCard();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    (document.querySelector('[data-action="assign"]') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(JSON.stringify(CARD, null, 2)));
    await api.closeCard();
    expect(document.querySelector('.wk-table')!.textContent).toBe(rows);
    expect(fetch).toHaveBeenCalledTimes(1);
    await expect(api.prepare('missing')).rejects.toThrow('no action');
  });

  it('records a missing card and a failed fixture read, leaving failed boot unready', async () => {
    await fixture({});
    await expect(window.__wkFixture.prepare('assign')).rejects.toThrow('no card');
    expect(window.__wkFixture.errors).toContain('The fixture has no card for assign');
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as Response);
    await startFixture();
    expect(window.__wkFixture.ready).toBe(false);
    expect(window.__wkFixture.errors).toEqual(['The fixture could not be read']);
  });
});
