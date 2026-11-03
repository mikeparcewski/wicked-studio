import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDetail, AppSpec } from '../src/api/types.js';
import { AppDataPanel } from '../src/components/apps/AppDataPanel.js';
import {
  addTableFor, badOutputNames, bindTo, columnsGone, freshQueryId, outputOf, outputTypeOf, queryRows, sqlIdent, starterSql,
} from '../src/editors/apps/appQueries.js';
import { AppSession } from '../src/editors/apps/appSession.js';
import { SampleAppStore, sampleTexts, type AppStorePort, type StoreResult } from '../src/editors/apps/appStore.js';
import { SAMPLE_APPS } from '../src/editors/apps/samples.js';

/**
 * K4's Data panel in Edit (operator 2026-11-04: "How do I edit the data sources for an app?"): the app's queries and
 * their texts, Check & save through crew's staged check, and Add data from a source's table. Every save is ONE landing
 * of {spec, query-text}; a refusal shows crew's codes and words and lands nothing.
 */

class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

const SPEC = (): AppSpec => ({
  schema: 'wicked.apps/v1', name: 'Desk', linkHosts: [],
  queries: [
    { id: 'tickets', source: 'support-pg', kind: 'sql', output: [{ name: 'id', type: 'integer' }, { name: 'subject', type: 'string' }, { name: 'owner', type: 'string' }] },
    { id: 'open_count', source: 'support-pg', kind: 'sql', output: [{ name: 'open', type: 'integer' }] },
  ],
  actions: [],
  pages: [{ id: 'main', title: 'Main', components: [
    { id: 'list', type: 'table', title: 'Tickets', box: { x: 0, y: 2, w: 12, h: 5 }, data: { query: 'tickets' }, columns: [{ column: 'id' }, { column: 'subject' }, { column: 'owner' }] },
    { id: 'open', type: 'kpi', title: 'Open', box: { x: 0, y: 0, w: 3, h: 2 }, data: { query: 'open_count' }, value: 'open' },
  ] }],
} as unknown as AppSpec);

function detailOf(spec: AppSpec, queryText: Record<string, string>, version = 1): AppDetail {
  return {
    slug: 'desk', name: 'Desk', projectId: 'p', repoId: 'desk', createdAt: 1, head: { version, tree: 't', receipt: 'you' }, turn: null, spec,
    lock: { schema: 'wicked.apps.lock/v1', sources: {}, queries: {}, actions: {}, uploads: {} }, queryText,
    versions: [], history: { states: [version], pointer: 0, canUndo: false, canRedo: false },
  } as unknown as AppDetail;
}

describe('the model', () => {
  it('lists each query with its text, parameters, output and the components that read it', () => {
    const rows = queryRows(SPEC(), { tickets: 'SELECT 1' });
    expect(rows.map((r) => [r.id, r.text, r.usedBy.map((u) => u.id)])).toStrictEqual([['tickets', 'SELECT 1', ['list']], ['open_count', null, ['open']]]);
  });

  it('types a source column by crew’s own fit rules', () => {
    expect(['smallint', 'integer', 'bigint', 'numeric(10,2)', 'double precision', 'boolean', 'date', 'timestamp with time zone', 'text', 'support.ticket_status', 'uuid']
      .map(outputTypeOf)).toStrictEqual(['integer', 'integer', 'integer', 'number', 'number', 'boolean', 'date', 'datetime', 'string', 'string', 'string']);
    expect(outputOf([{ name: 'n', type: 'bigint' }])).toStrictEqual([{ name: 'n', type: 'integer' }]);
    // codex r13: MySQL's describe answers protocol names.
    expect(['LONG', 'LONGLONG', 'SHORT', 'INT24', 'TINY', 'NEWDECIMAL', 'DOUBLE', 'DATE', 'DATETIME', 'TIMESTAMP', 'VAR_STRING'].map(outputTypeOf))
      .toStrictEqual(['integer', 'integer', 'integer', 'integer', 'integer', 'number', 'number', 'date', 'datetime', 'datetime', 'string']);
  });

  it('names the components a narrower output would leave without a column', () => {
    expect(columnsGone(SPEC(), 'tickets', outputOf([{ name: 'id', type: 'integer' }, { name: 'subject', type: 'text' }]))).toStrictEqual([{ id: 'list', words: expect.any(String), column: 'owner' }]);
    expect(columnsGone(SPEC(), 'tickets', outputOf([{ name: 'id', type: 'integer' }, { name: 'subject', type: 'text' }, { name: 'owner', type: 'text' }, { name: 'status', type: 'text' }]))).toStrictEqual([]);
  });

  it('writes a schema-qualified starter read, every identifier quoted, and an output-name alias where one is needed', () => {
    const r = { schema: 'support', name: 'tickets', kind: 'table', rowEstimate: 1, primaryKey: ['id'], foreignKeys: [], columns: [{ name: 'id' }, { name: 'Odd "col"' }] } as never;
    expect(starterSql(r, 'postgres')).toBe('SELECT "id", "Odd ""col""" AS "odd_col"\nFROM "support"."tickets"\nLIMIT 100');
    expect(sqlIdent('a`b', 'mysql')).toBe('`a``b`');
    // codex r13: reserved words stay identifiers; names outside crew's output grammar get an alias that is in it.
    const reserved = { schema: 'sales', name: 'order', kind: 'table', rowEstimate: 1, primaryKey: [], foreignKeys: [], columns: [{ name: 'select' }, { name: 'Order ID' }, { name: '2nd' }, { name: 'order_id' }] } as never;
    expect(starterSql(reserved, 'mysql')).toBe('SELECT `select`, `Order ID` AS `order_id_2`, `2nd` AS `c_2nd`, `order_id`\nFROM `sales`.`order`\nLIMIT 100');
    expect(badOutputNames([{ name: 'ok_1' }, { name: 'Order ID' }, { name: '2nd' }, { name: 'é' }])).toStrictEqual(['Order ID', '2nd', 'é']);
    expect(freshQueryId(SPEC(), 'tickets')).toBe('tickets_2');
    expect(freshQueryId(SPEC(), '9 Weird-Name')).toBe('q_9_weird_name');
  });

  it('binds a component, or adds a table that reads the query', () => {
    const spec = SPEC();
    spec.queries.push({ id: 'regions', source: 'support-pg', kind: 'sql', output: [{ name: 'name', type: 'string' }, { name: 'sla_hours', type: 'integer' }] });
    const bound = bindTo(spec, 'open', 'regions');
    expect(bound.ok && bound.spec.pages[0]!.components.find((c) => c.id === 'open')).toMatchObject({ data: { query: 'regions' }, value: 'sla_hours' });
    const added = addTableFor(spec, 'main', 'regions');
    expect(added.ok && added.spec.pages[0]!.components.find((c) => c.id === added.id)).toMatchObject({ type: 'table', data: { query: 'regions' }, title: 'regions', box: { y: 7 } });
  });
});

describe('the session lands a Data panel change as ONE version, after the runtime’s burst', () => {
  it('lands the pending burst first, then {spec, texts} on the new head; a refused check returns crew’s findings and changes nothing', async () => {
    const st = new SampleAppStore('desk', SPEC(), new MemStorage(), Date.now, null);
    const session = new AppSession(st, { burstMs: 60_000 });
    await session.load();
    const edit = vi.spyOn(st, 'edit');
    session.edit(1, [{ op: 'component-move', id: 'open', x: 3, y: 0 }]);
    const r = await session.landDirect((head) => ({ spec: head.spec, texts: { tickets: 'SELECT t.id FROM support.tickets AS t' }, summary: 'Changed query tickets' }));
    expect(r).toMatchObject({ ok: true, version: 3 });
    expect(edit.mock.calls.map((c) => [c[0], c[3] ?? null])).toStrictEqual([[1, null], [2, { tickets: 'SELECT t.id FROM support.tickets AS t' }]]);
    expect(session.detail!.queryText.tickets).toBe('SELECT t.id FROM support.tickets AS t');

    const refused: StoreResult = { ok: false, code: 'check_failed', message: 'query tickets: one statement only', findings: [{ stage: 'source', code: 'statements', path: '$.queries[0]', message: 'query tickets: one statement only' }] };
    const crewish: AppStorePort = { slug: 'desk', kind: 'crew', detail: () => st.detail(), edit: vi.fn(async () => refused), move: vi.fn() };
    const s2 = new AppSession(crewish);
    await s2.load();
    const head = s2.head;
    const events: string[] = [];
    s2.on((e) => events.push(e.kind));
    const no = await s2.landDirect((h) => ({ spec: h.spec, texts: { tickets: 'SELECT 1; DROP TABLE x' }, summary: 'x' }));
    expect(no).toMatchObject({ ok: false, code: 'check_failed', findings: [{ code: 'statements' }] });
    expect(s2.head).toBe(head);
    expect(events).toStrictEqual([]);
  });

  it('codex r13: a sample saved before texts were kept migrates, so an undo never keeps the newer text', async () => {
    const storage = new MemStorage();
    const spec = SAMPLE_APPS['escalations']!.spec;
    const fresh = new SampleAppStore('esc', spec, storage, Date.now, null);
    await fresh.detail();
    const raw = JSON.parse(storage.getItem('wicked-apps-sample:esc')!) as { texts?: unknown; detail: { queryText: unknown } };
    delete raw.texts;
    raw.detail.queryText = {};
    storage.setItem('wicked-apps-sample:esc', JSON.stringify(raw));
    const old = new SampleAppStore('esc', spec, storage, Date.now, null);
    const d = await old.detail();
    expect(d.queryText['unassigned']).toBe(sampleTexts(spec)['unassigned']);
    await old.edit(1, d.spec, 'Changed', { unassigned: 'SELECT 9 AS unassigned' });
    const back = await old.move('undo', 2);
    expect(back.ok && back.app.queryText['unassigned']).toBe(sampleTexts(spec)['unassigned']);
  });

  it('the sample store keeps a query’s text per version: undo puts the earlier text back', async () => {
    const st = new SampleAppStore('esc', SAMPLE_APPS['escalations']!.spec, new MemStorage(), Date.now, null);
    const d1 = await st.detail();
    expect(d1.queryText).toStrictEqual(sampleTexts(SAMPLE_APPS['escalations']!.spec));
    expect(d1.queryText['unassigned']).toMatch(/^-- A sample query: this app's rows are made up/);
    const r = await st.edit(1, d1.spec, 'Changed', { unassigned: 'SELECT 1 AS unassigned' });
    expect(r.ok && r.app.queryText['unassigned']).toBe('SELECT 1 AS unassigned');
    const back = await st.move('undo', 2);
    expect(back.ok && back.app.queryText['unassigned']).toBe(d1.queryText['unassigned']);
  });
});

// ── the panel ───────────────────────────────────────────────────────────────────────────────

type Made = { spec: AppSpec; texts: Record<string, string>; summary: string } | string;
function fakeSession(detail: AppDetail, answer: (made: Made) => Awaited<ReturnType<AppSession['landDirect']>> = (m) => (typeof m === 'string' ? { ok: false, code: 'refused', message: m, findings: [] } : { ok: true, version: detail.head.version + 1, app: detail })) {
  const made: Made[] = [];
  const session = { landDirect: vi.fn(async (build: (h: AppDetail) => Made) => { const m = build(detail); made.push(m); return answer(m); }) } as unknown as AppSession;
  return { session, made };
}
function mockCrew(routes: Record<string, (body: unknown) => unknown>): { calls: Array<{ path: string; body: unknown }> } {
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, 'http://studio.local').pathname.replace(/^\/api\/v1/u, '');
    const body = typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : null;
    calls.push({ path, body });
    const hit = routes[path];
    if (hit === undefined) return new Response(JSON.stringify({ error: 'no route' }), { status: 404 });
    return new Response(JSON.stringify(hit(body)), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch);
  return { calls };
}
const SERVERS = { servers: [{ name: 'support-pg', kind: 'sql', sql: { driver: 'postgres' }, enabled: true }], discovered: [] };
const CATALOG = { name: 'support-pg', kind: 'sql', descriptorHash: 'd', catalog: { dialect: 'postgres', database: 'support', describedAt: 'now', relations: [
  { schema: 'support', name: 'regions', kind: 'table', rowEstimate: 5, primaryKey: ['id'], foreignKeys: [], columns: [{ name: 'name', type: 'text' }, { name: 'sla_hours', type: 'integer' }] },
] } };

describe('the Data panel', () => {
  const TEXT = { tickets: 'SELECT t.id, t.subject, t.owner FROM support.tickets AS t', open_count: 'SELECT count(*) AS open FROM support.tickets AS t' };

  it('a text the read policy refuses shows crew’s code and reason, and nothing is landed', async () => {
    mockCrew({ '/mcp/servers': () => SERVERS, '/sources/support-pg/check': () => ({ ok: false, code: 'statements', detail: 'one statement only' }) });
    const { session } = fakeSession(detailOf(SPEC(), TEXT));
    render(<AppDataPanel session={session} detail={detailOf(SPEC(), TEXT)} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('tickets'));
    fireEvent.change(screen.getByTestId('apps-data-text'), { target: { value: 'SELECT 1; DROP TABLE support.tickets' } });
    fireEvent.click(screen.getByTestId('apps-data-save'));
    await waitFor(() => expect(screen.getByTestId('apps-data-refused').textContent).toBe('statements one statement only'));
    expect(session.landDirect).not.toHaveBeenCalled();
  });

  it('a valid edit lands ONE version with the columns crew’s check re-read, and the text', async () => {
    const { calls } = mockCrew({ '/mcp/servers': () => SERVERS, '/sources/support-pg/check': () => ({ ok: true, columns: [{ name: 'id', type: 'integer' }, { name: 'subject', type: 'text' }, { name: 'owner', type: 'text' }, { name: 'status', type: 'support.ticket_status' }], params: [], relations: [] }) });
    const d = detailOf(SPEC(), TEXT);
    const { session, made } = fakeSession(d);
    render(<AppDataPanel session={session} detail={d} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('tickets'));
    const text = 'SELECT t.id, t.subject, t.owner, t.status FROM support.tickets AS t';
    fireEvent.change(screen.getByTestId('apps-data-text'), { target: { value: text } });
    fireEvent.click(screen.getByTestId('apps-data-save'));
    await waitFor(() => expect(screen.getByTestId('apps-data-saved').textContent).toBe('Saved as v2: 4 columns, re-read from the check'));
    expect(calls.filter((c) => c.path === '/sources/support-pg/check')).toStrictEqual([{ path: '/sources/support-pg/check', body: { text } }]);
    expect(session.landDirect).toHaveBeenCalledTimes(1);
    const m = made[0] as Exclude<Made, string>;
    expect(m.texts).toStrictEqual({ tickets: text });
    expect(m.spec.queries.find((q) => q.id === 'tickets')!.output).toStrictEqual([{ name: 'id', type: 'integer' }, { name: 'subject', type: 'string' }, { name: 'owner', type: 'string' }, { name: 'status', type: 'string' }]);
  });

  it('a narrower output names the components it would leave without a column, and lands nothing', async () => {
    mockCrew({ '/mcp/servers': () => SERVERS, '/sources/support-pg/check': () => ({ ok: true, columns: [{ name: 'id', type: 'integer' }, { name: 'subject', type: 'text' }], params: [], relations: [] }) });
    const { session } = fakeSession(detailOf(SPEC(), TEXT));
    render(<AppDataPanel session={session} detail={detailOf(SPEC(), TEXT)} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('tickets'));
    fireEvent.change(screen.getByTestId('apps-data-text'), { target: { value: 'SELECT t.id, t.subject FROM support.tickets AS t' } });
    fireEvent.click(screen.getByTestId('apps-data-save'));
    await waitFor(() => expect(screen.getByTestId('apps-data-gone').textContent).toMatch(/^Column gone: /));
    expect(screen.getByTestId('apps-data-gone').textContent).toMatch(/owner/);
    expect(session.landDirect).not.toHaveBeenCalled();
  });

  it('crew refusing the landing shows its findings as text', async () => {
    mockCrew({ '/mcp/servers': () => SERVERS, '/sources/support-pg/check': () => ({ ok: true, columns: [{ name: 'id', type: 'integer' }, { name: 'subject', type: 'text' }, { name: 'owner', type: 'text' }], params: [], relations: [] }) });
    const d = detailOf(SPEC(), TEXT);
    const { session } = fakeSession(d, () => ({ ok: false, code: 'check_failed', message: 'Not saved: query tickets: <img src=x onerror=window.__pwned=1>', findings: [{ stage: 'source', code: 'output_type', path: '$.queries[0]', message: '<b>column id</b> is text' }] }));
    render(<AppDataPanel session={session} detail={d} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('tickets'));
    fireEvent.change(screen.getByTestId('apps-data-text'), { target: { value: 'SELECT t.id::text AS id, t.subject, t.owner FROM support.tickets AS t' } });
    fireEvent.click(screen.getByTestId('apps-data-save'));
    await waitFor(() => expect(screen.getByTestId('apps-data-findings').textContent).toBe('output_type <b>column id</b> is text'));
    expect(document.querySelectorAll('[data-testid="apps-data"] img, [data-testid="apps-data"] b')).toHaveLength(0);
  });

  it('Add data: a table becomes a starter read, checked, then a new table reads it (or the picked component)', async () => {
    const { calls } = mockCrew({
      '/mcp/servers': () => SERVERS, '/sources/support-pg/catalog': () => CATALOG,
      '/sources/support-pg/check': () => ({ ok: true, columns: [{ name: 'name', type: 'text' }, { name: 'sla_hours', type: 'integer' }], params: [], relations: [] }),
    });
    const d = detailOf(SPEC(), TEXT);
    const { session, made } = fakeSession(d);
    render(<AppDataPanel session={session} detail={d} sample={false} selectedId="open" page="main" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-data-table')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('apps-data-table'));
    expect((screen.getByTestId('apps-data-add-text') as HTMLTextAreaElement).value).toBe('SELECT "name", "sla_hours"\nFROM "support"."regions"\nLIMIT 100');
    // The selected KPI is the target the panel offers first.
    expect((screen.getByTestId('apps-data-target') as HTMLSelectElement).value).toBe('open');
    fireEvent.change(screen.getByTestId('apps-data-target'), { target: { value: 'new-table' } });
    fireEvent.click(screen.getByTestId('apps-data-add-save'));
    await waitFor(() => expect(screen.getByTestId('apps-data-saved').textContent).toBe('Added as v2: a new table reads it'));
    expect(calls.some((c) => c.path === '/sources/support-pg/check')).toBe(true);
    const m = made[0] as Exclude<Made, string>;
    expect(m.spec.queries.find((q) => q.id === 'regions')).toStrictEqual({ id: 'regions', source: 'support-pg', kind: 'sql', output: [{ name: 'name', type: 'string' }, { name: 'sla_hours', type: 'integer' }] });
    expect(m.spec.pages[0]!.components.some((c) => c.type === 'table' && (c as { data?: { query: string } }).data?.query === 'regions')).toBe(true);
    expect(m.texts).toStrictEqual({ regions: 'SELECT "name", "sla_hours"\nFROM "support"."regions"\nLIMIT 100' });
  });

  it('Ask in words shows the drafted SQL and the seat’s words as text first; Use this SQL fills the editor', async () => {
    mockCrew({
      '/mcp/servers': () => SERVERS, '/sources/support-pg/catalog': () => CATALOG,
      '/sources/support-pg/ask': () => ({ sql: "SELECT r.name AS region FROM support.regions AS r WHERE r.name <> '<script>x</script>'", explanation: '<img src=x onerror=window.__pwned=2> Regions.', seat: 'claude', check: { ok: true, columns: [{ name: 'region', type: 'text' }], params: [], relations: [] }, confirm: null }),
    });
    const d = detailOf(SPEC(), TEXT);
    const { session } = fakeSession(d);
    render(<AppDataPanel session={session} detail={d} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('apps-data-ask')).toBeTruthy());
    fireEvent.change(screen.getByTestId('apps-data-ask'), { target: { value: 'Which regions?' } });
    fireEvent.click(screen.getByTestId('apps-data-ask-go'));
    await waitFor(() => expect(screen.getByTestId('apps-data-draft-sql').textContent).toBe("SELECT r.name AS region FROM support.regions AS r WHERE r.name <> '<script>x</script>'"));
    expect(screen.getByTestId('apps-data-draft').textContent).toMatch(/<img src=x onerror=window.__pwned=2> Regions\./);
    expect(document.querySelectorAll('[data-testid="apps-data"] img, [data-testid="apps-data"] script')).toHaveLength(0);
    expect(session.landDirect).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('apps-data-use-draft'));
    expect((screen.getByTestId('apps-data-add-text') as HTMLTextAreaElement).value).toMatch(/^SELECT r.name AS region/);
    expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();
  });

  it('no data source yet: one line linking to Data sources', async () => {
    mockCrew({ '/mcp/servers': () => ({ servers: [], discovered: [] }) });
    const navigate = vi.fn();
    const d = detailOf(SPEC(), TEXT);
    render(<AppDataPanel session={fakeSession(d).session} detail={d} sample={false} selectedId={null} page="main" navigate={navigate} onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('apps-data-nosource')).toBeTruthy());
    fireEvent.click(screen.getByTestId('apps-data-sources-link'));
    expect(navigate).toHaveBeenCalledWith('/sources');
  });

  it('codex r13: a save on a query that changed meanwhile (an undo) lands nothing and says so', async () => {
    mockCrew({ '/mcp/servers': () => SERVERS, '/sources/support-pg/check': () => ({ ok: true, columns: [{ name: 'id', type: 'integer' }, { name: 'subject', type: 'text' }, { name: 'owner', type: 'text' }], params: [], relations: [] }) });
    const d = detailOf(SPEC(), TEXT);
    const undone = detailOf(SPEC(), { ...TEXT, tickets: 'SELECT the text before' }, 3);
    const made: Made[] = [];
    const session = { landDirect: vi.fn(async (build: (h: AppDetail) => Made) => { const m = build(undone); made.push(m); return typeof m === 'string' ? { ok: false, code: 'refused', message: m, findings: [] } : { ok: true, version: 4, app: undone }; }) } as unknown as AppSession;
    render(<AppDataPanel session={session} detail={d} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('tickets'));
    fireEvent.change(screen.getByTestId('apps-data-text'), { target: { value: 'SELECT t.id, t.subject, t.owner FROM support.tickets AS t LIMIT 5' } });
    fireEvent.click(screen.getByTestId('apps-data-save'));
    await waitFor(() => expect(screen.getByTestId('apps-data-save-refused').textContent).toMatch(/this query changed meanwhile/));
    expect(typeof made[0]).toBe('string');
  });

  it('codex r13: a draft survives a landing that did not touch its query, and is opened afresh when the query changed', async () => {
    mockCrew({ '/mcp/servers': () => SERVERS });
    const d1 = detailOf(SPEC(), TEXT, 1);
    const { session } = fakeSession(d1);
    const { rerender } = render(<AppDataPanel session={session} detail={d1} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('tickets'));
    fireEvent.change(screen.getByTestId('apps-data-text'), { target: { value: 'my draft' } });
    const moved = SPEC();
    moved.pages[0]!.components[1]!.box = { x: 3, y: 0, w: 3, h: 2 };
    rerender(<AppDataPanel session={session} detail={detailOf(moved, TEXT, 2)} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    expect((screen.getByTestId('apps-data-text') as HTMLTextAreaElement).value).toBe('my draft');
    rerender(<AppDataPanel session={session} detail={detailOf(moved, { ...TEXT, tickets: 'SELECT from another tab' }, 3)} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    expect((screen.getByTestId('apps-data-text') as HTMLTextAreaElement).value).toBe('SELECT from another tab');
  });

  it('codex r13: a draft asked of one source never shows under another', async () => {
    let answer: ((v: unknown) => void) | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://studio.local').pathname.replace(/^\/api\/v1/u, '');
      const json = (v: unknown): Response => new Response(JSON.stringify(v), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if (path === '/mcp/servers') return json({ servers: [...SERVERS.servers, { name: 'other-pg', kind: 'sql', sql: { driver: 'postgres' }, enabled: true }], discovered: [] });
      if (path.endsWith('/catalog')) return json(CATALOG);
      if (path === '/sources/support-pg/ask') return new Promise<Response>((res) => { answer = (v) => res(json(v)); });
      return new Response('{}', { status: 404 });
    }) as typeof fetch);
    const d = detailOf(SPEC(), TEXT);
    render(<AppDataPanel session={fakeSession(d).session} detail={d} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('apps-data-ask')).toBeTruthy());
    fireEvent.change(screen.getByTestId('apps-data-ask'), { target: { value: 'Which regions?' } });
    fireEvent.click(screen.getByTestId('apps-data-ask-go'));
    await waitFor(() => expect(answer).not.toBeNull());
    // The source is held while the draft is out.
    expect((screen.getByTestId('apps-data-add-source') as HTMLSelectElement).disabled).toBe(true);
    answer!({ sql: 'SELECT 1 AS x', explanation: 'one', seat: 'claude', check: null, confirm: null });
    await waitFor(() => expect(screen.getByTestId('apps-data-draft').textContent).toMatch(/^Drafted for support-pg: one/));
    // Switching source clears it: a draft belongs to the source it was asked of.
    fireEvent.change(screen.getByTestId('apps-data-add-source'), { target: { value: 'other-pg' } });
    await waitFor(() => expect(screen.queryByTestId('apps-data-draft')).toBeNull());
  });

  it('codex r13: a column name crew would refuse is said before anything lands', async () => {
    mockCrew({ '/mcp/servers': () => SERVERS, '/sources/support-pg/check': () => ({ ok: true, columns: [{ name: 'id', type: 'integer' }, { name: 'Order ID', type: 'text' }], params: [], relations: [] }) });
    const d = detailOf(SPEC(), TEXT);
    const { session } = fakeSession(d);
    render(<AppDataPanel session={session} detail={d} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('open_count'));
    fireEvent.change(screen.getByTestId('apps-data-text'), { target: { value: 'SELECT t.id, t."Order ID" FROM support.tickets AS t' } });
    fireEvent.click(screen.getByTestId('apps-data-save'));
    await waitFor(() => expect(screen.getByTestId('apps-data-refused-code').textContent).toBe('output_name'));
    expect(session.landDirect).not.toHaveBeenCalled();
  });

  it('codex r13: a GraphQL text keeps its declared output; a REST query has no pre-check; a deleted source can be replaced', async () => {
    const spec = SPEC();
    spec.queries.push({ id: 'gql', source: 'shop-gql', kind: 'graphql', rowPath: '$.data.orders[*]', output: [{ name: 'id', type: 'string' }] } as never);
    spec.queries.push({ id: 'rest', source: 'ops-api', kind: 'rest', rowPath: '$.items[*]', output: [{ name: 'id', type: 'string' }] } as never);
    spec.queries[0]!.source = 'gone-pg';
    const texts = { ...TEXT, gql: 'query { orders { id } }', rest: '{"tool":"GET /items"}' };
    const { calls } = mockCrew({
      '/mcp/servers': () => ({ servers: [...SERVERS.servers, { name: 'shop-gql', kind: 'graphql', enabled: true }], discovered: [] }),
      '/sources/shop-gql/check': () => ({ ok: true, columns: [], params: [], relations: [] }),
    });
    const d = detailOf(spec, texts);
    const { session, made } = fakeSession(d);
    render(<AppDataPanel session={session} detail={d} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    await waitFor(() => expect(calls.some((c) => c.path === '/mcp/servers')).toBe(true));
    fireEvent.click(screen.getByText('gql'));
    fireEvent.change(screen.getByTestId('apps-data-text'), { target: { value: 'query { orders(first: 5) { id } }' } });
    fireEvent.click(screen.getByTestId('apps-data-save'));
    await waitFor(() => expect(screen.getByTestId('apps-data-last').textContent).toBe('Saved as v2: checked by crew'));
    expect((made[0] as Exclude<Made, string>).spec.queries.find((q) => q.id === 'gql')!.output).toStrictEqual([{ name: 'id', type: 'string' }]);
    fireEvent.click(screen.getByText('rest'));
    expect(screen.queryByTestId('apps-data-check')).toBeNull();
    expect(screen.getByTestId('apps-data-save').textContent).toBe('Save');
    fireEvent.click(screen.getByText('tickets'));
    await waitFor(() => expect(screen.getByTestId('apps-data-source-select')).toBeTruthy());
    const options = [...(screen.getByTestId('apps-data-source-select') as HTMLSelectElement).options].map((o) => o.textContent);
    expect(options).toStrictEqual(['gone-pg (not in crew’s registry)', 'support-pg']);
  });

  it('the sample store: labelled, no source call, and the text saves as the sample’s', async () => {
    const { calls } = mockCrew({});
    const d = detailOf(SPEC(), TEXT);
    const { session, made } = fakeSession(d);
    render(<AppDataPanel session={session} detail={d} sample selectedId={null} page="main" onClose={vi.fn()} />);
    expect(screen.getByTestId('apps-data-sample').textContent).toMatch(/not checked against a source/);
    fireEvent.click(screen.getByText('tickets'));
    expect(screen.queryByTestId('apps-data-check')).toBeNull();
    fireEvent.change(screen.getByTestId('apps-data-text'), { target: { value: 'SELECT 2' } });
    fireEvent.click(screen.getByTestId('apps-data-save'));
    await waitFor(() => expect(screen.getByTestId('apps-data-saved').textContent).toBe('Saved as v2 (sample: not checked against a source)'));
    expect(calls).toStrictEqual([]);
    expect((made[0] as Exclude<Made, string>).texts).toStrictEqual({ tickets: 'SELECT 2' });
  });
});
describe('Data panel review round 14 (codex)', () => {
  const TEXT = { tickets: 'SELECT t.id, t.subject, t.owner FROM support.tickets AS t', open_count: 'SELECT count(*) AS open FROM support.tickets AS t' };
  const OK = () => ({ ok: true, columns: [{ name: 'id', type: 'integer' }, { name: 'subject', type: 'text' }, { name: 'owner', type: 'text' }], params: [], relations: [] });

  it('an editor closed while the canvas burst lands sends nothing: only the burst lands', async () => {
    mockCrew({ '/mcp/servers': () => SERVERS, '/sources/support-pg/check': OK });
    const st = new SampleAppStore('desk', SPEC(), new MemStorage(), Date.now, null);
    await st.edit(1, SPEC(), 'texts', TEXT);
    const session = new AppSession(st, { burstMs: 60_000 });
    await session.load();
    session.edit(2, [{ op: 'component-move', id: 'open', x: 3, y: 0 }]);
    let release!: () => void;
    const held = new Promise<void>((res) => { release = res; });
    const real = st.edit.bind(st);
    const edit = vi.spyOn(st, 'edit').mockImplementation(async (...a) => { await held; return real(...a); });
    const { unmount } = render(<AppDataPanel session={session} detail={session.detail!} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('tickets'));
    fireEvent.change(screen.getByTestId('apps-data-text'), { target: { value: 'SELECT t.id, t.subject, t.owner FROM support.tickets AS t LIMIT 3' } });
    fireEvent.click(screen.getByTestId('apps-data-save'));
    await waitFor(() => expect(edit).toHaveBeenCalledTimes(1)); // the burst is landing
    unmount();
    release();
    await new Promise((res) => setTimeout(res, 30));
    expect(edit).toHaveBeenCalledTimes(1);
    expect(session.detail!.queryText.tickets).toBe(TEXT.tickets);
  });

  it('works under React Strict Mode (effects replay): Check & save lands', async () => {
    mockCrew({ '/mcp/servers': () => SERVERS, '/sources/support-pg/check': OK });
    const d = detailOf(SPEC(), TEXT);
    const { session } = fakeSession(d);
    render(<StrictMode><AppDataPanel session={session} detail={d} sample={false} selectedId={null} page="main" onClose={vi.fn()} /></StrictMode>);
    fireEvent.click(screen.getByText('tickets'));
    fireEvent.change(screen.getByTestId('apps-data-text'), { target: { value: 'SELECT t.id, t.subject, t.owner FROM support.tickets AS t LIMIT 9' } });
    fireEvent.click(screen.getByTestId('apps-data-save'));
    await waitFor(() => expect(session.landDirect).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('apps-data-saved')).toBeTruthy());
  });

  it('a REST query is offered the other REST sources (crew checks the text on save)', async () => {
    const spec = SPEC();
    spec.queries.push({ id: 'items', source: 'ops-api', kind: 'rest', rowPath: '$.items[*]', output: [{ name: 'id', type: 'string' }] } as never);
    mockCrew({ '/mcp/servers': () => ({ servers: [...SERVERS.servers, { name: 'ops-api', kind: 'rest', enabled: true }, { name: 'ops-api-2', kind: 'rest', enabled: true }, { name: 'tools', kind: 'mcp-http', enabled: true }], discovered: [] }) });
    const d = detailOf(spec, { ...TEXT, items: '{"tool":"GET /items"}' });
    render(<AppDataPanel session={fakeSession(d).session} detail={d} sample={false} selectedId={null} page="main" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('items'));
    await waitFor(() => expect(screen.getByTestId('apps-data-source-select')).toBeTruthy());
    expect([...(screen.getByTestId('apps-data-source-select') as HTMLSelectElement).options].map((o) => o.value)).toStrictEqual(['ops-api', 'ops-api-2']);
    expect(screen.queryByTestId('apps-data-check')).toBeNull();
  });
});
