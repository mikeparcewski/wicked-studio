import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDetail, AppSpec, SessionView } from '../src/api/types.js';
import { AppChat, aboutComponent, appComposerKey } from '../src/components/apps/AppChat.js';
import { AppsPage } from '../src/components/apps/AppsPage.js';
import { busyText, changeLine, endedLine, slugFrom, suggestionsFor, turnsOf } from '../src/editors/apps/appTurns.js';
import { TileScheduler, tileEveryMs, tileKpis, type QueryOutcome } from '../src/editors/apps/liveTiles.js';
import { SAMPLE_APPS } from '../src/editors/apps/samples.js';
import { useComposerChips } from '../src/store/composerChips.js';

/**
 * DES-APPS-001 K5 (operator 2026-11-04: "I should be driving the changes mostly via chat"; "dashboard should show real
 * time information"): the app's chat is crew's turn log; a message is one turn with the selected components' ids; the
 * dashboard's cards read their KPI numbers live, only while seen, at most 3 queries at once, and say why when they can't.
 */

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.innerHTML = ''; localStorage.clear(); useComposerChips.setState({ byComposer: {} }); });

const spec = (): AppSpec => structuredClone(SAMPLE_APPS['escalations']!.spec);
const turn = (over: Record<string, unknown>) => ({
  runId: 'apps-desk-000000000001', at: Date.now() - 60_000, actor: 'local', message: 'add a chart of breaches by priority', about: [], base: 2,
  state: 'landed', endedAt: Date.now() - 30_000, version: 3, change: 'Added 1 chart and 1 query', summary: 'Added chart `by_priority`', builder: 'claude', reviewer: 'codex', code: null, reason: null, ...over,
});
const detail = (over: Record<string, unknown> = {}): AppDetail => ({
  slug: 'desk', name: 'Desk', projectId: 'p', repoId: 'desk', createdAt: 1, head: { version: 3, tree: 't', receipt: 'reviewed' }, turn: null,
  spec: spec(), lock: { schema: 'wicked.apps.lock/v1', sources: {}, queries: {}, actions: {}, uploads: {} } as never, queryText: {},
  versions: [], history: { states: [1, 2, 3], pointer: 2, canUndo: true, canRedo: false }, turns: [turn({})], ...over,
}) as unknown as AppDetail;

function mockFetch(handler: (path: string, init?: RequestInit) => { status?: number; body: unknown } | null): { calls: Array<{ path: string; body: unknown }> } {
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, 'http://studio.local').pathname.replace(/^\/api\/v1/u, '');
    calls.push({ path, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    const r = handler(path, init);
    if (r === null) return new Response(JSON.stringify({ error: 'no route' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch);
  return { calls };
}

describe('the app chat: crew\'s turn log, in words', () => {
  it('reads crew\'s records defensively and says each outcome in crew\'s words', () => {
    const d = detail({ turns: [turn({}), { runId: 1 }, turn({ runId: 'r2', state: 'refused', code: 'check_failed', reason: 'crew\'s check refused the change: pg_sleep is not allowed. Nothing landed.', version: null }), turn({ runId: 'r3', state: 'bogus' })] });
    const t = turnsOf(d);
    expect(t.map((x) => x.runId)).toStrictEqual(['apps-desk-000000000001', 'r2']);
    expect(changeLine(t[0]!)).toBe('v3 · Added 1 chart and 1 query · reviewed by Codex');
    expect(endedLine(t[1]!)).toBe('Nothing landed: crew\'s check refused the change: pg_sleep is not allowed');
    expect(turnsOf(detail({ turns: undefined }))).toStrictEqual([]);
  });

  it('busy text names the step and its seat; a new app\'s slug comes from the message\'s own words', () => {
    const view = { session: { id: 'r', status: 'executing' }, units: [{ id: 'r:build', ord: 1, status: 'done', assigned_cli: 'claude' }, { id: 'r:check', ord: 2, status: 'done' }, { id: 'r:review', ord: 3, status: 'distributed', assigned_cli: 'codex' }] } as unknown as SessionView;
    expect(busyText(view)).toMatchObject({ line: 'Reviewing it · Codex…', step: 'review', ord: 3 });
    expect(busyText(null).line).toBe('Starting the turn…');
    expect(slugFrom('a dashboard of escalations by region from support-pg')).toBe('escalations-region-support');
    expect(slugFrom('!!!')).toBe('new-app');
    expect(suggestionsFor(spec(), ['support-pg', 'finance']).length).toBeGreaterThan(0);
    expect(suggestionsFor({ ...spec(), pages: [{ id: 'p', title: 'P', components: [] }], queries: [] }, ['support-pg'])[0]).toBe('Show the main numbers from support-pg as KPIs');
  });

  it('a message is ONE turn on the head, about the selected components\' ids; a refused send keeps the words', async () => {
    const { calls } = mockFetch((path) => {
      if (path === '/mcp/servers') return { body: { servers: [{ name: 'support-pg', kind: 'sql' }], discovered: [] } };
      if (path === '/apps/desk/turns') return calls.filter((c) => c.path === '/apps/desk/turns').length === 1 ? { status: 202, body: { runId: 'apps-desk-000000000002', turn: {} } } : { status: 409, body: { code: 'turn_in_flight', error: 'a turn (run x) is changing desk' } };
      return null;
    });
    const onSent = vi.fn();
    render(<AppChat slug="desk" detail={detail()} runs={[]} framed={false} navigate={vi.fn()} onSent={onSent} onUndo={vi.fn()} />);
    expect(screen.getByTestId('app-chat-change').textContent).toBe('v3 · Added 1 chart and 1 query · reviewed by Codex');
    act(() => aboutComponent('desk', 'open_kpi', 'KPI “Open” (Overview, v3)'));
    const box = screen.getByTestId('session-composer-input') as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'make this a line chart' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(onSent).toHaveBeenCalledTimes(1));
    expect(calls.find((c) => c.path === '/apps/desk/turns')!.body).toStrictEqual({ base: 3, message: 'make this a line chart', about: ['open_kpi'] });
    fireEvent.change(box, { target: { value: 'and another' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(screen.getByTestId('app-chat-note').textContent).toMatch(/already running/));
    expect((screen.getByTestId('session-composer-input') as HTMLTextAreaElement).value).toBe('and another');
    expect(useComposerChips.getState().byComposer[appComposerKey('desk')] ?? []).toStrictEqual([]);
  });

  it('a running turn shows its steps and is read-only for the next message; refused shows the code and the reason', () => {
    mockFetch(() => null);
    const runs = [{ session: { id: 'apps-desk-000000000009', status: 'executing' }, units: [{ id: 'apps-desk-000000000009:build', ord: 1, status: 'distributed', assigned_cli: 'claude' }] }] as unknown as SessionView[];
    const d = detail({ turn: { runId: 'apps-desk-000000000009', startedAt: 1, base: 3, actor: 'local' }, turns: [turn({ runId: 'r0', state: 'refused', code: 'review_refused', reason: 'The reviewer refused the change: reads a column nobody asked for. Nothing landed.', version: null }), turn({ runId: 'apps-desk-000000000009', state: 'running', endedAt: null, version: null })] });
    render(<AppChat slug="desk" detail={d} runs={runs} framed={false} navigate={vi.fn()} onSent={vi.fn()} onUndo={vi.fn()} />);
    expect(screen.getByTestId('app-chat-busy').textContent).toMatch(/Building the change · Claude Code…/);
    expect(screen.getAllByTestId('app-chat-step').map((s) => s.getAttribute('data-state'))).toStrictEqual(['now', 'pending', 'pending']);
    expect(screen.getByTestId('app-chat-code').textContent).toBe('review_refused');
    expect(screen.getByTestId('app-chat-reason').textContent).toBe('Nothing landed: The reviewer refused the change: reads a column nobody asked for');
    expect(screen.queryByTestId('app-chat-undo')).toBeNull();
  });
});

// ── live numbers ────────────────────────────────────────────────────────────────────────────

describe('the dashboard\'s live numbers', () => {
  const s = spec();

  it('a card reads the first page\'s KPIs (up to 3) every 30 s, or its own faster refresh (never under 10 s)', () => {
    expect(tileKpis(s).map((k) => k.query)).toStrictEqual(tileKpis(s).map((k) => k.query).slice(0, 3));
    expect(tileEveryMs(s, tileKpis(s))).toBe(30_000);
    const fast = { ...s, queries: s.queries.map((q) => ({ ...q, refresh: { mode: 'every', seconds: 4 } })) } as AppSpec;
    expect(tileEveryMs(fast, tileKpis(fast))).toBe(10_000);
  });

  it('never more than 3 queries at once across every card; nothing while the tab is hidden or a card is off screen', async () => {
    let t = 0;
    let hidden = false;
    const pending: Array<() => void> = [];
    const q = vi.fn(async (): Promise<QueryOutcome> => new Promise((res) => { pending.push(() => res({ ok: true, answer: { columns: [{ name: 'open' }], rows: [[1]] } })); }));
    const sch = new TileScheduler({ query: q, now: () => t, hidden: () => hidden, staggerMs: 0 });
    const handles = Array.from({ length: 6 }, (_, i) => sch.register(`c${i}`, { slug: `a${i}`, version: 1, spec: s }, () => undefined));
    // Off screen: nothing.
    sch.tick();
    expect(q).not.toHaveBeenCalled();
    // Hidden tab: nothing, even when seen.
    hidden = true;
    for (const h of handles) h.seen(true);
    sch.tick();
    expect(q).not.toHaveBeenCalled();
    hidden = false;
    for (let i = 0; i < 6; i += 1) sch.tick();
    await Promise.resolve();
    expect(q.mock.calls.length).toBe(3);
    while (pending.length > 0) { pending.shift()!(); await new Promise((r) => setTimeout(r, 0)); }
    expect(sch.peak).toBeLessThanOrEqual(3);
    expect(q.mock.calls.length).toBeGreaterThan(3);
    // Due again only after its period.
    const before = q.mock.calls.length;
    t = 10_000;
    sch.tick();
    expect(q.mock.calls.length).toBe(before);
  });

  it('a failed refresh shows no numbers and crew\'s code, never the last number as if live', async () => {
    let fail = false;
    const sch = new TileScheduler({ query: async () => (fail ? { ok: false, code: 'contract_changed' } : { ok: true, answer: { columns: tileKpis(s).map((k) => ({ name: k.column })), rows: [tileKpis(s).map(() => 42)] } }), now: () => (fail ? 60_000 : 0), staggerMs: 0, hidden: () => false });
    const seen: Array<{ code: string | null; ok: boolean[] }> = [];
    const h = sch.register('c', { slug: 'a', version: 1, spec: s }, (st) => seen.push({ code: st.code, ok: st.values.map((v) => v.ok) }));
    h.seen(true);
    await waitFor(() => expect(seen).toHaveLength(1));
    expect(seen[0]!.code).toBeNull();
    fail = true;
    sch.tick();
    await waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[1]).toStrictEqual({ code: 'contract_changed', ok: tileKpis(s).map(() => false) });
  });

  it('on the page: a card on screen shows crew\'s live values and "updated"; one crew refuses shows the code and no number', async () => {
    class SeenIO {
      constructor(private readonly cb: IntersectionObserverCallback) {}
      observe(el: Element): void { this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
      disconnect(): void {}
    }
    vi.stubGlobal('IntersectionObserver', SeenIO);
    const kpis = tileKpis(s);
    const { calls } = mockFetch((path) => {
      if (path === '/health') return { body: { status: 'ok', capabilities: { apps: { query: true, actions: true, turns: true, publish: false, uploads: false, sourceCheck: true } } } };
      if (path === '/apps') return { body: { apps: [{ slug: 'desk', name: 'Desk' }, { slug: 'ops', name: 'Ops' }] } };
      if (path === '/apps/desk' || path === '/apps/ops') return { body: { app: { ...detail(), slug: path.slice(6), name: path.slice(6) } } };
      if (path === '/apps/desk/query') return { body: { columns: kpis.map((k) => ({ name: k.column, type: 'integer' })), rows: [kpis.map(() => 5100)], truncated: false, hasMore: false, ms: 3, cachedAt: null } };
      if (path === '/apps/ops/query') return { status: 409, body: { code: 'not_accepted', error: 'no receipt' } };
      if (path === '/editors') return { body: { editors: [] } };
      if (path === '/projects') return { body: { projects: [{ id: 'p', name: 'Mikes' }] } };
      if (path === '/mcp/servers') return { body: { servers: [], discovered: [] } };
      return null;
    });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card-kpi-value').length).toBeGreaterThan(0), { timeout: 4000 });
    const desk = screen.getAllByTestId('apps-card').find((c) => c.getAttribute('data-slug') === 'desk')!;
    const values = [...desk.querySelectorAll('[data-testid="apps-card-kpi-value"]')].map((d) => d.textContent ?? '');
    expect(values).toHaveLength(3);
    expect(values[0]).toMatch(/^5[,.\s ]?100$/u);
    expect(values.every((v) => v !== '—')).toBe(true);
    expect(desk.querySelector('[data-testid="apps-card-updated"]')!.textContent).toMatch(/^updated \d+s ago$/u);
    await waitFor(() => expect(screen.getByTestId('apps-card-code').textContent).toBe('not_accepted'), { timeout: 4000 });
    const ops = screen.getAllByTestId('apps-card').find((c) => c.getAttribute('data-slug') === 'ops')!;
    expect(ops.querySelectorAll('[data-testid="apps-card-kpi-value"]')).toHaveLength(0);
    // Every read went through crew's query route with the app's version, and the new-app chat is offered.
    expect(calls.filter((c) => c.path.endsWith('/query')).every((c) => (c.body as { version?: unknown }).version === 3)).toBe(true);
    expect(screen.getByTestId('apps-new-chat')).toBeTruthy();
  });
});
