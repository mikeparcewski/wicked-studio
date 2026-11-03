import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '../src/api/types.js';
import { EditorHost, linkOf, paramsRefusal, type HostUi } from '../src/editors/host.js';
import { AppAdapter, type AppHostPort, type AppMode } from '../src/editors/apps/appAdapter.js';
import { parseCard, sampleAppData, type AppDataPort, type PreparedAction } from '../src/editors/apps/appData.js';
import { applyOps, componentWords, inventoryOf } from '../src/editors/apps/appOps.js';
import { AppSession } from '../src/editors/apps/appSession.js';
import { SampleAppStore, type AppStorePort } from '../src/editors/apps/appStore.js';
import { SAMPLE_APPS } from '../src/editors/apps/samples.js';
import { builtinDefaults, grantedOf } from '../src/editors/model.js';
import { parseInbound, type PermissionId } from '../src/editors/protocol.js';
import surfaces from '../src/plugins/wicked-apps/surfaces.json';

/**
 * DES-APPS-001 K4: the app host. The spec ops against the host's inventory; one version per edit burst; crew's CAS
 * (`stale_base`) and the one undo pointer across tabs; and the host's refusals, all made before any data call: an
 * unknown query (S7), a framed host, Edit, no click, a viewer-bound parameter — and the card: nothing runs until the
 * person's Run on the host's card.
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

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

describe('spec ops: checked against the host’s inventory of the version', () => {
  it('moves, resizes and sets only what the inventory holds, clamping x + w to 12', () => {
    const spec = SPEC();
    const r = applyOps(spec, [{ op: 'component-move', id: 'by_region', x: 10, y: 9 }, { op: 'component-resize', id: 'kpi_open', w: 12, h: 3 }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const find = (s: AppSpec, id: string) => s.pages.flatMap((p) => p.components).find((c) => c.id === id)!;
    expect(find(r.spec, 'by_region').box).toStrictEqual({ x: 6, y: 9, w: 6, h: 5 });
    expect(find(r.spec, 'kpi_open').box).toStrictEqual({ x: 0, y: 1, w: 12, h: 3 });
    expect(find(spec, 'by_region').box.y).toBe(3); // never mutated
    expect(applyOps(spec, [{ op: 'component-move', id: 'ghost', x: 0, y: 0 }])).toMatchObject({ ok: false, code: 'refused' });
    expect(applyOps(spec, [{ op: 'component-set', id: 'weekly', prop: 'onclick', value: 'x' }])).toMatchObject({ ok: false, code: 'refused' });
    expect(applyOps(spec, [{ op: 'component-set', id: 'weekly', prop: 'chart', value: 'pie' }])).toMatchObject({ ok: true });
    expect(applyOps(spec, [{ op: 'component-set', id: 'weekly', prop: 'chart', value: 'radar' }])).toMatchObject({ ok: false });
    // A shape the protocol would drop is refused here too (defence in depth).
    expect(applyOps(spec, [{ op: 'component-move', id: 'weekly', x: 0, y: 0, style: 'x' }])).toMatchObject({ ok: false, code: 'bad_request' });
  });

  it('the host names a new component and fills its defaults; a type with nothing to read is refused with why', () => {
    const r = applyOps(SPEC(), [{ op: 'component-add', page: 'overview', type: 'kpi', box: { x: 10, y: 20, w: 4, h: 2 } }]);
    expect(r).toMatchObject({ ok: true, added: ['kpi1'] });
    if (!r.ok) return;
    const k = r.spec.pages[0]!.components.find((c) => c.id === 'kpi1')!;
    expect(k).toMatchObject({ type: 'kpi', box: { x: 10, y: 20, w: 2, h: 2 }, data: { query: 'open_escalations' }, value: 'open' });
    const bare: AppSpec = { schema: 'wicked.apps/v1', name: 'Bare', pages: [{ id: 'p', title: 'P', components: [] }], queries: [], actions: [], linkHosts: [] };
    expect(applyOps(bare, [{ op: 'component-add', page: 'p', type: 'table', box: { x: 0, y: 0, w: 4, h: 2 } }])).toMatchObject({ ok: false, message: expect.stringMatching(/add one first/) });
    expect(applyOps(bare, [{ op: 'component-add', page: 'nope', type: 'text', box: { x: 0, y: 0, w: 4, h: 2 } }])).toMatchObject({ ok: false });
  });

  it('deleting a component takes the queries and actions only it used, in the same version (§6.2)', () => {
    const r = applyOps(SPEC(), [{ op: 'component-remove', id: 'escalations' }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.spec.queries.map((q) => q.id)).not.toContain('escalation_list');
    expect(r.spec.actions.map((a) => a.id)).not.toContain('assign_to_me');
    expect(r.spec.queries.map((q) => q.id)).toContain('regions'); // still used by the region filter
    // A removed filter's bindings go too.
    const f = applyOps(SPEC(), [{ op: 'component-remove', id: 'search' }]);
    expect(f.ok && f.spec.pages[0]!.components.find((c) => c.id === 'escalations')).toMatchObject({ data: { params: { region: 'filter.region' } } });
  });

  it('the host writes a component’s words from its spec', () => {
    expect(componentWords(SPEC(), 'by_region')).toBe('bar chart “Breaches by region”');
    expect(componentWords(SPEC(), 'ghost')).toBeNull();
  });
});

describe('the session: one version per edit burst, crew’s CAS, one pointer for every tab', () => {
  it('a drag that sent 20 moves lands ONE version after the burst', async () => {
    vi.useFakeTimers();
    const store = new SampleAppStore('esc', SPEC(), new MemStorage());
    const edit = vi.spyOn(store, 'edit');
    const s = new AppSession(store, { burstMs: 1_000 });
    await s.load();
    for (let i = 0; i < 20; i += 1) expect(s.edit(1, [{ op: 'component-move', id: 'by_region', x: 6, y: 3 + (i % 5) }])).toMatchObject({ ok: true });
    expect(edit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(edit).toHaveBeenCalledTimes(1);
    expect(s.head).toBe(2);
    expect(s.pending).toBe(0);
  });

  it('an op on a version that is not the head is head_moved; a landing refused 409 drops the burst and re-reads', async () => {
    vi.useFakeTimers();
    const mem = new MemStorage();
    const a = new AppSession(new SampleAppStore('esc', SPEC(), mem), { burstMs: 1_000 });
    const b = new AppSession(new SampleAppStore('esc', SPEC(), mem), { burstMs: 1_000 });
    await a.load();
    await b.load();
    expect(a.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }])).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(a.head).toBe(2);
    expect(a.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 1 }])).toMatchObject({ ok: false, code: 'head_moved', head: 2 });
    const failed: string[] = [];
    b.on((e) => { if (e.kind === 'failed') failed.push(e.message); });
    expect(b.edit(1, [{ op: 'component-move', id: 'by_region', x: 6, y: 9 }])).toMatchObject({ ok: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(failed[0]).toMatch(/changed in another tab/);
    expect(b.head).toBe(2);
    expect(b.pending).toBe(0);
  });

  it('two tabs: an undo from a stale base is refused, both end on the same version and pointer', async () => {
    const mem = new MemStorage();
    const a = new AppSession(new SampleAppStore('esc', SPEC(), mem), { burstMs: 5 });
    const b = new AppSession(new SampleAppStore('esc', SPEC(), mem), { burstMs: 5 });
    await a.load();
    a.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }]);
    await a.flush();
    await b.load();
    expect(b.head).toBe(2);
    expect(await a.move('undo', 2)).toMatchObject({ ok: true, version: 3 });
    expect(await b.move('undo', 2)).toMatchObject({ ok: false });
    expect(b.head).toBe(3); // re-read on the refusal
    expect(await b.move('redo', 3)).toMatchObject({ ok: true, version: 4 });
    await a.refresh();
    expect(a.head).toBe(4);
    expect(a.detail!.history).toStrictEqual(b.detail!.history);
    expect(a.detail!.history).toMatchObject({ pointer: 1, canUndo: true, canRedo: false });
  });
});

// ── the host ──────────────────────────────────────────────────────────────────────────────

interface Rig {
  host: EditorHost;
  port: MessagePort;
  replies: Array<{ re?: string; ok?: boolean; payload?: Record<string, unknown>; error?: { code: string; message: string }; type?: string }>;
  data: { query: ReturnType<typeof vi.fn>; prepare: ReturnType<typeof vi.fn>; run: ReturnType<typeof vi.fn> };
  confirm: ReturnType<typeof vi.fn>;
  openLink: ReturnType<typeof vi.fn>;
  state: { framed: boolean; mode: AppMode; click: boolean };
  session: AppSession;
  ask: (type: string, payload: unknown) => Promise<Rig['replies'][number]>;
}

async function rig(opts: { editor?: string; firstParty?: boolean; grants?: PermissionId[]; confirm?: (p: PreparedAction) => Promise<boolean>; burstMs?: number } = {}): Promise<Rig> {
  const store: AppStorePort = new SampleAppStore('esc', SPEC(), new MemStorage());
  const session = new AppSession(store, { burstMs: opts.burstMs ?? 5 });
  await session.load();
  const real = sampleAppData(() => session.landedSpec!, SAMPLE_APPS['escalations']!.data);
  const data = { query: vi.fn(real.query), prepare: vi.fn(real.prepare), run: vi.fn(real.run) };
  const port: AppDataPort = { kind: 'sample', ...data, viewer: real.viewer } as unknown as AppDataPort;
  const state = { framed: false, mode: 'preview' as AppMode, click: true };
  const confirm = vi.fn(opts.confirm ?? (async () => true));
  const openLink = vi.fn(async () => true);
  const app: AppHostPort = { session, data: port, framed: () => state.framed, mode: () => state.mode, viewer: () => 'priya@example.com', confirm, openLink };
  const ui: HostUi = { chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(), thread: vi.fn(), fullscreen: vi.fn(async () => false), torn: vi.fn(), log: () => {} };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const editor = opts.editor ?? 'wicked-apps';
  const host = new EditorHost({
    container, src: 'about:blank', editor, version: '0.13.0', name: 'App', title: 'App', size: 'full', surface: 'full',
    grants: opts.grants ?? ['artifact.read', 'artifact.write', 'selection.chip'], theme: {}, prefs: { reducedMotion: false, techDetails: false, locale: 'en' },
    firstParty: opts.firstParty ?? true, adapter: new AppAdapter(session, 'Escalations'), ui, app,
    activation: () => state.click, focusInFrame: () => state.click,
  });
  host.mount();
  let p: MessagePort | null = null;
  vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { p = (tr?.[0] as MessagePort) ?? null; }) as never);
  window.dispatchEvent(new MessageEvent('message', { data: env('plugin.ready', { editor, version: '0.13.0', protocol: [1, 2], surfaces }), source: host.frame.contentWindow }));
  const replies: Rig['replies'] = [];
  p!.onmessage = (m) => replies.push(m.data as Rig['replies'][number]);
  let n = 0;
  const ask = async (type: string, payload: unknown): Promise<Rig['replies'][number]> => {
    n += 1;
    const id = `q${n}`;
    p!.postMessage(env(type, payload, id));
    await vi.waitFor(() => expect(replies.some((r) => r.re === id)).toBe(true), { timeout: 2_000 });
    return replies.find((r) => r.re === id)!;
  };
  return { host, port: p!, replies, data, confirm, openLink, state, session, ask };
}

describe('the app host: data.read / data.write are its own, for wicked-apps only', () => {
  it('never in a decided set or a default; given to the first-party wicked-apps bundle on an app host, stripped for anyone else', async () => {
    expect(builtinDefaults('wicked-apps')).not.toContain('data.read');
    expect(grantedOf([{ permission: 'data.write', decision: 'allow' }, 'data.read']).grants).toStrictEqual([]);
    const mine = await rig();
    const r = await mine.ask('data.query', { query: 'open_escalations' });
    expect(r.ok).toBe(true);
    mine.host.teardown('done');
    const other = await rig({ editor: 'acme-apps', firstParty: false, grants: ['artifact.read', 'data.read', 'data.write'] });
    expect(await other.ask('data.query', { query: 'open_escalations' })).toMatchObject({ ok: false, error: { code: 'not_granted' } });
    expect(other.data.query).not.toHaveBeenCalled();
    other.host.teardown('done');
  });

  it('S7: a query this app does not hold is refused by the host, with no data call; no field can name another app', async () => {
    const r = await rig();
    expect(await r.ask('data.query', { query: 'b_secret' })).toMatchObject({ ok: false, error: { code: 'refused' } });
    expect(await r.ask('data.query', { query: 'open_escalations', app: 'other-app' })).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    expect(await r.ask('data.query', { query: 'escalation_list', params: { region: 'EMEA', salary: 1 } })).toMatchObject({ ok: false, error: { code: 'bad_request' } });
    expect(r.data.query).not.toHaveBeenCalled();
    r.host.teardown('done');
  });

  it('a framed host refuses data.action itself, whatever the runtime believes: nothing is prepared', async () => {
    const r = await rig();
    r.state.framed = true;
    expect(await r.ask('data.action', { action: 'assign_to_me', params: { id: 4821 } })).toMatchObject({ ok: false, error: { code: 'refused', message: expect.stringMatching(/Open to make changes/) } });
    expect(r.data.prepare).not.toHaveBeenCalled();
    expect(r.confirm).not.toHaveBeenCalled();
    r.host.teardown('done');
  });

  it('Edit never writes; an action needs the person’s click in the frame; a viewer-bound value is never the app’s', async () => {
    const r = await rig();
    r.state.mode = 'edit';
    expect(await r.ask('data.action', { action: 'assign_to_me', params: { id: 4821 } })).toMatchObject({ ok: false, error: { code: 'refused' } });
    r.state.mode = 'preview';
    r.state.click = false;
    expect(await r.ask('data.action', { action: 'assign_to_me', params: { id: 4821 } })).toMatchObject({ ok: false, error: { code: 'refused' } });
    r.state.click = true;
    expect(paramsRefusal({ type: 'object', properties: { who: { type: 'string', from: 'viewer.email' } } }, { who: 'x@y' })).toMatch(/sign-in/);
    expect(await r.ask('data.action', { action: 'ghost_action' })).toMatchObject({ ok: false, error: { code: 'refused' } });
    expect(r.data.prepare).not.toHaveBeenCalled();
    r.host.teardown('done');
  });

  it('the card gate: prepare, then the host’s card, and run ONLY after the person’s Run there; Cancel runs nothing', async () => {
    let answer: (yes: boolean) => void = () => {};
    const r = await rig({ confirm: () => new Promise<boolean>((res) => { answer = res; }) });
    const id = 'act1';
    r.port.postMessage(env('data.action', { action: 'assign_to_me', params: { id: 4821 } }, id));
    await vi.waitFor(() => expect(r.confirm).toHaveBeenCalledTimes(1));
    expect(r.data.prepare).toHaveBeenCalledTimes(1);
    expect(r.data.run).not.toHaveBeenCalled();
    const card = (r.confirm.mock.calls[0]![0] as PreparedAction).card;
    expect(card).toMatchObject({ operation: 'UPDATE support.tickets', rows: [{ label: 'owner', value: 'priya@example.com', from: 'your sign-in' }], key: expect.stringMatching(/id = 4821/) });
    // A second request while the card waits is refused: one question at a time.
    expect(await r.ask('data.action', { action: 'assign_to_me', params: { id: 4822 } })).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    answer(true);
    await vi.waitFor(() => expect(r.replies.find((x) => x.re === id)).toMatchObject({ ok: true, payload: { state: 'succeeded' } }));
    expect(r.data.run).toHaveBeenCalledTimes(1);
    expect(r.replies.some((x) => x.type === 'data.invalidate')).toBe(true);
    // Cancel.
    r.port.postMessage(env('data.action', { action: 'assign_to_me', params: { id: 4822 } }, 'act2'));
    await vi.waitFor(() => expect(r.confirm).toHaveBeenCalledTimes(2));
    answer(false);
    await vi.waitFor(() => expect(r.replies.find((x) => x.re === 'act2')).toMatchObject({ ok: true, payload: { state: 'cancelled' } }));
    expect(r.data.run).toHaveBeenCalledTimes(1);
    r.host.teardown('done');
  });

  it('spec.edit: Edit only, on the head; a burst of ops is one version; artifact.changed follows', async () => {
    const r = await rig({ burstMs: 400 });
    expect(await r.ask('spec.edit', { base: 1, ops: [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }] })).toMatchObject({ ok: false, error: { code: 'refused' } });
    r.state.mode = 'edit';
    for (let i = 0; i < 5; i += 1) expect(await r.ask('spec.edit', { base: 1, ops: [{ op: 'component-move', id: 'weekly', x: 0, y: 9 + i }] })).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(r.replies.some((x) => x.type === 'artifact.changed')).toBe(true), { timeout: 3_000 });
    expect(r.session.head).toBe(2);
    expect(r.session.detail!.versions).toHaveLength(2);
    expect(await r.ask('spec.edit', { base: 1, ops: [{ op: 'component-move', id: 'weekly', x: 0, y: 1 }] })).toMatchObject({ ok: false, error: { code: 'head_moved' } });
    r.host.teardown('done');
  });

  it('link.open: https to a listed host only, after a click; the host asks first', async () => {
    const spec = SPEC();
    expect(linkOf('javascript:alert(1)', spec)).toMatch(/^!only https/);
    expect(linkOf('https://evil.example.net/x', spec)).toMatch(/^!evil.example.net is not/);
    expect(linkOf('https://user:pw@status.example.com/', spec)).toMatch(/^!a link with a sign-in/);
    expect(linkOf('https://status.example.com:8443/', spec)).toMatch(/^!a link with a sign-in or a port/);
    expect(linkOf('https://STATUS.example.com/support', spec)).toBe('https://status.example.com/support');
    const r = await rig();
    expect(await r.ask('link.open', { href: 'javascript:alert(1)' })).toMatchObject({ ok: false, error: { code: 'refused' } });
    expect(await r.ask('link.open', { href: 'https://status.example.com/support' })).toMatchObject({ ok: true, payload: { opened: true } });
    expect(r.openLink).toHaveBeenCalledWith('https://status.example.com/support');
    r.host.teardown('done');
  });
});

describe('the protocol and the live card', () => {
  it('app requests are protocol 2 and exact-keyed', () => {
    expect(parseInbound(env('data.query', { query: 'q' }, 'a'), 1)).toMatchObject({ ok: false });
    expect(parseInbound(env('data.query', { query: 'q' }, 'a'), 2)).toMatchObject({ ok: true });
    expect(parseInbound(env('data.query', { query: 'Q;drop' }, 'a'), 2)).toMatchObject({ ok: false });
    expect(parseInbound(env('data.action', { action: 'a', params: { __proto__x: 1 }, version: 3 }, 'a'), 2)).toMatchObject({ ok: false });
    expect(parseInbound(env('spec.edit', { base: 1, ops: [{ op: 'component-add', page: 'p', type: 'script', box: { x: 0, y: 0, w: 1, h: 1 } }] }, 'a'), 2)).toMatchObject({ ok: false });
  });

  it('crew’s card is read field by field; without its source, operation or request it is refused', () => {
    expect(parseCard({ source: 's', operation: 'UPDATE t', request: 'UPDATE …', rows: [{ label: 'owner', value: { html: '<b>' } }, { label: 'id', value: '4821', from: 'from the app' }] }, 'a'))
      .toMatchObject({ rows: [{ label: 'id', value: '4821', from: 'from the app' }], sample: false });
    expect(parseCard({ source: 's', operation: 'UPDATE t' }, 'a')).toBeNull();
  });

  it('the inventory lists every component once with its page', () => {
    const inv = inventoryOf(SPEC());
    expect(inv.components.get('by_region')).toMatchObject({ page: 'overview', type: 'chart' });
    expect(inv.queries.has('escalation_list')).toBe(true);
  });
});
