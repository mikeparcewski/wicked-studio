import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDetail, AppSpec } from '../src/api/types.js';
import { EditorHost, FOCUS_POLL_MS, type HostUi } from '../src/editors/host.js';
import { AppAdapter, type AppHostPort, type AppMode } from '../src/editors/apps/appAdapter.js';
import { appDataFor, sampleAppData, type PreparedAction } from '../src/editors/apps/appData.js';
import { applyOps } from '../src/editors/apps/appOps.js';
import { AppSession, BURST_MAX_OPS } from '../src/editors/apps/appSession.js';
import { SampleAppStore, type SampleLocks, type StoreResult } from '../src/editors/apps/appStore.js';
import { SAMPLE_APPS } from '../src/editors/apps/samples.js';
import { ActionCardView, editable, urlParamsOf } from '../src/components/editorHost/AppHostView.js';
import { coerceParam } from '../src/plugins/wicked-apps/runtime/runtime.js';
import surfaces from '../src/plugins/wicked-apps/surfaces.json';

/**
 * DES-APPS-001 K4, review round 1 (codex gpt-6.1-sol high + pi): one test per folded finding, each failing without
 * its fix. Numbers are codex's.
 */

const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id !== undefined ? { id } : {}) });
const SPEC = (): AppSpec => structuredClone(SAMPLE_APPS['escalations']!.spec);
class MemStorage implements Storage {
  private m = new Map<string, string>();
  get length(): number { return this.m.size; }
  clear(): void { this.m.clear(); }
  getItem(k: string): string | null { return this.m.get(k) ?? null; }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  removeItem(k: string): void { this.m.delete(k); }
  setItem(k: string, v: string): void { this.m.set(k, v); }
}
const store = (spec = SPEC()) => new SampleAppStore('esc', spec, new MemStorage(), Date.now, null);

afterEach(() => { document.body.innerHTML = ''; document.head.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });

// ── the host ──────────────────────────────────────────────────────────────────────────────

async function hostRig(opts: { confirm?: (p: PreparedAction) => Promise<boolean>; prepare?: () => Promise<unknown> } = {}) {
  const st = store();
  const session = new AppSession(st, { burstMs: 5 });
  await session.load();
  const real = sampleAppData(() => session.landedSpec!, SAMPLE_APPS['escalations']!.data);
  const run = vi.fn(real.run);
  const prepare = vi.fn(opts.prepare ?? real.prepare);
  const move = vi.spyOn(session, 'move');
  const state = { framed: false, mode: 'preview' as AppMode, click: true };
  const app: AppHostPort = {
    session, data: { ...real, prepare: prepare as never, run }, framed: () => state.framed, mode: () => state.mode, viewer: () => 'priya@example.com',
    confirm: vi.fn(opts.confirm ?? (async () => true)), openLink: vi.fn(async () => true),
  };
  const ui: HostUi = { chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(), thread: vi.fn(), fullscreen: vi.fn(async () => false), torn: vi.fn(), log: () => {} };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const host = new EditorHost({
    container, src: 'about:blank', editor: 'wicked-apps', version: '0.13.0', name: 'App', title: 'App', size: 'full', surface: 'full',
    grants: ['artifact.read', 'artifact.write', 'selection.chip'], theme: {}, prefs: { reducedMotion: false, techDetails: false, locale: 'en' },
    firstParty: true, adapter: new AppAdapter(session, 'Escalations'), ui, app, activation: () => state.click, focusInFrame: () => state.click,
  });
  host.mount();
  let p: MessagePort | null = null;
  vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { p = (tr?.[0] as MessagePort) ?? null; }) as never);
  window.dispatchEvent(new MessageEvent('message', { data: env('plugin.ready', { editor: 'wicked-apps', version: '0.13.0', protocol: [1, 2], surfaces }), source: host.frame.contentWindow }));
  const replies: Array<{ re?: string; ok?: boolean; payload?: Record<string, unknown>; error?: { code: string; message: string } }> = [];
  p!.onmessage = (m) => replies.push(m.data as never);
  let n = 0;
  const ask = async (type: string, payload: unknown) => {
    n += 1;
    const id = `q${n}`;
    p!.postMessage(env(type, payload, id));
    await vi.waitFor(() => expect(replies.some((r) => r.re === id)).toBe(true), { timeout: 2_000 });
    return replies.find((r) => r.re === id)!;
  };
  return { host, session, state, ask, run, prepare, move, app, port: p! };
}

describe('codex P1 #1: undo and redo are the person’s, in Edit, never from a frame', () => {
  it('app.history from the runtime: refused in Preview, without a key in the frame, and in a framed host; crew’s pointer never moves', async () => {
    const r = await hostRig();
    expect(await r.ask('app.history', { move: 'undo', base: 1 })).toMatchObject({ ok: false, error: { code: 'refused', message: expect.stringMatching(/Edit/) } });
    r.state.mode = 'edit';
    r.state.click = false;
    expect(await r.ask('app.history', { move: 'undo', base: 1 })).toMatchObject({ ok: false, error: { code: 'refused' } });
    r.state.click = true;
    r.state.framed = true;
    expect(await r.ask('app.history', { move: 'undo', base: 1 })).toMatchObject({ ok: false, error: { code: 'refused', message: expect.stringMatching(/frame/) } });
    expect(await r.ask('spec.edit', { base: 1, ops: [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }] })).toMatchObject({ ok: false, error: { code: 'refused', message: expect.stringMatching(/frame/) } });
    r.state.framed = false;
    r.state.click = false;
    expect(await r.ask('spec.edit', { base: 1, ops: [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }] })).toMatchObject({ ok: false, error: { code: 'refused' } });
    expect(r.move).not.toHaveBeenCalled();
    expect(r.session.pending).toBe(0);
    r.host.teardown('done');
  });
});

describe('codex #3: what allowed the card must still hold when the answer comes', () => {
  it('Run after switching to Edit, or after the card expired, runs nothing', async () => {
    let answer: (yes: boolean) => void = () => {};
    const r = await hostRig({ confirm: () => new Promise<boolean>((res) => { answer = res; }) });
    const asked = r.ask('data.action', { action: 'assign_to_me', params: { id: 4821 } });
    await vi.waitFor(() => expect(r.app.confirm).toHaveBeenCalledTimes(1));
    r.state.mode = 'edit';
    answer(true);
    // The request's own answer, awaited: cancelled, and run never called (codex r2: no early pass).
    expect(await asked).toMatchObject({ ok: true, payload: { state: 'cancelled' } });
    expect(r.run).not.toHaveBeenCalled();
    r.host.teardown('done');
    const e = await hostRig({ prepare: async () => ({ record: 'old', expiresAt: Date.now() - 1, card: { action: 'assign_to_me', kind: 'row-write', source: 's', operation: 'UPDATE t', rows: [], key: 'id = 1', checks: null, request: 'UPDATE', says: null, sample: true } }) });
    const out = await e.ask('data.action', { action: 'assign_to_me', params: { id: 4821 } });
    expect(out).toMatchObject({ ok: true, payload: { state: 'cancelled' } });
    expect(e.run).not.toHaveBeenCalled();
    e.host.teardown('done');
  });
});

describe('codex #4: a live action is never offered against made-up rows', () => {
  it('actions on and queries off is samples for both; queries on and actions off says which half is a sample', () => {
    const sample = () => sampleAppData(SPEC, null);
    expect(appDataFor({ query: false, actions: true, turns: false, publish: false, uploads: false, sourceCheck: true }, 'esc', sample).kind).toStrictEqual({ queries: 'sample', actions: 'sample' });
    expect(appDataFor({ query: true, actions: false, turns: false, publish: false, uploads: false, sourceCheck: true }, 'esc', sample).kind).toStrictEqual({ queries: 'crew', actions: 'sample' });
    expect(appDataFor({ query: true, actions: true, turns: false, publish: false, uploads: false, sourceCheck: true }, 'esc', sample).kind).toStrictEqual({ queries: 'crew', actions: 'crew' });
  });
});

// ── the session ───────────────────────────────────────────────────────────────────────────

function deferred<T>() { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r; }); return { promise, resolve }; }

describe('codex #5-#9, #11, #12: the session under interleavings', () => {
  it('#8 a second undo while one is landing is refused, never re-based onto the first’s result', async () => {
    const st = store();
    const s = new AppSession(st, { burstMs: 5 });
    await s.load();
    s.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }]);
    await s.flush();
    const gate = deferred<StoreResult>();
    const real = st.move.bind(st);
    const move = vi.spyOn(st, 'move').mockImplementationOnce(async (d, b) => { const r = await real(d, b); return gate.promise.then(() => r); });
    const first = s.move('undo', 2);
    const second = await s.move('undo', 2);
    expect(second).toMatchObject({ ok: false, code: 'refused' });
    gate.resolve(undefined as never);
    expect(await first).toMatchObject({ ok: true, version: 3 });
    expect(move).toHaveBeenCalledTimes(1);
    expect(move.mock.calls[0]).toStrictEqual(['undo', 2]);
  });

  it('#7 an edit while an undo lands is refused (said), never silently dropped', async () => {
    const st = store();
    const s = new AppSession(st, { burstMs: 5 });
    await s.load();
    s.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }]);
    await s.flush();
    const gate = deferred<void>();
    const real = st.move.bind(st);
    vi.spyOn(st, 'move').mockImplementationOnce(async (d, b) => { await gate.promise; return real(d, b); });
    const moving = s.move('undo', 2);
    await Promise.resolve();
    expect(s.edit(2, [{ op: 'component-move', id: 'by_region', x: 6, y: 9 }])).toMatchObject({ ok: false, code: 'refused', message: expect.stringMatching(/undo or redo/) });
    gate.resolve();
    await moving;
    expect(s.pending).toBe(0);
  });

  it('#9 if the burst before an undo is refused, nothing is undone', async () => {
    const st = store();
    const s = new AppSession(st, { burstMs: 1_000 });
    await s.load();
    s.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }]);
    vi.spyOn(st, 'edit').mockResolvedValueOnce({ ok: false, code: 'stale_base', message: 'moved', head: 1 });
    const move = vi.spyOn(st, 'move');
    expect(await s.move('undo', 1)).toMatchObject({ ok: false, message: expect.stringMatching(/did not land/) });
    expect(move).not.toHaveBeenCalled();
  });

  it('#5 a burst lands within its maximum age however often ops keep coming, and holds at most its size while landing', async () => {
    vi.useFakeTimers();
    const st = store();
    const edit = vi.spyOn(st, 'edit');
    const s = new AppSession(st, { burstMs: 1_000 });
    await s.load();
    for (let i = 0; i < 12; i += 1) { s.edit(s.head, [{ op: 'component-move', id: 'weekly', x: 0, y: 3 + (i % 4) }]); await vi.advanceTimersByTimeAsync(600); }
    expect(edit.mock.calls.length).toBeGreaterThanOrEqual(1);
    edit.mockClear();
    const gate = deferred<void>();
    const real = st.edit.bind(st);
    edit.mockImplementationOnce(async (b, sp, sum) => { await gate.promise; return real(b, sp, sum); });
    const base = s.head;
    for (let i = 0; i < BURST_MAX_OPS; i += 1) s.edit(base, [{ op: 'component-move', id: 'weekly', x: 0, y: i % 7 }]);
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < BURST_MAX_OPS; i += 1) s.edit(base, [{ op: 'component-move', id: 'weekly', x: 0, y: i % 7 }]);
    expect(s.edit(base, [{ op: 'component-move', id: 'weekly', x: 0, y: 1 }])).toMatchObject({ ok: false, message: expect.stringMatching(/still saving/) });
    gate.resolve();
    await vi.advanceTimersByTimeAsync(2_000);
  });

  it('#11 closing the view lands an acknowledged burst instead of dropping it', async () => {
    const st = store();
    const edit = vi.spyOn(st, 'edit');
    const s = new AppSession(st, { burstMs: 60_000 });
    await s.load();
    s.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }]);
    s.dispose();
    await vi.waitFor(() => expect(edit).toHaveBeenCalledTimes(1));
    expect((await st.detail()).head.version).toBe(2);
  });

  it('#12 a refresh that drops a burst says the count is 0; #6 an answer begun before a turn change is obsolete', async () => {
    const mem = new MemStorage();
    const a = new AppSession(new SampleAppStore('esc', SPEC(), mem, Date.now, null), { burstMs: 60_000 });
    const b = new AppSession(new SampleAppStore('esc', SPEC(), mem, Date.now, null), { burstMs: 5 });
    await a.load();
    await b.load();
    b.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }]);
    await b.flush();
    const counts: number[] = [];
    a.on((e) => { if (e.kind === 'pending') counts.push(e.count); });
    a.edit(1, [{ op: 'component-move', id: 'by_region', x: 6, y: 9 }]);
    await a.refresh();
    expect(counts.at(-1)).toBe(0);
    expect(a.pending).toBe(0);
    // A refresh whose GET left before another change of the head (here a landing) is dropped.
    const st = (a as unknown as { store: SampleAppStore }).store;
    const old = await st.detail();
    const gate = deferred<AppDetail>();
    vi.spyOn(st, 'detail').mockImplementationOnce(() => gate.promise);
    const pending = a.refresh();
    a.edit(2, [{ op: 'component-move', id: 'by_region', x: 6, y: 10 }]);
    await a.flush();
    gate.resolve({ ...old, turn: { runId: 'r-old', startedAt: 1, base: 2, actor: 'x' } });
    await pending;
    expect(a.readonly).toBe(false);
    a.dispose();
    b.dispose();
  });
});

describe('codex #10: the sample store’s transaction holds a lock named for the app', () => {
  it('edit and move run inside navigator.locks-style locks', async () => {
    const names: string[] = [];
    const locks: SampleLocks = { request: async (name, cb) => { names.push(name); return cb(); } };
    const st = new SampleAppStore('esc', SPEC(), new MemStorage(), Date.now, locks);
    await st.edit(1, SPEC(), 'x');
    await st.move('undo', 2);
    expect(names).toStrictEqual(['wicked-apps-sample:esc', 'wicked-apps-sample:esc', 'wicked-apps-sample:esc']); // first use, edit, move
  });
});

describe('codex #22: a new component lands under crew’s binding rules', () => {
  it('a button picks an action that needs nothing from the page, or is refused; a form gets one bound field per parameter', () => {
    const spec = SPEC(); // its only action, assign_to_me, requires id
    expect(applyOps(spec, [{ op: 'component-add', page: 'overview', type: 'button', box: { x: 0, y: 20, w: 2, h: 1 } }])).toMatchObject({ ok: false, message: expect.stringMatching(/needs no values/) });
    const f = applyOps(spec, [{ op: 'component-add', page: 'overview', type: 'form', box: { x: 0, y: 20, w: 4, h: 4 } }]);
    expect(f.ok && f.spec.pages[0]!.components.find((c) => c.id === 'form1')).toMatchObject({
      type: 'form', fields: [{ name: 'id', input: 'number', required: true }], submit: { action: 'assign_to_me', params: { id: 'form.id' } },
    });
    const withFree = SPEC();
    withFree.actions.push({ id: 'ping', kind: 'api', source: 'ops', call: { kind: 'tool', tool: 'POST /ping' }, args: {} });
    expect(applyOps(withFree, [{ op: 'component-add', page: 'overview', type: 'button', box: { x: 0, y: 20, w: 2, h: 1 } }])).toMatchObject({ ok: true });
    const needs = SPEC();
    needs.queries = [{ id: 'q', source: 's', kind: 'sql', params: { type: 'object', properties: { team: { type: 'string' } }, required: ['team'] }, output: [{ name: 'n', type: 'integer' }] }];
    expect(applyOps(needs, [{ op: 'component-add', page: 'overview', type: 'table', box: { x: 0, y: 20, w: 4, h: 2 } }])).toMatchObject({ ok: false });
    expect(applyOps(needs, [{ op: 'bind', id: 'kpi_open', query: 'q' }])).toMatchObject({ ok: false, message: expect.stringMatching(/needs team/) });
  });
});

// ── the runtime ───────────────────────────────────────────────────────────────────────────

const TEMPLATE = readFileSync(join(__dirname, '../src/plugins/wicked-apps/template.html'), 'utf8');
type Answer = (type: string, payload: Record<string, unknown>) => unknown;
async function boot(spec: AppSpec, answer: Answer, app: Record<string, unknown> = { framed: false, mode: 'preview' }) {
  vi.resetModules();
  const style = document.createElement('style');
  style.id = 'wk-apps-sheet';
  style.textContent = /<style id="wk-apps-sheet">([\s\S]*?)<\/style>/u.exec(TEMPLATE)![1]!;
  document.head.append(style);
  const { startRuntime } = await import('../src/plugins/wicked-apps/runtime/runtime.js');
  startRuntime({ editor: 'wicked-apps', surfaces: {} });
  const ch = new MessageChannel();
  const seen: Array<{ type: string; payload: Record<string, unknown> }> = [];
  let current = spec;
  ch.port1.onmessage = (m) => {
    const d = m.data as { type: string; id?: string; payload: Record<string, unknown> };
    seen.push(d);
    if (d.id === undefined) return;
    const reply = (payload: unknown): void => ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload });
    if (d.type === 'artifact.read') reply({ version: 1, content: { type: 'app', spec: current } });
    else void Promise.resolve(answer(d.type, d.payload)).then(reply);
  };
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: { p: 'wicked.editor', v: 1, type: 'host.hello', payload: { protocol: 2, surface: 'full', grants: ['artifact.read', 'artifact.write', 'selection.chip', 'data.read', 'data.write'], app, theme: {}, prefs: { locale: 'en' } } },
    source: window, ports: [ch.port2],
  }));
  await vi.waitFor(() => expect(document.querySelector('.wk-grid')).not.toBeNull());
  return { seen, host: ch.port1, setSpec: (s: AppSpec) => { current = s; } };
}
const base = (components: AppSpec['pages'][number]['components'], extra: Partial<AppSpec> = {}): AppSpec => ({
  schema: 'wicked.apps/v1', name: 'T', linkHosts: [], pages: [{ id: 'p1', title: 'One', components }], queries: [], actions: [], ...extra,
});
const rowsFor = (q: { output: { name: string }[] }, rows: unknown[][]) => ({ columns: q.output, rows, truncated: false, hasMore: false, ms: 1, cachedAt: null });

describe('codex #14, #15, #24, #21: filters, ids, URL parameters and types', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('a select shows its declared default before the first read; ids like constructor are plain keys; url.* and form types reach the request', async () => {
    const q = { id: 'constructor', source: 's', kind: 'sql' as const, params: { type: 'object' as const, properties: { team: { type: 'string' as const }, region: { type: 'string' as const } } }, output: [{ name: 'n', type: 'integer' as const }] };
    const spec = base([
      { id: 'team', type: 'filter', filter: 'select', options: { kind: 'values', values: [{ value: 'finance' }, { value: 'ops' }] }, default: 'finance', box: { x: 0, y: 0, w: 3, h: 1 } },
      { id: 'k', type: 'kpi', data: { query: 'constructor', params: { team: 'filter.team', region: 'url.region' } }, value: 'n', box: { x: 3, y: 0, w: 3, h: 2 } },
      { id: 'constructor', type: 'form', fields: [{ name: 'amount', input: 'number' }], submit: { label: 'Go', action: 'pay', params: { amount: 'form.amount' } }, box: { x: 0, y: 2, w: 4, h: 3 } },
    ], { queries: [q], actions: [{ id: 'pay', kind: 'api', source: 's', call: { kind: 'tool', tool: 'POST /pay' }, args: {}, params: { type: 'object', properties: { amount: { type: 'number' } } } }] });
    const { seen } = await boot(spec, (type) => (type === 'data.query' ? rowsFor(q, [[7]]) : { state: 'cancelled' }), { framed: false, mode: 'preview', url: { region: 'EMEA', 'bad name': 'x' } });
    await vi.waitFor(() => expect(document.querySelector('.wk-kpi-value')?.textContent).toBe('7'));
    expect((document.querySelector('[data-component="team"] select') as HTMLSelectElement).value).toBe('finance');
    expect(seen.find((m) => m.type === 'data.query')!.payload).toStrictEqual({ query: 'constructor', params: { team: 'finance', region: 'EMEA' } });
    const input = document.querySelector('[data-component="constructor"] input') as HTMLInputElement;
    input.value = '12.5';
    input.dispatchEvent(new Event('input'));
    (document.querySelector('[data-component="constructor"] button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(seen.find((m) => m.type === 'data.action')?.payload).toStrictEqual({ action: 'pay', params: { amount: 12.5 } }));
    expect(coerceParam({ type: 'integer' }, '12.5')).toBe('12.5');
    expect(coerceParam({ type: 'integer' }, '12')).toBe(12);
    expect(coerceParam({ type: 'boolean' }, 'true')).toBe(true);
    expect(coerceParam({ type: 'string' }, 4821)).toBe('4821');
  });
});

describe('codex #13, #26, #23, #20: results, partial answers, charts, rules per draw', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('#13 a re-read at the same version with another binding drops the old rows; #26 a cut answer says so', async () => {
    const q1 = { id: 'one', source: 's', kind: 'sql' as const, output: [{ name: 'v', type: 'string' as const }] };
    const q2 = { id: 'two', source: 's', kind: 'sql' as const, output: [{ name: 'v', type: 'string' as const }] };
    const spec = base([{ id: 't', type: 'table', data: { query: 'one' }, box: { x: 0, y: 0, w: 12, h: 4 } }], { queries: [q1, q2] });
    const { host, setSpec } = await boot(spec, (_t, p) => (p['query'] === 'one' ? rowsFor(q1, [['from one']]) : { ...rowsFor(q2, [['from two']]), truncated: true }));
    await vi.waitFor(() => expect(document.querySelector('.wk-table td')?.textContent).toBe('from one'));
    const next = structuredClone(spec);
    (next.pages[0]!.components[0] as { data: { query: string } }).data.query = 'two';
    setSpec(next);
    host.postMessage({ p: 'wicked.editor', v: 1, type: 'artifact.changed', payload: { version: 1 } });
    await vi.waitFor(() => expect(document.querySelector('.wk-table td')?.textContent).toBe('from two'));
    expect(document.querySelector('.wk-table-foot')!.textContent).toMatch(/cut at the app’s limit/);
  });

  it('#23 every bar series is drawn, stacking adds up, a negative value runs left of zero; #20 a colour never carries to another page', async () => {
    const q = { id: 'r', source: 's', kind: 'sql' as const, output: [{ name: 'c', type: 'string' as const }, { name: 'a', type: 'integer' as const }, { name: 'b', type: 'integer' as const }] };
    const spec: AppSpec = { ...base([{ id: 'bars', type: 'chart', chart: 'bar', data: { query: 'r' }, x: 'c', series: [{ column: 'a', color: '#ff0000' }, { column: 'b' }], box: { x: 0, y: 0, w: 6, h: 4 } }], { queries: [q] }) };
    spec.pages.push({ id: 'p2', title: 'Two', components: [{ id: 'plain', type: 'chart', chart: 'bar', data: { query: 'r' }, x: 'c', series: [{ column: 'a' }], box: { x: 0, y: 0, w: 6, h: 4 } }] });
    await boot(spec, () => rowsFor(q, [['x', 3, -2], ['y', 1, 4]]));
    await vi.waitFor(() => expect(document.querySelectorAll('.wk-chart--bar rect')).toHaveLength(4));
    const rects = [...document.querySelectorAll('.wk-chart--bar rect')];
    expect(rects.map((r) => r.getAttribute('class'))).toStrictEqual(['wk-series-0', 'wk-series-1', 'wk-series-0', 'wk-series-1']);
    const zero = Number(document.querySelector('.wk-chart--bar line')!.getAttribute('x1'));
    expect(Number(rects[1]!.getAttribute('x'))).toBeLessThan(zero); // -2 runs left of zero
    const css = (): string => [...(document.getElementById('wk-apps-sheet') as HTMLStyleElement).sheet!.cssRules].map((r) => r.cssText).join('\n');
    expect(css()).toMatch(/--c0:\s*#ff0000/u);
    (document.querySelectorAll('.wk-page')[1] as HTMLButtonElement).click();
    await vi.waitFor(() => expect(document.querySelector('[data-component="plain"]')).not.toBeNull());
    expect(css()).not.toMatch(/--c0:\s*#/u);
  });
});

describe('codex #25, #17 and pi: refresh per query, the palette by keyboard, teardown', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('a 15 s query re-reads alone; Enter on a palette tile adds it; teardown stops every timer', async () => {
    const fast = { id: 'fast', source: 's', kind: 'sql' as const, refresh: { mode: 'every' as const, seconds: 15 }, output: [{ name: 'n', type: 'integer' as const }] };
    const slow = { id: 'slow', source: 's', kind: 'sql' as const, output: [{ name: 'n', type: 'integer' as const }] };
    const spec = base([
      { id: 'a', type: 'kpi', data: { query: 'fast' }, value: 'n', box: { x: 0, y: 0, w: 3, h: 2 } },
      { id: 'b', type: 'kpi', data: { query: 'slow' }, value: 'n', box: { x: 3, y: 0, w: 3, h: 2 } },
    ], { queries: [fast, slow] });
    const intervals: Array<() => void> = [];
    const realSet = window.setInterval;
    const cleared: unknown[] = [];
    vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void) => { intervals.push(fn); return intervals.length as never; }) as never);
    vi.spyOn(window, 'clearInterval').mockImplementation(((id: unknown) => { cleared.push(id); }) as never);
    const { seen, host } = await boot(spec, (_t, p) => rowsFor(p['query'] === 'fast' ? fast : slow, [[1]]), { framed: false, mode: 'edit' });
    await vi.waitFor(() => expect(seen.filter((m) => m.type === 'data.query')).toHaveLength(2));
    expect(intervals).toHaveLength(1);
    intervals[0]!();
    await vi.waitFor(() => expect(seen.filter((m) => m.type === 'data.query')).toHaveLength(3));
    expect(seen.filter((m) => m.type === 'data.query').at(-1)!.payload['query']).toBe('fast');
    // Enter on a tile is a click with no pointer (detail 0): one component-add.
    const tile = document.querySelector('[data-palette="text"]') as HTMLButtonElement;
    tile.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    await vi.waitFor(() => expect(seen.find((m) => m.type === 'spec.edit')?.payload).toMatchObject({ ops: [{ op: 'component-add', type: 'text' }] }));
    host.postMessage({ p: 'wicked.editor', v: 1, type: 'host.teardown', payload: { reason: 'x' } });
    await vi.waitFor(() => expect(cleared).toContain(1));
    window.setInterval = realSet;
  });
});

describe('codex #28, #16: the card’s own gate and the frame’s width', () => {
  it('Run is disabled when the card appears and armed after 600 ms; an expired card answers no', async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn();
    const prepared: PreparedAction = { record: 'r', expiresAt: Date.now() + 3_000, card: { action: 'assign_to_me', kind: 'row-write', source: 's', operation: 'UPDATE t', rows: [], key: 'id = 1', checks: null, request: 'UPDATE', says: null, sample: false } };
    render(<ActionCardView asking={{ prepared, resolve: () => {}, at: Date.now() }} onAnswer={onAnswer} />);
    const run = screen.getByTestId('apps-card-run') as HTMLButtonElement;
    expect(run.disabled).toBe(true);
    run.click();
    expect(onAnswer).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(650); });
    expect(run.disabled).toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000); });
    expect(onAnswer).toHaveBeenCalledWith(false);
  });

  it('Edit needs the frame itself at least 640 px wide; url.* parameters are read from the address', () => {
    expect(editable(true, 844)).toBe(true);
    expect(editable(true, 520)).toBe(false);
    expect(editable(false, 900)).toBe(false);
    expect(editable(true, null)).toBe(true);
    expect({ ...urlParamsOf('?editor=x&url.region=EMEA&url.bad%20name=1&url.constructor=y') }).toStrictEqual({ region: 'EMEA', constructor: 'y' });
  });
});

describe('a typed Properties field commits while focus is in the frame', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('each keystroke commits (focus still in the frame), and the field keeps its focus and text across the redraw', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const kq = { id: 'k', source: 's', kind: 'sql' as const, output: [{ name: 'n', type: 'integer' as const }] };
    const spec = base([{ id: 'note', type: 'text', text: 'Hello', box: { x: 0, y: 0, w: 6, h: 1 } }, { id: 'kpi', type: 'kpi', data: { query: 'k' }, value: 'n', box: { x: 6, y: 0, w: 3, h: 2 } }], { queries: [kq] });
    const { seen } = await boot(spec, (type, p) => (type === 'spec.edit'
      ? { spec: { ...spec, pages: [{ ...spec.pages[0]!, components: [{ ...spec.pages[0]!.components[0]!, title: (p['ops'] as Array<{ value: string }>)[0]!.value }, spec.pages[0]!.components[1]!] }] }, added: [], pending: 1 }
      : type === 'data.query' ? rowsFor(kq, [[3]]) : {}), { framed: false, mode: 'edit' });
    await vi.waitFor(() => expect(seen.filter((m) => m.type === 'data.query')).toHaveLength(1));
    // jsdom has no PointerEvent or pointer capture: mouse events of the pointer types, and a no-op capture.
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
    const note = document.querySelector('[data-component="note"]') as HTMLElement;
    note.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    note.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    await vi.waitFor(() => expect(document.querySelector('[data-prop="title"]')).not.toBeNull());
    const title = document.querySelector('[data-prop="title"]') as HTMLInputElement;
    title.focus();
    title.value = 'Greeting';
    title.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(seen.filter((m) => m.type === 'spec.edit')).toHaveLength(1));
    expect(seen.find((m) => m.type === 'spec.edit')!.payload).toMatchObject({ ops: [{ op: 'component-set', id: 'note', prop: 'title', value: 'Greeting' }] });
    await vi.waitFor(() => expect((document.activeElement as HTMLElement | null)?.getAttribute('data-prop')).toBe('title'));
    expect((document.activeElement as HTMLInputElement).value).toBe('Greeting');
    // The same node (codex r3: its IME composition and native undo survive), and the change that follows on leaving
    // sends nothing more, after a real port round trip (codex r3: no early pass).
    expect(document.activeElement).toBe(title);
    title.dispatchEvent(new Event('change'));
    await new Promise((res) => setTimeout(res, 60));
    expect(seen.filter((m) => m.type === 'spec.edit')).toHaveLength(1);
    // A title edit reads no data (codex r3: per-keystroke edits must not re-query the page): still the first read only.
    expect(seen.filter((m) => m.type === 'data.query')).toHaveLength(1);
  });
});

describe('a spec op from a gesture that just left the frame (a field committed by clicking studio’s chrome)', () => {
  const edit = (value: string, base: number) => ({ base, ops: [{ op: 'component-set', id: 'by_region', prop: 'title', value }] });
  const tick = () => new Promise((res) => setTimeout(res, FOCUS_POLL_MS + 120));

  it('is taken within 1.5 s of the last moment the frame held focus and activation, refused after; actions and history never get the grace', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const r = await hostRig();
    r.state.mode = 'edit';
    const g = { focus: true, activation: true };
    const o = (r.host as unknown as { o: { activation: () => boolean; focusInFrame: () => boolean } }).o;
    o.activation = () => g.activation;
    o.focusInFrame = () => g.focus;
    await tick(); // the person is typing in the frame: the poll sees focus and activation
    g.focus = false; // then clicks studio's chrome (fresh activation, focus gone)
    now += 1_000;
    expect(await r.ask('spec.edit', edit('By region', 1))).toMatchObject({ ok: true });
    expect(await r.ask('app.history', { move: 'undo', base: 1 })).toMatchObject({ ok: false, error: { code: 'refused' } });
    now += 600;
    expect(await r.ask('spec.edit', edit('Gone', r.session.head))).toMatchObject({ ok: false, error: { code: 'refused' } });
    // Focus leaving the frame starts nothing by itself, whichever event says so.
    r.host.frame.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    expect(await r.ask('spec.edit', edit('Again', r.session.head))).toMatchObject({ ok: false, error: { code: 'refused' } });
    r.host.teardown('done');
  });

  it('codex r9 P1: a frame idle until its activation expired, then a click on studio’s chrome, is refused', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const r = await hostRig();
    r.state.mode = 'edit';
    const g = { focus: true, activation: false };
    const o = (r.host as unknown as { o: { activation: () => boolean; focusInFrame: () => boolean } }).o;
    o.activation = () => g.activation;
    o.focusInFrame = () => g.focus;
    await tick(); // focus sits in the frame with no activation
    now += 10_000;
    g.focus = false;
    g.activation = true; // the click on studio's chrome
    r.host.frame.dispatchEvent(new Event('blur'));
    window.dispatchEvent(new Event('focus'));
    await tick();
    expect(await r.ask('spec.edit', edit('Hijacked', 1))).toMatchObject({ ok: false, error: { code: 'refused' } });
    expect(r.session.head).toBe(1);
    r.host.teardown('done');
  });
});

describe('a spec op made in Edit and committed as the person clicks Preview', () => {
  it('is Edit’s while the host page says editing (just left Edit); an action never takes that grace', async () => {
    const r = await hostRig();
    r.state.mode = 'preview';
    (r.app as { editing?: () => boolean }).editing = () => true;
    expect(await r.ask('spec.edit', { base: 1, ops: [{ op: 'component-set', id: 'by_region', prop: 'title', value: 'By region' }] })).toMatchObject({ ok: true });
    (r.app as { editing?: () => boolean }).editing = () => false;
    expect(await r.ask('spec.edit', { base: 1, ops: [{ op: 'component-set', id: 'by_region', prop: 'title', value: 'Later' }] })).toMatchObject({ ok: false, error: { code: 'refused' } });
    r.state.mode = 'edit';
    (r.app as { editing?: () => boolean }).editing = () => true;
    expect(await r.ask('data.action', { action: 'assign_to_me', params: { id: 4821 } })).toMatchObject({ ok: false, error: { code: 'refused' } });
    r.host.teardown('done');
  });
});

// ── review round 2 (codex gpt-6.1-sol high) ─────────────────────────────────────────────────

describe('codex r2 #2, #3, #4: the session and the sample store', () => {
  it('#2 an undo that arrives while a landing is in flight aborts when that landing is refused', async () => {
    const st = store();
    const s = new AppSession(st, { burstMs: 5 });
    await s.load();
    const gate = deferred<StoreResult>();
    vi.spyOn(st, 'edit').mockImplementationOnce(() => gate.promise);
    const move = vi.spyOn(st, 'move');
    s.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }]);
    await new Promise((res) => setTimeout(res, 20)); // the burst timer started the landing
    const undo = s.move('undo', 1);
    gate.resolve({ ok: false, code: 'stale_base', message: 'moved', head: 1 });
    expect(await undo).toMatchObject({ ok: false, message: expect.stringMatching(/did not land/) });
    expect(move).not.toHaveBeenCalled();
  });

  it('#3 a store opened late never writes its own older copy over another tab’s; first use writes under the lock', async () => {
    const mem = new MemStorage();
    const a = new SampleAppStore('esc', SPEC(), mem, Date.now, null);
    await a.edit(1, SPEC(), 'x'); // v2 in storage
    const writes = vi.spyOn(mem, 'setItem');
    const names: string[] = [];
    const late = new SampleAppStore('esc', SPEC(), mem, Date.now, { request: async (n, cb) => { names.push(n); return cb(); } });
    expect((await late.detail()).head.version).toBe(2);
    expect(writes).not.toHaveBeenCalled();
    expect(names[0]).toBe('wicked-apps-sample:esc');
  });

  it('#4 a batch that would take a burst past its maximum lands the burst so far first', async () => {
    const st = store();
    const edit = vi.spyOn(st, 'edit');
    const s = new AppSession(st, { burstMs: 60_000 });
    await s.load();
    for (let i = 0; i < BURST_MAX_OPS - 1; i += 1) s.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: i % 7 }]);
    const batch = Array.from({ length: 50 }, (_, i) => ({ op: 'component-move', id: 'by_region', x: 6, y: i % 7 }));
    expect(s.edit(1, batch)).toMatchObject({ ok: true, pending: BURST_MAX_OPS - 1 + 50 });
    expect(edit).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(s.head).toBe(2));
    expect(s.pending).toBe(50);
    s.dispose();
  });
});

describe('codex r2 #6, #7, r1 #23 (stacking), #12, #13: the runtime', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('#6 a checkbox sends false until ticked; a declared default shows and sends as such', async () => {
    const spec = base([{ id: 'f', type: 'form', fields: [{ name: 'urgent', input: 'checkbox' }, { name: 'notify', input: 'checkbox' }], submit: { label: 'Go', action: 'flag', params: { urgent: 'form.urgent', notify: 'form.notify' } }, box: { x: 0, y: 0, w: 4, h: 3 } }],
      { actions: [{ id: 'flag', kind: 'api', source: 's', call: { kind: 'tool', tool: 'POST /flag' }, args: {}, params: { type: 'object', properties: { urgent: { type: 'boolean' }, notify: { type: 'boolean', default: true } }, required: ['urgent'] } }] });
    const { seen } = await boot(spec, () => ({ state: 'cancelled' }));
    const boxes = [...document.querySelectorAll('[data-component="f"] input[type="checkbox"]')] as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toStrictEqual([false, true]);
    (document.querySelector('[data-component="f"] button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(seen.find((m) => m.type === 'data.action')?.payload).toStrictEqual({ action: 'flag', params: { urgent: false, notify: true } }));
  });

  it('#7 / #23 stacked bars add up; a stacked area is a band on the one before it; a negative value stacks below zero', async () => {
    const q = { id: 'r', source: 's', kind: 'sql' as const, output: [{ name: 'c', type: 'string' as const }, { name: 'a', type: 'integer' as const }, { name: 'b', type: 'integer' as const }] };
    const spec = base([
      { id: 'sb', type: 'chart', chart: 'bar', stacked: true, data: { query: 'r' }, x: 'c', series: [{ column: 'a' }, { column: 'b' }], box: { x: 0, y: 0, w: 6, h: 4 } },
      { id: 'sa', type: 'chart', chart: 'area', stacked: true, data: { query: 'r' }, x: 'c', series: [{ column: 'a' }, { column: 'b' }], box: { x: 6, y: 0, w: 6, h: 4 } },
    ], { queries: [q] });
    await boot(spec, () => rowsFor(q, [['x', 10, 10], ['y', 10, -8]]));
    await vi.waitFor(() => expect(document.querySelectorAll('[data-component="sb"] rect')).toHaveLength(4));
    const rect = (i: number) => document.querySelectorAll('[data-component="sb"] rect')[i]!;
    // Row x: a's segment ends where b's begins.
    expect(Number(rect(0).getAttribute('x')) + Number(rect(0).getAttribute('width'))).toBeCloseTo(Number(rect(1).getAttribute('x')), 0);
    // Row y: b (-8) runs left of a's start (zero).
    expect(Number(rect(3).getAttribute('x'))).toBeLessThan(Number(rect(2).getAttribute('x')));
    const paths = [...document.querySelectorAll('[data-component="sa"] path.wk-area')].map((p) => ({ d: p.getAttribute('d')!, neg: p.classList.contains('wk-area--neg') }));
    // a's band, b's positive band, b's negative band (diverging stacks: none overlaps another).
    expect(paths.map((p) => p.neg)).toStrictEqual([false, false, true]);
    // Each band: its upper edge left to right, then its lower edge right to left. b crosses zero between the rows, so
    // there are three positions: row x, the crossing, row y.
    const edges = (d: string): { upper: number[]; lower: number[] } => {
      const ys = [...d.matchAll(/[\d.]+,([\d.]+)/gu)].map((m) => Number(m[1]));
      const n = ys.length / 2;
      return { upper: ys.slice(0, n), lower: ys.slice(n).reverse() };
    };
    const [a, bPos, bNeg] = paths.map((p) => edges(p.d)) as [ReturnType<typeof edges>, ReturnType<typeof edges>, ReturnType<typeof edges>];
    expect(a.upper).toHaveLength(3);
    expect(bPos.lower[0]!).toBeCloseTo(a.upper[0]!, 0); // row x: b sits on a
    expect(bPos.upper[1]!).toBeCloseTo(bPos.lower[1]!, 0); // the crossing: b tapers to nothing
    expect(bPos.upper[2]!).toBeCloseTo(bPos.lower[2]!, 0); // row y: no positive part
    const zeroY = a.lower[2]!;
    expect(bNeg.upper[2]!).toBeCloseTo(zeroY, 0); // row y: b's negative band hangs from zero…
    expect(bNeg.lower[2]!).toBeGreaterThan(zeroY); // …down to -8
    expect(bNeg.lower[1]!).toBeCloseTo(bNeg.upper[1]!, 0); // and starts at the crossing with no thickness
    // b's stroke is split at its sign change: one run on its positive edge, one on its negative edge.
    expect([...document.querySelectorAll('[data-component="sa"] polyline.wk-series-1')].map((l) => l.getAttribute('points')!.split(' ').length)).toStrictEqual([2, 2]);
  });

  it('pi r5: a crossing that rounds (7 then -36: the interpolated value is -8.9e-16, not 0) still draws both stroke runs', async () => {
    const q = { id: 'r', source: 's', kind: 'sql' as const, output: [{ name: 'c', type: 'string' as const }, { name: 'a', type: 'integer' as const }, { name: 'b', type: 'integer' as const }] };
    const spec = base([{ id: 'sa', type: 'chart', chart: 'area', stacked: true, data: { query: 'r' }, x: 'c', series: [{ column: 'a' }, { column: 'b' }], box: { x: 0, y: 0, w: 6, h: 4 } }], { queries: [q] });
    await boot(spec, () => rowsFor(q, [['x', 5, 7], ['y', 5, -36]]));
    await vi.waitFor(() => expect(document.querySelector('[data-component="sa"] path.wk-area')).not.toBeNull());
    expect([...document.querySelectorAll('[data-component="sa"] polyline.wk-series-1')].map((l) => l.getAttribute('points')!.split(' ').length)).toStrictEqual([2, 2]);
  });

  it('#12 spec ids named like Object.prototype members are plain keys (filters, forms, sample rows); nothing inherited changes', async () => {
    const q = { id: 'constructor', source: 's', kind: 'sql' as const, params: { type: 'object' as const, properties: { s: { type: 'string' as const } } }, output: [{ name: 'v', type: 'string' as const }] };
    const spec = base([
      { id: 'toString', type: 'filter', filter: 'search', box: { x: 0, y: 0, w: 3, h: 1 } },
      { id: 'valueOf', type: 'table', data: { query: 'constructor', params: { s: 'filter.toString' } }, box: { x: 0, y: 1, w: 6, h: 3 } },
    ], { queries: [q] });
    const sample = sampleAppData(() => spec, { rows: Object.assign(Object.create(null), { constructor: [['alpha'], ['beta']] }), viewer: null });
    const { seen } = await boot(spec, (_t, p) => sample.query(1, p['query'] as string, (p['params'] ?? {}) as Record<string, unknown>));
    await vi.waitFor(() => expect(document.querySelectorAll('[data-component="valueOf"] tbody tr')).toHaveLength(2));
    expect(seen.find((m) => m.type === 'data.query')!.payload).toStrictEqual({ query: 'constructor', params: {} });
    const input = document.querySelector('[data-component="toString"] input') as HTMLInputElement;
    input.value = 'alp';
    input.dispatchEvent(new Event('input'));
    await vi.waitFor(() => expect(document.querySelectorAll('[data-component="valueOf"] tbody tr')).toHaveLength(1), { timeout: 2_000 });
    expect(typeof ({} as Record<string, unknown>)['toString']).toBe('function');
    expect(Object.getOwnPropertyNames(Object.prototype)).not.toContain('alp');
  });

  it('#13 a refresh of one query never discards another component’s answer in flight; an older answer for the same component is', async () => {
    const fast = { id: 'fast', source: 's', kind: 'sql' as const, refresh: { mode: 'every' as const, seconds: 15 }, output: [{ name: 'n', type: 'integer' as const }] };
    const slow = { id: 'slow', source: 's', kind: 'sql' as const, output: [{ name: 'n', type: 'integer' as const }] };
    const spec = base([
      { id: 'a', type: 'kpi', data: { query: 'fast' }, value: 'n', box: { x: 0, y: 0, w: 3, h: 2 } },
      { id: 'b', type: 'kpi', data: { query: 'slow' }, value: 'n', box: { x: 3, y: 0, w: 3, h: 2 } },
    ], { queries: [fast, slow] });
    const intervals: Array<() => void> = [];
    vi.spyOn(window, 'setInterval').mockImplementation(((fn: () => void) => { intervals.push(fn); return intervals.length as never; }) as never);
    // The host answers `slow` only when told; `fast` at once.
    let releaseSlow: () => void = () => {};
    const replies: Array<{ q: string; send: () => void }> = [];
    vi.resetModules();
    const style = document.createElement('style');
    style.id = 'wk-apps-sheet';
    style.textContent = /<style id="wk-apps-sheet">([\s\S]*?)<\/style>/u.exec(TEMPLATE)![1]!;
    document.head.append(style);
    const { startRuntime } = await import('../src/plugins/wicked-apps/runtime/runtime.js');
    startRuntime({ editor: 'wicked-apps', surfaces: {} });
    const ch = new MessageChannel();
    let fastN = 0;
    ch.port1.onmessage = (m) => {
      const d = m.data as { type: string; id?: string; payload: Record<string, unknown> };
      if (d.id === undefined) return;
      const reply = (payload: unknown): void => ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload });
      if (d.type === 'artifact.read') { reply({ version: 1, content: { type: 'app', spec } }); return; }
      if (d.payload['query'] === 'fast') { fastN += 1; reply(rowsFor(fast, [[fastN]])); return; }
      replies.push({ q: 'slow', send: () => reply(rowsFor(slow, [[42]])) });
      releaseSlow = () => replies.forEach((r) => r.send());
    };
    window.dispatchEvent(Object.assign(new Event('message'), {
      data: { p: 'wicked.editor', v: 1, type: 'host.hello', payload: { protocol: 2, surface: 'full', grants: ['artifact.read', 'data.read'], app: { framed: false, mode: 'preview' }, theme: {}, prefs: { locale: 'en' } } },
      source: window, ports: [ch.port2],
    }));
    await vi.waitFor(() => expect(document.querySelector('[data-component="a"] .wk-kpi-value')?.textContent).toBe('1'));
    intervals[0]!(); // refresh `fast` while `slow` is still in flight
    await vi.waitFor(() => expect(document.querySelector('[data-component="a"] .wk-kpi-value')?.textContent).toBe('2'));
    releaseSlow();
    await vi.waitFor(() => expect(document.querySelector('[data-component="b"] .wk-kpi-value')?.textContent).toBe('42'));
  });
});

describe('codex r3: Properties drafts, composition, numbers; areas across zero', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  const select = async (id: string): Promise<void> => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
    const cell = document.querySelector(`[data-component="${id}"]`) as HTMLElement;
    cell.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    cell.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    await vi.waitFor(() => expect(document.querySelector('[data-testid="apps-properties"]')).not.toBeNull());
  };
  const echo = (spec: AppSpec) => (type: string, p: Record<string, unknown>) => {
    if (type !== 'spec.edit') return {};
    const next = structuredClone(spec);
    const c = next.pages[0]!.components[0]! as unknown as Record<string, unknown>;
    for (const op of p['ops'] as Array<Record<string, unknown>>) {
      if (op['op'] === 'component-set') c[op['prop'] as string] = op['value'];
      if (op['op'] === 'component-resize') c['box'] = { ...(c['box'] as object), w: op['w'], h: op['h'] };
    }
    return { spec: next, added: [], pending: 1 };
  };

  it('#1 another version read while a field is focused shows that version’s value, never the old draft', async () => {
    const spec = base([{ id: 'note', type: 'text', title: 'Mine', text: 'Hello', box: { x: 0, y: 0, w: 6, h: 1 } }]);
    const { host, setSpec } = await boot(spec, echo(spec), { framed: false, mode: 'edit' });
    await select('note');
    const title = document.querySelector('[data-prop="title"]') as HTMLInputElement;
    title.focus();
    const elsewhere = structuredClone(spec);
    (elsewhere.pages[0]!.components[0] as { title: string }).title = 'Elsewhere';
    setSpec(elsewhere);
    host.postMessage({ p: 'wicked.editor', v: 1, type: 'artifact.changed', payload: { version: 2 } });
    await vi.waitFor(() => expect((document.querySelector('[data-prop="title"]') as HTMLInputElement).value).toBe('Elsewhere'));
  });

  it('#2 a composition commits once, at its end, into the same field node', async () => {
    const spec = base([{ id: 'note', type: 'text', title: 'T', text: 'Hello', box: { x: 0, y: 0, w: 6, h: 1 } }]);
    const { seen } = await boot(spec, echo(spec), { framed: false, mode: 'edit' });
    await select('note');
    const title = document.querySelector('[data-prop="title"]') as HTMLInputElement;
    title.focus();
    title.value = 'に';
    title.dispatchEvent(new InputEvent('input', { isComposing: true }));
    title.value = '日本';
    title.dispatchEvent(new InputEvent('input', { isComposing: true }));
    await new Promise((res) => setTimeout(res, 60));
    expect(seen.filter((m) => m.type === 'spec.edit')).toHaveLength(0);
    title.dispatchEvent(new Event('compositionend'));
    await vi.waitFor(() => expect(seen.filter((m) => m.type === 'spec.edit')).toHaveLength(1));
    expect(seen.find((m) => m.type === 'spec.edit')!.payload).toMatchObject({ ops: [{ prop: 'title', value: '日本' }] });
    await new Promise((res) => setTimeout(res, 60));
    expect(document.querySelector('[data-prop="title"]')).toBe(title);
  });

  it('#5 a number the host clamps shows the saved value once the field is left', async () => {
    const spec = base([{ id: 'note', type: 'text', text: 'Hello', box: { x: 0, y: 0, w: 6, h: 1 } }]);
    await boot(spec, (type, p) => {
      if (type !== 'spec.edit') return {};
      const next = structuredClone(spec);
      const op = (p['ops'] as Array<Record<string, number>>)[0]!;
      next.pages[0]!.components[0]!.box = { x: 0, y: 0, w: op['w']!, h: Math.min(50, op['h']!) };
      return { spec: next, added: [], pending: 1 };
    }, { framed: false, mode: 'edit' });
    await select('note');
    const h = document.querySelector('[data-prop="box-h"]') as HTMLInputElement;
    h.focus();
    h.value = '100';
    h.dispatchEvent(new Event('input'));
    await new Promise((res) => setTimeout(res, 60));
    h.blur();
    await vi.waitFor(() => expect(h.value).toBe('50'));
  });

  it('#4 an unstacked area fills between its line and zero, so it crosses zero where the line does', async () => {
    const q = { id: 'r', source: 's', kind: 'sql' as const, output: [{ name: 'c', type: 'string' as const }, { name: 'a', type: 'integer' as const }] };
    const spec = base([{ id: 'ar', type: 'chart', chart: 'area', data: { query: 'r' }, x: 'c', series: [{ column: 'a' }], box: { x: 0, y: 0, w: 6, h: 4 } }], { queries: [q] });
    await boot(spec, () => rowsFor(q, [['x', 10], ['y', -10]]));
    await vi.waitFor(() => expect(document.querySelector('[data-component="ar"] path.wk-area')).not.toBeNull());
    const ys = [...document.querySelector('[data-component="ar"] path.wk-area')!.getAttribute('d')!.matchAll(/[\d.]+,([\d.]+)/gu)].map((m) => Number(m[1]));
    // upper edge = the values (10, -10); lower edge = zero at both rows.
    expect(ys[2]).toBeCloseTo(ys[3]!, 5);
    expect(ys[0]).toBeLessThan(ys[2]!);
    expect(ys[1]).toBeGreaterThan(ys[2]!);
  });
});

describe('pi r4: a rebind is read; leaving a field before its answer keeps what was typed', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('choosing another query in Properties reads it (the old binding’s rows are dropped before the read)', async () => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
    const q1 = { id: 'one', source: 's', kind: 'sql' as const, output: [{ name: 'v', type: 'string' as const }] };
    const q2 = { id: 'two', source: 's', kind: 'sql' as const, output: [{ name: 'v', type: 'string' as const }] };
    const spec = base([{ id: 't', type: 'table', data: { query: 'one' }, box: { x: 0, y: 0, w: 12, h: 4 } }], { queries: [q1, q2] });
    await boot(spec, (type, p) => {
      if (type === 'data.query') return rowsFor(p['query'] === 'one' ? q1 : q2, [[`from ${String(p['query'])}`]]);
      if (type !== 'spec.edit') return {};
      const next = structuredClone(spec);
      (next.pages[0]!.components[0] as { data: { query: string } }).data.query = (p['ops'] as Array<{ query: string }>)[0]!.query;
      return { spec: next, added: [], pending: 1 };
    }, { framed: false, mode: 'edit' });
    await vi.waitFor(() => expect(document.querySelector('.wk-table td')?.textContent).toBe('from one'));
    const cell = document.querySelector('[data-component="t"]') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    cell.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    const data = await vi.waitFor(() => { const el = document.querySelector('[data-prop="query"]') as HTMLSelectElement | null; expect(el).not.toBeNull(); return el!; });
    data.value = 'two';
    data.dispatchEvent(new Event('change'));
    await vi.waitFor(() => expect(document.querySelector('.wk-table td')?.textContent).toBe('from two'));
  });

  it('a blur before the answer does not put the old value back', async () => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
    const spec = base([{ id: 'note', type: 'text', title: 'Old', text: 'Hello', box: { x: 0, y: 0, w: 6, h: 1 } }]);
    let answer: (v: unknown) => void = () => {};
    await boot(spec, (type, p) => {
      if (type !== 'spec.edit') return {};
      const next = structuredClone(spec);
      (next.pages[0]!.components[0] as { title: string }).title = (p['ops'] as Array<{ value: string }>)[0]!.value;
      return new Promise((res) => { answer = () => res({ spec: next, added: [], pending: 1 }); });
    }, { framed: false, mode: 'edit' });
    const cell = document.querySelector('[data-component="note"]') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    cell.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    const title = await vi.waitFor(() => { const el = document.querySelector('[data-prop="title"]') as HTMLInputElement | null; expect(el).not.toBeNull(); return el!; });
    title.focus();
    title.value = 'New';
    title.dispatchEvent(new Event('input'));
    title.blur();
    title.dispatchEvent(new Event('blur'));
    expect(title.value).toBe('New'); // not yet answered: the typed value stays
    answer(null);
    await new Promise((res) => setTimeout(res, 60));
    expect(title.value).toBe('New');
  });
});

describe('codex r4: IME Enter, a slow read across edits', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  const pick = async (id: string): Promise<void> => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
    const cell = document.querySelector(`[data-component="${id}"]`) as HTMLElement;
    cell.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    cell.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    await vi.waitFor(() => expect(document.querySelector('[data-testid="apps-properties"]')).not.toBeNull());
  };

  it('#2 Enter during a composition is the IME’s: not prevented, nothing committed until the composition ends', async () => {
    const spec = base([{ id: 'note', type: 'text', title: 'T', text: 'Hello', box: { x: 0, y: 0, w: 6, h: 1 } }]);
    const { seen } = await boot(spec, (type) => (type === 'spec.edit' ? { spec, added: [], pending: 1 } : {}), { framed: false, mode: 'edit' });
    await pick('note');
    const title = document.querySelector('[data-prop="title"]') as HTMLInputElement;
    title.focus();
    title.dispatchEvent(new Event('compositionstart'));
    title.value = 'にほん';
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    title.dispatchEvent(enter);
    expect(enter.defaultPrevented).toBe(false);
    await new Promise((res) => setTimeout(res, 60));
    expect(seen.filter((m) => m.type === 'spec.edit')).toHaveLength(0);
    title.value = '日本';
    title.dispatchEvent(new Event('compositionend'));
    await vi.waitFor(() => expect(seen.filter((m) => m.type === 'spec.edit')).toHaveLength(1));
    expect(seen.find((m) => m.type === 'spec.edit')!.payload).toMatchObject({ ops: [{ value: '日本' }] });
  });

  it('#3 a read still in flight is not asked again by the edits made while it waits', async () => {
    const kq = { id: 'k', source: 's', kind: 'sql' as const, output: [{ name: 'n', type: 'integer' as const }] };
    const spec = base([{ id: 'note', type: 'text', title: 'T', text: 'Hello', box: { x: 0, y: 0, w: 6, h: 1 } }, { id: 'kpi', type: 'kpi', data: { query: 'k' }, value: 'n', box: { x: 6, y: 0, w: 3, h: 2 } }], { queries: [kq] });
    let release: () => void = () => {};
    const { seen } = await boot(spec, (type, p) => {
      if (type === 'data.query') return new Promise((res) => { release = () => res(rowsFor(kq, [[9]])); });
      if (type !== 'spec.edit') return {};
      const next = structuredClone(spec);
      (next.pages[0]!.components[0] as { title: string }).title = (p['ops'] as Array<{ value: string }>)[0]!.value;
      return { spec: next, added: [], pending: 1 };
    }, { framed: false, mode: 'edit' });
    await vi.waitFor(() => expect(seen.filter((m) => m.type === 'data.query')).toHaveLength(1));
    await pick('note');
    const title = document.querySelector('[data-prop="title"]') as HTMLInputElement;
    title.focus();
    for (const v of ['A', 'AB', 'ABC']) { title.value = v; title.dispatchEvent(new Event('input')); await new Promise((res) => setTimeout(res, 20)); }
    await vi.waitFor(() => expect(seen.filter((m) => m.type === 'spec.edit')).toHaveLength(3));
    expect(seen.filter((m) => m.type === 'data.query')).toHaveLength(1);
    release();
    await vi.waitFor(() => expect(document.querySelector('[data-component="kpi"] .wk-kpi-value')?.textContent).toBe('9'));
  });
});

describe('codex r5: long stacked areas, stroke ends at a crossing, a cleared number', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  const q = { id: 'r', source: 's', kind: 'sql' as const, output: [{ name: 'c', type: 'string' as const }, ...Array.from({ length: 12 }, (_, k) => ({ name: `s${k}`, type: 'integer' as const }))] };
  const chart = (n: number): AppSpec => base([{ id: 'sa', type: 'chart', chart: 'area', stacked: true, data: { query: 'r' }, x: 'c', series: Array.from({ length: n }, (_, k) => ({ column: `s${k}` })), box: { x: 0, y: 0, w: 6, h: 4 } }], { queries: [q] });
  const lines = (k: number): Array<Array<[number, number]>> => [...document.querySelectorAll(`[data-component="sa"] polyline.wk-series-${k}`)]
    .map((l) => l.getAttribute('points')!.split(' ').map((p) => p.split(',').map(Number) as [number, number]));

  it('#1 500 rows × 12 series crossing zero every row renders (the domain is never spread into Math.max)', async () => {
    const rows = Array.from({ length: 500 }, (_, i) => [`r${i}`, ...Array.from({ length: 12 }, (_, k) => (i % 2 === 0 ? k + 1 : -(13 - k)))]);
    await boot(chart(12), () => rowsFor(q, rows));
    await vi.waitFor(() => expect(document.querySelectorAll('[data-component="sa"] path.wk-area').length).toBeGreaterThan(12), { timeout: 5_000 });
  });

  it('#2 a positive-to-negative stroke starts its negative run on the negative stack; #3 a rounding crossing loses no run', async () => {
    await boot(chart(2), () => rowsFor(q, [['x', 10, 20, ...Array(10).fill(0)], ['y', 10, -8, ...Array(10).fill(0)]]));
    await vi.waitFor(() => expect(lines(1)).toHaveLength(2));
    const aTopY = lines(0)[0]![0]![1]; // a is 10 throughout: its stroke is the positive stack base under b
    const [up, down] = lines(1) as [Array<[number, number]>, Array<[number, number]>];
    // The positive run ends at the crossing on b's positive stack base (a's top, 10); the negative run starts there on
    // the NEGATIVE stack base (zero), below a's band, and ends at -8.
    expect(up.at(-1)![1]).toBeCloseTo(aTopY, 0);
    expect(down[0]![1]).toBeGreaterThan(up.at(-1)![1]);
    expect(down[0]![0]).toBeCloseTo(up.at(-1)![0], 1); // same x: the crossing
    expect(down.at(-1)![1]).toBeGreaterThan(down[0]![1]);
  });

  it('#3 three rows, b = -8, -8, 20 (its crossing rounds): the positive run from the crossing to 20 is drawn', async () => {
    await boot(chart(2), () => rowsFor(q, [['x', 10, -8, ...Array(10).fill(0)], ['y', 10, -8, ...Array(10).fill(0)], ['z', 10, 20, ...Array(10).fill(0)]]));
    await vi.waitFor(() => expect(lines(1)).toHaveLength(2));
    expect(lines(1).map((l) => l.length)).toStrictEqual([3, 2]);
    // the 7 / -36 pair from pi r5 too
    document.body.innerHTML = '';
    await boot(chart(2), () => rowsFor(q, [['x', 5, 7, ...Array(10).fill(0)], ['y', 5, -36, ...Array(10).fill(0)]]));
    await vi.waitFor(() => expect(lines(1).map((l) => l.length)).toStrictEqual([2, 2]));
  });

  it('#4 clearing a number while its edit is in flight still shows the saved value after the answer', async () => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
    const spec = base([{ id: 'note', type: 'text', text: 'Hello', box: { x: 0, y: 0, w: 6, h: 2 } }]);
    let answer: () => void = () => {};
    await boot(spec, (type, p) => {
      if (type !== 'spec.edit') return {};
      const next = structuredClone(spec);
      const op = (p['ops'] as Array<Record<string, number>>)[0]!;
      next.pages[0]!.components[0]!.box = { x: 0, y: 0, w: op['w']!, h: Math.min(50, op['h']!) };
      return new Promise((res) => { answer = () => res({ spec: next, added: [], pending: 1 }); });
    }, { framed: false, mode: 'edit' });
    const cell = document.querySelector('[data-component="note"]') as HTMLElement;
    cell.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    cell.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    const h = await vi.waitFor(() => { const el = document.querySelector('[data-prop="box-h"]') as HTMLInputElement | null; expect(el).not.toBeNull(); return el!; });
    h.focus();
    h.value = '100';
    h.dispatchEvent(new Event('input'));
    await new Promise((res) => setTimeout(res, 20));
    h.value = '';
    h.dispatchEvent(new Event('input'));
    await Promise.resolve();
    h.blur();
    answer();
    await vi.waitFor(() => expect(h.value).toBe('50'));
  });
});

describe('codex r6: a sign change through an exact zero row, or a plateau of them', () => {
  beforeEach(() => { document.body.innerHTML = ''; });
  const q = { id: 'r', source: 's', kind: 'sql' as const, output: [{ name: 'c', type: 'string' as const }, { name: 'a', type: 'integer' as const }, { name: 'b', type: 'integer' as const }] };
  const spec = base([{ id: 'sa', type: 'chart', chart: 'area', stacked: true, data: { query: 'r' }, x: 'c', series: [{ column: 'a' }, { column: 'b' }], box: { x: 0, y: 0, w: 6, h: 4 } }], { queries: [q] });
  const runsOf = (k: number): Array<Array<[number, number]>> => [...document.querySelectorAll(`[data-component="sa"] polyline.wk-series-${k}`)]
    .map((l) => l.getAttribute('points')!.split(' ').map((p) => p.split(',').map(Number) as [number, number]));

  for (const [name, b] of [['-8, 0, 20', [-8, 0, 20]], ['20, 0, -8', [20, 0, -8]], ['-8, 0, 0, 20', [-8, 0, 0, 20]]] as const) {
    it(`b = ${name}: two runs, the old one ending at zero on its own stack, the new one starting at the last zero on the other`, async () => {
      await boot(spec, () => rowsFor(q, b.map((v, i) => [`r${i}`, 10, v])));
      await vi.waitFor(() => expect(runsOf(1)).toHaveLength(2));
      const aTop = runsOf(0)[0]![0]![1]; // a is 10 throughout: the positive stack base under b
      const [first, second] = runsOf(1) as [Array<[number, number]>, Array<[number, number]>];
      const zeroRow = b.lastIndexOf(0);
      const startsNeg = b[0]! < 0;
      // The new run starts at the last zero row, on the other stack's edge.
      expect(second[0]![0]).toBeCloseTo(first.at(-1)![0], 0);
      if (startsNeg) { expect(second[0]![1]).toBeCloseTo(aTop, 0); expect(first.at(-1)![1]).toBeGreaterThan(aTop); }
      else { expect(first.at(-1)![1]).toBeCloseTo(aTop, 0); expect(second[0]![1]).toBeGreaterThan(aTop); }
      expect(first).toHaveLength(zeroRow + 1);
    });
  }
});

describe('codex r7: the stacked stroke over every small case (a property test, not one case at a time)', () => {
  it('for every 3- and 4-row b in {-8, 0, 10} over a = 10: every row is on a stroke, each run keeps one sign, one run per sign segment', async () => {
    const { drawChart } = await import('../src/plugins/wicked-apps/runtime/chart.js');
    const vals = [-8, 0, 10];
    const combos: number[][] = [];
    for (const n of [3, 4]) for (let m = 0; m < vals.length ** n; m += 1) combos.push(Array.from({ length: n }, (_, i) => vals[Math.floor(m / vals.length ** i) % vals.length]!));
    const cols = [{ name: 'c', type: 'string' as const }, { name: 'a', type: 'integer' as const }, { name: 'b', type: 'integer' as const }];
    const chart = { id: 'sa', type: 'chart' as const, chart: 'area' as const, stacked: true, data: { query: 'r' }, x: 'c', series: [{ column: 'a' }, { column: 'b' }], box: { x: 0, y: 0, w: 6, h: 4 } };
    for (const b of combos) {
      const root = document.createElement('div');
      drawChart(root, chart, { columns: cols, rows: b.map((v, i) => [`r${i}`, 10, v]) }, 'en');
      const runs = [...root.querySelectorAll('polyline.wk-series-1')].map((l) => l.getAttribute('points')!.split(' ').map((p) => p.split(',').map(Number) as [number, number]));
      const rowX = [...root.querySelectorAll('polyline.wk-series-0')][0]!.getAttribute('points')!.split(' ').map((p) => Number(p.split(',')[0]));
      const aTop = Number([...root.querySelectorAll('polyline.wk-series-0')][0]!.getAttribute('points')!.split(' ')[0]!.split(',')[1]);
      const label = `b = ${b.join(',')}`;
      // every row's x is on some run of b
      for (const x of rowX) expect(runs.some((r) => r.some(([px]) => Math.abs(px - x) < 0.2)), `${label}: row at x=${x}`).toBe(true);
      // one run per maximal run of same-signed values (zeros join their neighbours); an all-zero b is one run
      const signs = b.filter((v) => v !== 0).map(Math.sign);
      const segments = signs.length === 0 ? 1 : signs.filter((sg, i) => i === 0 || sg !== signs[i - 1]).length;
      expect(runs.length, label).toBe(segments);
      // within a run, every point is on one side of a's top edge (the positive stack base under b): never across a's band
      for (const r of runs) {
        const above = r.filter(([, y]) => y < aTop - 0.2).length;
        const below = r.filter(([, y]) => y > aTop + 0.2).length;
        expect(above === 0 || below === 0, `${label}: a run crosses a's band`).toBe(true);
      }
    }
  });
});
