import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppDetail, AppSpec } from '../src/api/types.js';
import { AppsPage } from '../src/components/apps/AppsPage.js';
import { AppHostView } from '../src/components/editorHost/AppHostView.js';
import { AppSession } from '../src/editors/apps/appSession.js';
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
    const out = routes(c);
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
      if (c.path === '/apps') return { apps: [{ slug: 'desk', name: 'Desk', archived: archived ? { at: 1, by: 'you' } : null }, { slug: 'ops', name: 'Ops', archived: null }].filter((a) => (c.query.includes('archived=archived') ? a.archived !== null : a.archived === null)) };
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
      if (c.path === '/apps') return { apps: c.query.includes('archived=archived') ? [{ slug: 'desk', name: 'Desk', archived: { at: 1, by: 'you' } }] : [{ slug: 'ops', name: 'Ops', archived: null }] };
      if (c.path === '/apps/desk') return { app: detail('desk', { archived: { at: 1, by: 'you' } }) };
      if (c.path === '/apps/ops') return { app: detail('ops') };
      if (c.path === '/apps/desk/unarchive') return { app: detail('desk') };
      return undefined;
    });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(1));
    fireEvent.click(screen.getByTestId('apps-scope-archived'));
    await waitFor(() => expect(screen.queryByTestId('apps-card-archived')).not.toBeNull());
    expect(calls.some((c) => c.path === '/apps' && c.query === '?archived=archived')).toBe(true);
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
    fireEvent.click(screen.getByTestId('apps-card-menu'));
    expect(screen.queryByTestId('apps-card-archive')).toBeNull();
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
  });

  it('a phone is view + chat only: no Edit/Preview switch, no Undo, Redo or Versions, and the line says where they are', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('max-width'), media: q, addEventListener: () => undefined, removeEventListener: () => undefined }));
    hostCrew(detail('desk'));
    openHost();
    await waitFor(() => expect(screen.getByTestId('apps-version')).toBeTruthy());
    expect(screen.queryByTestId('apps-mode-edit')).toBeNull();
    expect(screen.queryByTestId('apps-undo')).toBeNull();
    expect(screen.queryByTestId('apps-redo')).toBeNull();
    expect(screen.queryByTestId('apps-versions-open')).toBeNull();
    expect(screen.getByTestId('apps-phone-note').textContent).toMatch(/view the app and ask for changes in the chat/);
  });
});

// A store result type check: FixedAppStore-like ports implement the new calls.
export const _typecheck: (s: AppStorePort) => Promise<StoreResult> = (s) => s.restore(1, 1);
