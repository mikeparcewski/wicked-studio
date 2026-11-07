import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDetail, AppSpec } from '../src/api/types.js';
import { AppsPage } from '../src/components/apps/AppsPage.js';
import { AppHostView } from '../src/components/editorHost/AppHostView.js';
import { AppSession, drainForSend } from '../src/editors/apps/appSession.js';
import { SampleAppStore, archivedOf, versionViewOf, type AppStorePort, type StoreResult } from '../src/editors/apps/appStore.js';
import { ARCHIVED_NOTE, loadAppTiles, loadAppsDirectory } from '../src/editors/apps/appsDirectory.js';
import { SAMPLE_APPS } from '../src/editors/apps/samples.js';
import { useProjectsStore } from '../src/store/projects.js';

/**
 * plugins G16 (operator ruling D5): apps get Archive with Restore (never a delete), restore of any earlier version, and
 * on a phone view + chat only. Restore goes through the session's one-change-at-a-time path, so it can never race an
 * edit landing, an undo, or a chat turn.
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
const SPEC = (): AppSpec => structuredClone(SAMPLE_APPS['escalations']!.spec);

beforeEach(() => { vi.stubGlobal('IntersectionObserver', class { observe(): void {} disconnect(): void {} }); });
afterEach(() => { useProjectsStore.setState({ projects: [], loading: false, error: null }); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); document.body.innerHTML = ''; localStorage.clear(); });

// ── the session and the stores ──────────────────────────────────────────────────────────────

describe('restore an earlier version: through the session’s one-change-at-a-time path', () => {
  async function threeVersions(): Promise<{ store: SampleAppStore; s: AppSession }> {
    const store = new SampleAppStore('esc', SPEC(), new MemStorage());
    const s = new AppSession(store, { burstMs: 5 });
    await s.load();
    s.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }]);
    await s.flush();
    s.edit(2, [{ op: 'component-move', id: 'weekly', x: 0, y: 10 }]);
    await s.flush();
    expect(s.head).toBe(3);
    return { store, s };
  }

  it('restores v1 as a new head (v4) holding v1’s spec, with a restored receipt; the history keeps v2 and v3', async () => {
    const { s } = await threeVersions();
    expect(await s.restore(1, 3)).toMatchObject({ ok: true, version: 4 });
    expect(s.detail!.spec).toStrictEqual(SPEC());
    expect(s.detail!.versions.map((v) => v.version)).toStrictEqual([1, 2, 3, 4]);
    expect(s.detail!.versions[3]!.receipt).toMatchObject({ kind: 'restored', restoredFrom: { version: 1 } });
    expect(s.detail!.history).toMatchObject({ states: [1, 2, 3, 4], pointer: 3, canUndo: true, canRedo: false });
    // Undo after a restore goes back to the version it replaced.
    expect(await s.move('undo', 4)).toMatchObject({ ok: true });
  });

  it('a pending edit lands FIRST, then the restore is made on the head it made (never lost, never stale)', async () => {
    const { store, s } = await threeVersions();
    const restore = vi.spyOn(store, 'restore');
    expect(s.edit(3, [{ op: 'component-move', id: 'by_region', x: 6, y: 9 }])).toMatchObject({ ok: true });
    expect(s.pending).toBeGreaterThan(0);
    expect(await s.restore(1, 3)).toMatchObject({ ok: true, version: 5 });
    expect(restore).toHaveBeenCalledWith(4, 1);
    expect(s.detail!.versions[3]!.summary).not.toMatch(/Restored/);
  });

  it('refused while an undo is landing, and an undo is refused while a restore lands: one change at a time', async () => {
    const { store, s } = await threeVersions();
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const real = store.restore.bind(store);
    vi.spyOn(store, 'restore').mockImplementationOnce(async (b, v) => { await gate; return real(b, v); });
    const first = s.restore(1, 3);
    await Promise.resolve();
    expect(await s.move('undo', 3)).toMatchObject({ ok: false, message: expect.stringMatching(/already landing/) });
    expect(await s.restore(2, 3)).toMatchObject({ ok: false, message: expect.stringMatching(/already landing/) });
    expect(s.edit(3, [{ op: 'component-move', id: 'weekly', x: 0, y: 1 }])).toMatchObject({ ok: false, message: expect.stringMatching(/landing/) });
    release();
    expect(await first).toMatchObject({ ok: true, version: 4 });
  });

  it('the other way round: a restore is refused while an undo lands, and nothing is sent for it', async () => {
    const { store, s } = await threeVersions();
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const realMove = store.move.bind(store);
    vi.spyOn(store, 'move').mockImplementationOnce(async (d, b) => { await gate; return realMove(d, b); });
    const restore = vi.spyOn(store, 'restore');
    const undo = s.move('undo', 3);
    await Promise.resolve();
    expect(await s.restore(1, 3)).toMatchObject({ ok: false, message: expect.stringMatching(/already landing/) });
    release();
    expect(await undo).toMatchObject({ ok: true });
    expect(restore).not.toHaveBeenCalled();
  });

  it('an edit landing in flight: Restore waits for it, then restores on the head it made; if it is refused nothing is restored', async () => {
    const { store, s } = await threeVersions();
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const realEdit = store.edit.bind(store);
    vi.spyOn(store, 'edit').mockImplementationOnce(async (b, sp, sum) => { await gate; return realEdit(b, sp, sum); });
    const restore = vi.spyOn(store, 'restore');
    s.edit(3, [{ op: 'component-move', id: 'by_region', x: 6, y: 9 }]);
    const landing = s.flush();
    const r = s.restore(1, 3);
    await Promise.resolve();
    expect(restore).not.toHaveBeenCalled();
    release();
    await landing;
    expect(await r).toMatchObject({ ok: true, version: 5 });
    expect(restore).toHaveBeenCalledWith(4, 1);
    // A refused landing: nothing is restored.
    vi.spyOn(store, 'edit').mockResolvedValueOnce({ ok: false, code: 'stale_base', message: 'moved', head: 5 });
    s.edit(5, [{ op: 'component-move', id: 'weekly', x: 0, y: 2 }]);
    expect(await s.restore(2, 5)).toMatchObject({ ok: false, message: expect.stringMatching(/did not land/) });
    expect(restore).toHaveBeenCalledTimes(1);
  });

  it('a chat message sent while a restore lands waits for it and names the head the restore made (codex r1)', async () => {
    const { store, s } = await threeVersions();
    let release!: () => void;
    const gate = new Promise<void>((res) => { release = res; });
    const real = store.restore.bind(store);
    vi.spyOn(store, 'restore').mockImplementationOnce(async (b, v) => { await gate; return real(b, v); });
    const r = s.restore(1, 3);
    await Promise.resolve();
    let base: number | null | undefined;
    const sent = drainForSend(s).then((b) => { base = b; });
    await new Promise((res) => setTimeout(res, 5));
    expect(base).toBeUndefined();
    release();
    await r;
    await sent;
    expect(base).toBe(4);
  });

  it('a stale base is head_moved before anything is sent; a turn in flight refuses it; crew’s 409 re-reads the head', async () => {
    const { store, s } = await threeVersions();
    const restore = vi.spyOn(store, 'restore');
    expect(await s.restore(1, 2)).toMatchObject({ ok: false, code: 'head_moved', head: 3 });
    expect(restore).not.toHaveBeenCalled();
    // A turn in flight: read-only, nothing sent.
    const busy = { ...s.detail!, turn: { runId: 'apps-esc-1', startedAt: 1, base: 3, actor: 'you' } } as AppDetail;
    const turnStore: AppStorePort = { ...store, slug: 'esc', kind: 'sample', detail: async () => busy, edit: store.edit.bind(store), move: store.move.bind(store), restore: vi.fn(), readVersion: store.readVersion.bind(store) };
    const t = new AppSession(turnStore);
    await t.load();
    expect(await t.restore(1, 3)).toMatchObject({ ok: false, message: expect.stringMatching(/chat turn/) });
    expect(turnStore.restore).not.toHaveBeenCalled();
    // Another tab moved the head between this tab's read and its restore: crew refuses with stale_base, the head is re-read.
    const other = new AppSession(new SampleAppStore('esc', SPEC(), (store as unknown as { storage: Storage }).storage), { burstMs: 5 });
    await other.load();
    expect(await other.move('undo', 3)).toMatchObject({ ok: true });
    const r = await s.restore(1, 3);
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/another tab/) });
    expect(s.head).toBe(4);
  });

  it('an archived app is read-only in the session: no edit, undo or restore is sent', async () => {
    const store = new SampleAppStore('esc', SPEC(), new MemStorage());
    const archivedDetail = { ...(await store.detail()), archived: { at: 1, by: 'you' } } as AppDetail;
    const port: AppStorePort = { slug: 'esc', kind: 'sample', detail: async () => archivedDetail, edit: vi.fn(), move: vi.fn(), restore: vi.fn(), readVersion: vi.fn() };
    const s = new AppSession(port);
    await s.load();
    expect(s.readonly).toBe(true);
    expect(s.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }])).toMatchObject({ ok: false, message: expect.stringMatching(/archived/) });
    expect(await s.restore(1, 1)).toMatchObject({ ok: false, message: expect.stringMatching(/archived/) });
    expect(await s.move('undo', 1)).toMatchObject({ ok: false, message: expect.stringMatching(/archived/) });
    expect(port.edit).not.toHaveBeenCalled();
    expect(port.restore).not.toHaveBeenCalled();
  });

  it('a burst still waiting when the archive is seen is dropped, saying so, and never sent (codex r1)', async () => {
    const store = new SampleAppStore('esc', SPEC(), new MemStorage());
    const base = await store.detail();
    let answer: AppDetail = { ...base, archived: null } as AppDetail;
    const edit = vi.fn();
    const port: AppStorePort = { slug: 'esc', kind: 'sample', detail: async () => structuredClone(answer), edit, move: vi.fn(), restore: vi.fn(), readVersion: vi.fn() };
    const s = new AppSession(port, { burstMs: 1_000 });
    await s.load();
    const failed: string[] = [];
    s.on((e) => { if (e.kind === 'failed') failed.push(e.message); });
    expect(s.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }])).toMatchObject({ ok: true });
    answer = { ...base, archived: { at: 2, by: 'sam' } } as AppDetail;
    await s.refresh();
    // Dropped as soon as the archive is seen (codex r2), saying so; a flush then has nothing to send.
    expect(s.pending).toBe(0);
    expect(failed.at(-1)).toMatch(/Not saved: the app is archived/);
    expect(await s.flush()).toBe(true);
    expect(edit).not.toHaveBeenCalled();
  });

  it('archived then restored elsewhere before the burst’s timer: the burst was dropped when the archive was seen, never saved (codex r2)', async () => {
    const store = new SampleAppStore('esc', SPEC(), new MemStorage());
    const base = await store.detail();
    let answer: AppDetail = { ...base, archived: null } as AppDetail;
    const edit = vi.fn();
    const port: AppStorePort = { slug: 'esc', kind: 'sample', detail: async () => structuredClone(answer), edit, move: vi.fn(), restore: vi.fn(), readVersion: vi.fn() };
    const s = new AppSession(port, { burstMs: 1_000 });
    await s.load();
    expect(s.edit(1, [{ op: 'component-move', id: 'weekly', x: 0, y: 9 }])).toMatchObject({ ok: true });
    answer = { ...base, archived: { at: 2, by: 'sam' } } as AppDetail;
    await s.refresh();
    expect(s.pending).toBe(0);
    answer = { ...base, archived: null } as AppDetail;
    await s.refresh();
    expect(await s.flush()).toBe(true);
    expect(edit).not.toHaveBeenCalled();
  });

  it('take(): crew’s answer to an archive or unarchive becomes the session’s state, so a later re-archive is seen (codex r2)', async () => {
    const store = new SampleAppStore('esc', SPEC(), new MemStorage());
    const base = await store.detail();
    let answer: AppDetail = { ...base, archived: { at: 1, by: 'you' } } as AppDetail;
    const port: AppStorePort = { slug: 'esc', kind: 'sample', detail: async () => structuredClone(answer), edit: vi.fn(), move: vi.fn(), restore: vi.fn(), readVersion: vi.fn() };
    const s = new AppSession(port);
    await s.load();
    expect(s.archived).toBe(true);
    s.take({ ...base, archived: null } as AppDetail);
    expect(s.archived).toBe(false);
    // Another tab archives it again: the next read differs from what the session took, so it is seen.
    const heads: AppDetail[] = [];
    s.on((e) => { if (e.kind === 'head') heads.push(e.app); });
    answer = { ...base, archived: { at: 3, by: 'sam' } } as AppDetail;
    await s.refresh();
    expect(s.archived).toBe(true);
    expect(heads).toHaveLength(1);
  });

  it('archived or restored in another tab: a refresh takes the new state though the head did not move', async () => {
    const store = new SampleAppStore('esc', SPEC(), new MemStorage());
    const base = await store.detail();
    let answer: AppDetail = { ...base, archived: null } as AppDetail;
    const port: AppStorePort = { slug: 'esc', kind: 'sample', detail: async () => structuredClone(answer), edit: vi.fn(), move: vi.fn(), restore: vi.fn(), readVersion: vi.fn() };
    const s = new AppSession(port);
    await s.load();
    expect(s.archived).toBe(false);
    answer = { ...base, archived: { at: 2, by: 'sam' } } as AppDetail;
    await s.refresh();
    expect(s.archived).toBe(true);
  });

  it('the sample store reads an earlier version as it was and refuses an unknown or unaccepted one', async () => {
    const { store } = await threeVersions();
    const r = await store.readVersion(1);
    expect(r).toMatchObject({ ok: true, read: { version: 1, receipt: 'reviewed' } });
    expect(r.ok && r.read.spec).toStrictEqual(SPEC());
    expect(await store.readVersion(9)).toMatchObject({ ok: false, code: 'unknown_version' });
    expect(await store.restore(3, 9)).toMatchObject({ ok: false, code: 'unknown_version' });
    expect(await store.restore(2, 1)).toMatchObject({ ok: false, code: 'stale_base', head: 3 });
    // An unaccepted version (as a rejected turn's would be): neither read nor restored.
    const mem = (store as unknown as { storage: Storage }).storage;
    const key = 'wicked-apps-sample:esc';
    const state = JSON.parse(mem.getItem(key)!) as { detail: AppDetail };
    state.detail.versions[1]!.receipt = null;
    mem.setItem(key, JSON.stringify(state));
    expect(await store.readVersion(2)).toMatchObject({ ok: false, code: 'not_accepted' });
    expect(await store.restore(3, 2)).toMatchObject({ ok: false, code: 'not_accepted' });
  });

  it('crew’s answers are read field by field: archived, and the version read', () => {
    expect(archivedOf({})).toBeUndefined();
    expect(archivedOf({ archived: null })).toBeNull();
    expect(archivedOf({ archived: { at: 5, by: 'sam' } })).toStrictEqual({ at: 5, by: 'sam' });
    expect(archivedOf({ archived: 'yes' })).toBeUndefined();
    const spec = SPEC();
    const rec = { version: 2, commit: 'c', tree: 't', base: 1, at: 1, author: { kind: 'human', id: 'you' }, receipt: null, summary: '', check: { level: 'spec', checked: [] } };
    expect(versionViewOf({ version: { version: rec, spec, receipt: { kind: 'you' } } }, 2)).toMatchObject({ version: 2, receipt: 'you' });
    expect(versionViewOf({ version: { version: rec, spec, receipt: { kind: 'you' } } }, 3)).toBeNull();
    expect(versionViewOf({ version: { version: rec, spec: { pages: 1 }, receipt: { kind: 'you' } } }, 2)).toBeNull();
    expect(versionViewOf({ version: { version: rec, spec, receipt: { kind: 'rejected' } } }, 2)).toBeNull();
  });
});

// ── crew: a fetch double that records method, path, query and body ──────────────────────────

interface Call { method: string; path: string; query: string; body: unknown }
function crew(routes: (c: Call) => unknown): Call[] {
  const calls: Call[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://studio.local');
    const c: Call = { method: init?.method ?? 'GET', path: url.pathname.replace(/^\/api\/v1/u, ''), query: url.search, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined };
    calls.push(c);
    const out: unknown = await routes(c);
    if (out === undefined) return new Response(JSON.stringify({ error: 'no route' }), { status: 404 });
    if (typeof out === 'object' && out !== null && '__status' in out) {
      const { __status, ...body } = out as { __status: number };
      return new Response(JSON.stringify(body), { status: __status, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify(out), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch);
  return calls;
}
const CAPS = { apps: { query: false, actions: false, turns: false, publish: false, uploads: false, sourceCheck: false } };
const EDITORS = { editors: [{ id: 'wicked-apps', version: '0.13.0', sha256: 'a'.repeat(64), kinds: ['app'], enabled: true, first_party: true, title: 'App', protocol: [1, 2], sizes: ['inline', 'pane', 'full'], permissions: [] }] };
const version = (v: number, kind: 'you' | 'restored' | null = 'you') => ({
  version: v, commit: `c${v}`, tree: `t${v}`, base: v - 1 || null, at: Date.now() - 60_000, author: { kind: 'human', id: 'you' },
  receipt: kind === null ? null : { kind, tree: `t${v}`, version: v, at: 1, actor: { id: 'you', kind: 'human', trust: 'operator' } }, summary: `change ${v}`, check: { level: 'spec', checked: [] },
});
function detail(slug: string, extra: Record<string, unknown> = {}): AppDetail {
  return {
    slug, name: slug === 'desk' ? 'Desk' : 'Ops', projectId: 'p', repoId: slug, createdAt: 1, head: { version: 3, tree: 't3', receipt: 'you' }, turn: null,
    spec: { ...SPEC(), name: slug }, lock: { schema: 'wicked.apps.lock/v1', sources: {}, queries: {}, actions: {}, uploads: {} }, queryText: {},
    versions: [version(1), version(2, null), version(3)], history: { states: [1, 3], pointer: 1, canUndo: true, canRedo: false }, archived: null, ...extra,
  } as unknown as AppDetail;
}

describe('/apps: Archive with Restore (never a delete)', () => {
  it('Archive sits in an active card’s ⋯ menu; it posts archive, the list is read again, and Undo restores it', async () => {
    let archived = false;
    const calls = crew((c) => {
      if (c.path === '/health') return { status: 'ok', capabilities: CAPS };
      if (c.path === '/editors') return EDITORS;
      if (c.path === '/editors/wicked-apps/grants') return { grants: [] };
      if (c.path === '/apps') return { apps: [{ slug: 'desk', name: 'Desk', archived: archived ? { at: 1, by: 'you' } : null }, { slug: 'ops', name: 'Ops', archived: null }] };
      if (c.path === '/apps/desk/archive' && c.method === 'POST') { archived = true; return { app: detail('desk', { archived: { at: 1, by: 'you' } }) }; }
      if (c.path === '/apps/desk/unarchive' && c.method === 'POST') { archived = false; return { app: detail('desk') }; }
      if (c.path === '/apps/desk') return { app: detail('desk', archived ? { archived: { at: 1, by: 'you' } } : {}) };
      if (c.path === '/apps/ops') return { app: detail('ops') };
      if (c.path === '/report/shown' || c.path.startsWith('/settings')) return {};
      return undefined;
    });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(2));
    expect(screen.getByTestId('apps-scope')).toBeTruthy();
    const desk = screen.getAllByTestId('apps-card').find((c) => c.getAttribute('data-slug') === 'desk')!;
    fireEvent.click(within(desk).getByTestId('apps-card-menu'));
    fireEvent.click(within(desk).getByTestId('apps-card-archive'));
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(1));
    expect(calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body])).toStrictEqual([['/apps/desk/archive', {}]]);
    expect(screen.getByTestId('apps-archive-line').textContent).toMatch(/Archived “Desk”.*nothing was deleted/);
    fireEvent.click(screen.getByTestId('apps-archive-undo'));
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toStrictEqual(['/apps/desk/archive', '/apps/desk/unarchive']);
  });

  it('Archived lists the archived apps (crew’s ?archived=archived) with Restore and no Edit, Share or menu', async () => {
    const calls = crew((c) => {
      if (c.path === '/health') return { status: 'ok', capabilities: CAPS };
      if (c.path === '/editors') return EDITORS;
      if (c.path === '/editors/wicked-apps/grants') return { grants: [] };
      if (c.path === '/apps') return { apps: [{ slug: 'desk', name: 'Desk', archived: { at: 1, by: 'you' } }, { slug: 'ops', name: 'Ops', archived: null }] };
      if (c.path === '/apps/desk') return { app: detail('desk', { archived: { at: 1, by: 'you' } }) };
      if (c.path === '/apps/ops') return { app: detail('ops') };
      if (c.path === '/apps/desk/unarchive') return { app: detail('desk') };
      return undefined;
    });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('apps-scope-archived'));
    await waitFor(() => expect(screen.queryByTestId('apps-card-archived')).not.toBeNull());
    // The whole list is read and kept to the scope here (so archive support is known when every app is archived).
    expect(calls.filter((c) => c.path === '/apps').every((c) => c.query === '?archived=all')).toBe(true);
    const card = screen.getAllByTestId('apps-card')[0]!;
    expect(within(card).queryByTestId('apps-card-edit')).toBeNull();
    expect(within(card).queryByTestId('apps-card-share')).toBeNull();
    expect(within(card).queryByTestId('apps-card-menu')).toBeNull();
    fireEvent.click(within(card).getByTestId('apps-card-unarchive'));
    await waitFor(() => expect(calls.some((c) => c.method === 'POST' && c.path === '/apps/desk/unarchive')).toBe(true));
  });

  it('a daemon that does not archive (no `archived` field): no switch and no Archive; an older daemon’s apps are never listed as archived', async () => {
    crew((c) => {
      if (c.path === '/health') return { status: 'ok', capabilities: CAPS };
      if (c.path === '/editors') return EDITORS;
      if (c.path === '/editors/wicked-apps/grants') return { grants: [] };
      if (c.path === '/apps') return { apps: [{ slug: 'desk', name: 'Desk' }] };
      if (c.path === '/apps/desk') { const d = detail('desk') as unknown as Record<string, unknown>; delete d['archived']; return { app: d }; }
      return undefined;
    });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(1));
    expect(screen.queryByTestId('apps-scope')).toBeNull();
    fireEvent.click(screen.getByTestId('apps-card-menu'));
    expect(screen.queryByTestId('apps-card-archive')).toBeNull();
    // An older daemon ignores ?archived= and answers every app: none is archived, so the Archived list is empty.
    expect(await loadAppsDirectory(true, null, 'archived')).toMatchObject({ source: 'crew', apps: [] });
  });

  it('a phone is view + chat: no Edit, no Archive on cards', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    crew((c) => {
      if (c.path === '/health') return { status: 'ok', capabilities: CAPS };
      if (c.path === '/editors') return EDITORS;
      if (c.path === '/editors/wicked-apps/grants') return { grants: [] };
      if (c.path === '/apps') return { apps: [{ slug: 'desk', name: 'Desk', archived: null }] };
      if (c.path === '/apps/desk') return { app: detail('desk') };
      return undefined;
    });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(1));
    expect(screen.queryByTestId('apps-card-edit')).toBeNull();
    // No menu: Show on Report and Archive both change something (codex/pi r1).
    expect(screen.queryByTestId('apps-card-menu')).toBeNull();
  });

  it('Archive refused while a chat turn runs says so; a framed studio offers no Archive or Restore', async () => {
    crew((c) => {
      if (c.path === '/health') return { status: 'ok', capabilities: CAPS };
      if (c.path === '/editors') return EDITORS;
      if (c.path === '/editors/wicked-apps/grants') return { grants: [] };
      if (c.path === '/apps') return { apps: [{ slug: 'desk', name: 'Desk', archived: null }, { slug: 'ops', name: 'Ops', archived: { at: 1, by: 'you' } }] };
      if (c.path === '/apps/desk') return { app: detail('desk') };
      if (c.path === '/apps/ops') return { app: detail('ops', { archived: { at: 1, by: 'you' } }) };
      if (c.path === '/apps/desk/archive') return { __status: 409, code: 'turn_in_flight', error: 'a turn is changing desk' };
      return undefined;
    });
    const r = render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('apps-card-menu'));
    fireEvent.click(screen.getByTestId('apps-card-archive'));
    await waitFor(() => expect(screen.getByTestId('apps-archive-line').textContent).toMatch(/Not archived: A chat turn is changing the app/));
    r.unmount();
    Object.defineProperty(window, 'top', { configurable: true, get: () => ({}) });
    try {
      render(<AppsPage navigate={vi.fn()} />);
      await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(1));
      fireEvent.click(screen.getByTestId('apps-card-menu'));
      expect(screen.queryByTestId('apps-card-archive')).toBeNull();
      fireEvent.click(screen.getByTestId('apps-scope-archived'));
      await waitFor(() => expect(screen.getAllByTestId('apps-card-archived')).toHaveLength(1));
      expect(screen.queryByTestId('apps-card-unarchive')).toBeNull();
    } finally {
      Object.defineProperty(window, 'top', { configurable: true, get: () => window });
    }
  });

  it('every app archived: the Archived switch is still there, so they can be restored (codex/pi r1)', async () => {
    crew((c) => {
      if (c.path === '/health') return { status: 'ok', capabilities: CAPS };
      if (c.path === '/editors') return EDITORS;
      if (c.path === '/editors/wicked-apps/grants') return { grants: [] };
      if (c.path === '/apps') return { apps: [{ slug: 'desk', name: 'Desk', archived: { at: 1, by: 'you' } }] };
      if (c.path === '/apps/desk') return { app: detail('desk', { archived: { at: 1, by: 'you' } }) };
      return undefined;
    });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('apps-empty')).toBeTruthy());
    fireEvent.click(screen.getByTestId('apps-scope-archived'));
    await waitFor(() => expect(screen.getAllByTestId('apps-card-archived')).toHaveLength(1));
  });

  it('an app archived between the list and its detail read shows in the list its detail says (codex r1)', async () => {
    crew((c) => {
      if (c.path === '/apps') return { apps: [{ slug: 'desk', name: 'Desk', archived: null }, { slug: 'ops', name: 'Ops', archived: null }] };
      if (c.path === '/apps/desk') return { app: detail('desk', { archived: { at: 2, by: 'sam' } }) };
      if (c.path === '/apps/ops') return { app: detail('ops') };
      return undefined;
    });
    expect(await loadAppsDirectory(true)).toMatchObject({ source: 'crew', apps: [{ slug: 'ops' }], archives: true });
  });

  it('Undo after an archive that landed once the person switched lists still un-archives (the inverse is fixed)', async () => {
    let release!: () => void;
    const held = new Promise<void>((res) => { release = res; });
    const calls: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://studio.local');
      const path = url.pathname.replace(/^\/api\/v1/u, '');
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } });
      if ((init?.method ?? 'GET') === 'POST') calls.push(path);
      if (path === '/health') return json({ status: 'ok', capabilities: CAPS });
      if (path === '/editors') return json(EDITORS);
      if (path === '/apps') return json({ apps: [{ slug: 'desk', name: 'Desk', archived: null }] });
      if (path === '/apps/desk') return json({ app: detail('desk') });
      if (path === '/apps/desk/archive') { await held; return json({ app: detail('desk', { archived: { at: 1, by: 'you' } }) }); }
      if (path === '/apps/desk/unarchive') return json({ app: detail('desk') });
      return new Response('{}', { status: 404 });
    }) as typeof fetch);
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('apps-card-menu'));
    fireEvent.click(screen.getByTestId('apps-card-archive'));
    fireEvent.click(screen.getByTestId('apps-scope-archived'));
    release();
    await waitFor(() => expect(screen.getByTestId('apps-archive-undo')).toBeTruthy());
    fireEvent.click(screen.getByTestId('apps-archive-undo'));
    await waitFor(() => expect(calls).toStrictEqual(['/apps/desk/archive', '/apps/desk/unarchive']));
  });

  it('Report: an archived app is not "gone": its card shows, saying it is archived', async () => {
    const calls = crew((c) => {
      if (c.path === '/apps') return { apps: [{ slug: 'desk', name: 'Desk', projectId: 'p', archived: { at: 1, by: 'you' } }] };
      if (c.path === '/apps/desk') return { app: detail('desk', { archived: { at: 1, by: 'you' } }) };
      return undefined;
    });
    const r = await loadAppTiles(['desk']);
    expect(r).toMatchObject({ ok: true, tiles: [{ slug: 'desk', tile: { note: ARCHIVED_NOTE } }] });
    expect(calls.find((c) => c.path === '/apps')!.query).toBe('?archived=all');
  });
});

// ── the app host ────────────────────────────────────────────────────────────────────────────

function hostCrew(d: AppDetail, more: (c: Call) => unknown = () => undefined): Call[] {
  return crew((c) => {
    if (c.path === '/health') return { status: 'ok', capabilities: CAPS };
    if (c.path === '/editors/wicked-apps/grants') return { grants: [] };
    if (c.path === '/apps/desk' && c.method === 'GET') return { app: d };
    return more(c);
  });
}
const openHost = () => render(<AppHostView editor="wicked-apps" version="0.13.0" sha={'a'.repeat(64)} app="desk" sample={null} caps={{ apps: CAPS.apps }} />);

describe('the app host: Versions with Restore, an archived app, a phone', () => {
  it('Versions lists every version; Restore reads the version first, says what it holds, and lands only on the second click', async () => {
    const d = detail('desk');
    const calls = hostCrew(d, (c) => {
      if (c.path === '/apps/desk/versions/1') return { version: { slug: 'desk', version: version(1), commit: 'c1', tree: 't1', receipt: { kind: 'you' }, spec: { ...SPEC(), pages: [SPEC().pages[0]!] }, lock: {}, queryText: {} } };
      if (c.path === '/apps/desk/restore') return { app: { ...d, head: { version: 4, tree: 't1', receipt: 'restored' }, versions: [...d.versions, version(4, 'restored')] }, landed: version(4, 'restored') };
      return undefined;
    });
    openHost();
    await waitFor(() => expect((screen.getByTestId('apps-versions-open') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('apps-versions-open'));
    const rows = screen.getAllByTestId('apps-versions-row');
    expect(rows.map((r) => r.getAttribute('data-version'))).toStrictEqual(['3', '2', '1']);
    expect(within(rows[0]!).getByTestId('apps-version-now')).toBeTruthy();
    // The head and an unaccepted version offer no Restore.
    expect(within(rows[0]!).queryByTestId('apps-version-restore')).toBeNull();
    expect(within(rows[1]!).queryByTestId('apps-version-restore')).toBeNull();
    fireEvent.click(within(rows[2]!).getByTestId('apps-version-restore'));
    await waitFor(() => expect(screen.getByTestId('apps-version-holds').textContent).toMatch(/v1 holds 1 page/));
    expect(calls.filter((c) => c.method === 'POST')).toStrictEqual([]);
    fireEvent.click(screen.getByTestId('apps-version-restore-confirm'));
    await waitFor(() => expect(calls.filter((c) => c.method === 'POST').map((c) => [c.path, c.body])).toStrictEqual([['/apps/desk/restore', { base: 3, version: 1 }]]));
    await waitFor(() => expect(screen.getByTestId('apps-status').textContent).toMatch(/Restored v1: now v4/));
  });

  it('focus: the confirmation takes it; Escape closes it back to that Restore…, then the panel back to Versions (codex/pi r1)', async () => {
    const d = detail('desk');
    hostCrew(d, (c) => (c.path === '/apps/desk/versions/1' ? { version: { slug: 'desk', version: version(1), commit: 'c1', tree: 't1', receipt: { kind: 'you' }, spec: SPEC(), lock: {}, queryText: {} } } : undefined));
    openHost();
    await waitFor(() => expect((screen.getByTestId('apps-versions-open') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('apps-versions-open'));
    const row = screen.getAllByTestId('apps-versions-row').find((r) => r.getAttribute('data-version') === '1')!;
    expect(within(row).getByTestId('apps-version-restore').getAttribute('aria-label')).toBe('Restore v1…');
    fireEvent.click(within(row).getByTestId('apps-version-restore'));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('apps-version-confirm')));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement?.getAttribute('aria-label')).toBe('Restore v1…'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByTestId('apps-versions')).toBeNull();
    expect(document.activeElement).toBe(screen.getByTestId('apps-versions-open'));
  });

  it('while a chat turn runs, Restore is off and says why', async () => {
    hostCrew(detail('desk', { turn: { runId: 'apps-desk-1', startedAt: 1, base: 3, actor: 'you' } }));
    openHost();
    await waitFor(() => expect((screen.getByTestId('apps-versions-open') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('apps-versions-open'));
    expect(screen.getByTestId('apps-versions-why').textContent).toMatch(/chat turn/);
    expect((screen.getAllByTestId('apps-version-restore')[0] as HTMLButtonElement).disabled).toBe(true);
  });

  it('an archived app opens read-only, saying so, with Restore it (unarchive); Edit and Undo are off', async () => {
    const calls = hostCrew(detail('desk', { archived: { at: 1, by: 'you' } }), (c) => (c.path === '/apps/desk/unarchive' ? { app: detail('desk') } : undefined));
    openHost();
    await waitFor(() => expect(screen.getByTestId('apps-archived-note')).toBeTruthy());
    expect((screen.getByTestId('apps-mode-edit') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('apps-undo') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByTestId('apps-unarchive'));
    await waitFor(() => expect(screen.queryByTestId('apps-archived-note')).toBeNull());
    expect(calls.filter((c) => c.method === 'POST').map((c) => c.path)).toStrictEqual(['/apps/desk/unarchive']);
    expect((screen.getByTestId('apps-mode-edit') as HTMLButtonElement).disabled).toBe(false);
    // Another tab archives it again (crew's GET still says archived): the next read shows it (codex r2: the view and the
    // session no longer split).
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(screen.getByTestId('apps-archived-note')).toBeTruthy());
    expect((screen.getByTestId('apps-mode-edit') as HTMLButtonElement).disabled).toBe(true);
  });

  it('a daemon with no version route: the read says so, Restore stays off, and nothing is posted', async () => {
    const calls = hostCrew(detail('desk'));
    openHost();
    await waitFor(() => expect((screen.getByTestId('apps-versions-open') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('apps-versions-open'));
    const row = screen.getAllByTestId('apps-versions-row').find((r) => r.getAttribute('data-version') === '1')!;
    fireEvent.click(within(row).getByTestId('apps-version-restore'));
    await waitFor(() => expect(screen.getByTestId('apps-version-failed').textContent).toMatch(/could not be read/));
    expect((screen.getByTestId('apps-version-restore-confirm') as HTMLButtonElement).disabled).toBe(true);
    expect(calls.filter((c) => c.method !== 'GET')).toStrictEqual([]);
  });

  it('a framed studio changes nothing: no Restore it, and every Restore… is off (says why)', async () => {
    Object.defineProperty(window, 'top', { configurable: true, get: () => ({}) });
    try {
      const calls = hostCrew(detail('desk', { archived: { at: 1, by: 'you' } }));
      openHost();
      await waitFor(() => expect(screen.getByTestId('apps-archived-note')).toBeTruthy());
      expect(screen.queryByTestId('apps-unarchive')).toBeNull();
      fireEvent.click(screen.getByTestId('apps-versions-open'));
      expect(screen.getByTestId('apps-versions-why').textContent).toMatch(/inside another page/);
      for (const b of screen.getAllByTestId('apps-version-restore')) expect((b as HTMLButtonElement).disabled).toBe(true);
      expect(calls.filter((c) => c.method !== 'GET')).toStrictEqual([]);
    } finally {
      Object.defineProperty(window, 'top', { configurable: true, get: () => window });
    }
  });

  it('a restore on its way: Versions in the header cannot close the panel under it (codex r2)', async () => {
    const d = detail('desk');
    let release!: () => void;
    const held = new Promise<void>((res) => { release = res; });
    hostCrew(d, (c) => {
      if (c.path === '/apps/desk/versions/1') return { version: { slug: 'desk', version: version(1), commit: 'c1', tree: 't1', receipt: { kind: 'you' }, spec: SPEC(), lock: {}, queryText: {} } };
      if (c.path === '/apps/desk/restore') return held.then(() => ({ app: { ...d, head: { version: 4, tree: 't1', receipt: 'restored' }, versions: [...d.versions, version(4, 'restored')] }, landed: version(4, 'restored') }));
      return undefined;
    });
    openHost();
    await waitFor(() => expect((screen.getByTestId('apps-versions-open') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('apps-versions-open'));
    const row = screen.getAllByTestId('apps-versions-row').find((r) => r.getAttribute('data-version') === '1')!;
    fireEvent.click(within(row).getByTestId('apps-version-restore'));
    await waitFor(() => expect((screen.getByTestId('apps-version-restore-confirm') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByTestId('apps-version-restore-confirm'));
    await waitFor(() => expect((screen.getByTestId('apps-versions-open') as HTMLButtonElement).disabled).toBe(true));
    expect((screen.getByTestId('apps-version-restore-cancel') as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('apps-versions-close') as HTMLButtonElement).disabled).toBe(true);
    release();
    await waitFor(() => expect((screen.getByTestId('apps-versions-open') as HTMLButtonElement).disabled).toBe(false));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('apps-versions')));
  });

  it('a phone is view + chat only: no Edit switch, Undo, Redo, Versions, chat Undo or Show on Report; nothing is posted (codex r1)', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    const landed = { runId: 'apps-desk-aa', at: 1, actor: 'you', message: 'add a chart', about: [], base: 2, state: 'landed', endedAt: Date.now() - 1_000, version: 3, change: 'Added a chart', summary: 'Added a chart', builder: 'claude', reviewer: 'codex', code: null, reason: null };
    const calls = hostCrew(detail('desk', { turns: [landed] }));
    render(<AppHostView editor="wicked-apps" version="0.13.0" sha={'a'.repeat(64)} app="desk" sample={null} caps={{ apps: { ...CAPS.apps, turns: true } }} />);
    await waitFor(() => expect(screen.getByTestId('app-chat-landed')).toBeTruthy());
    expect(screen.queryByTestId('app-chat-undo')).toBeNull();
    expect(screen.queryByTestId('apps-mode-edit')).toBeNull();
    expect(screen.queryByTestId('apps-undo')).toBeNull();
    expect(screen.queryByTestId('apps-redo')).toBeNull();
    expect(screen.queryByTestId('apps-versions-open')).toBeNull();
    expect(screen.getByTestId('apps-phone-note').textContent).toMatch(/view the app and ask for changes in the chat/);
    const props = screen.queryAllByRole('tab').find((t) => /Properties/u.test(t.textContent ?? ''));
    if (props !== undefined) fireEvent.click(props);
    expect(screen.queryByTestId('show-on-report')).toBeNull();
    expect(calls.filter((c) => c.method !== 'GET')).toStrictEqual([]);
  });

  it('a phone with no chat says only that the app can be viewed', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    hostCrew(detail('desk'));
    openHost();
    await waitFor(() => expect(screen.getByTestId('apps-phone-note')).toBeTruthy());
    expect(screen.getByTestId('apps-phone-note').textContent).toBe('On a phone you can view the app. Edit, Undo and Versions are on a larger screen.');
  });
});

// A store result type check: FixedAppStore-like ports implement the new calls.
export const _typecheck: (s: AppStorePort) => Promise<StoreResult> = (s) => s.restore(1, 1);
