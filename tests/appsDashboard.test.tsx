import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '../src/api/types.js';
import { navCurrent, navGroups } from '../src/board/navModel.js';
import { parseRoute } from '../src/hooks/useRoute.js';
import { AppsPage, appPath } from '../src/components/apps/AppsPage.js';
import { AppRoutePage } from '../src/components/apps/AppRoutePage.js';
import { ShareSheet, studioLink } from '../src/components/apps/ShareSheet.js';
import { AppAdapter } from '../src/editors/apps/appAdapter.js';
import { AppSession } from '../src/editors/apps/appSession.js';
import { FixedAppStore, PREVIEW_LIMIT, isAppSlug, loadAppsDirectory, publishedOf, snippetOf, tileHostPort } from '../src/editors/apps/appsDirectory.js';
import { AppHostView } from '../src/components/editorHost/AppHostView.js';
import { SAMPLE_APPS } from '../src/editors/apps/samples.js';
import { EditorHost } from '../src/editors/host.js';

/**
 * DES-APPS-001 K4, the operator's look (2026-11-03): Apps under Work, `/apps` as a dashboard of the apps, `/apps/<slug>`
 * one app, Share (published or not, never a made-up link), and editing a component's words in place on the canvas.
 */

afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; document.head.innerHTML = ''; localStorage.clear(); });

describe('Apps under Work, and its routes', () => {
  it('Work reads Learn, Projects, Jobs, Apps, Repositories; Apps is current on /apps and on one app', () => {
    expect(navGroups('start').find((g) => g.id === 'work')!.items.map((i) => i.label)).toStrictEqual(['Learn', 'Projects', 'Jobs', 'Apps', 'Repositories']);
    expect(navGroups('insight').find((g) => g.id === 'work')!.items.map((i) => i.id)).toStrictEqual(['projects', 'jobs', 'apps', 'repos']);
    expect(navCurrent('/apps')).toBe('apps');
    expect(navCurrent('/apps/escalations')).toBe('apps');
    expect(navCurrent('/approvals')).not.toBe('apps');
    expect(parseRoute('/apps')).toMatchObject({ panel: 'apps', artifactId: null });
    expect(parseRoute('/apps/refund-approvals')).toMatchObject({ panel: 'apps', artifactId: 'refund-approvals' });
    expect(parseRoute('/apps/a/b').panel).toBe('not-found');
    expect(appPath('escalations')).toBe('/apps/escalations');
    expect(appPath('escalations', 'edit')).toBe('/apps/escalations?mode=edit');
  });
});

// ── the dashboard ───────────────────────────────────────────────────────────────────────────

type Routes = Record<string, unknown>;
function mockDaemon(routes: Routes): { urls: string[] } {
  const urls: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const path = new URL(url, 'http://studio.local').pathname.replace(/^\/api\/v1/u, '');
    urls.push(path);
    const hit = Object.entries(routes).find(([p]) => p === path);
    if (hit === undefined) return new Response(JSON.stringify({ error: 'no route' }), { status: 404 });
    if (hit[1] instanceof Error) throw hit[1];
    const failing = typeof hit[1] === 'object' && hit[1] !== null && '__status' in hit[1] ? (hit[1] as { __status: number }).__status : null;
    if (failing !== null) return new Response(JSON.stringify({ error: { code: 'internal', message: 'boom' } }), { status: failing, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch);
  return { urls };
}
const CAPS = { apps: { query: true, actions: true, turns: false, publish: false, uploads: false, sourceCheck: true } };
const crewDetail = (slug: string, name: string, description = '', extra: Record<string, unknown> = {}) => ({
  app: { slug, name, projectId: 'p', repoId: slug, createdAt: 1, head: { version: 3, tree: 't', receipt: 'you' }, turn: null,
    spec: { ...structuredClone(SAMPLE_APPS['escalations']!.spec), name, description },
    lock: { schema: 'wicked.apps.lock/v1', sources: {}, queries: {}, actions: {}, uploads: {} }, queryText: {},
    versions: [1, 2, 3].map((v) => ({ version: v, commit: 'c', tree: 't', base: v - 1 || null, at: Date.now() - 60_000, author: { kind: 'human', id: 'you' }, receipt: { kind: 'you', tree: 't', version: v, at: 1, actor: { id: 'you', kind: 'human', trust: 'operator' } }, summary: '', check: { level: 'spec', checked: [] } })),
    history: { states: [1, 2, 3], pointer: 2, canUndo: true, canRedo: false }, ...extra },
});
const EDITORS = { editors: [{ id: 'wicked-apps', version: '0.13.0', sha256: 'a'.repeat(64), kinds: ['app'], enabled: true, first_party: true, title: 'App', protocol: [1, 2], sizes: ['inline', 'pane', 'full'], permissions: [] }] };

describe('/apps: a dashboard of the apps', () => {
  it('without an app store: the two sample apps, labelled, with their KPI values; every card opens its app; no query sent; no style attribute', async () => {
    const { urls } = mockDaemon({ '/health': { status: 'ok', capabilities: {} }, '/editors': EDITORS, '/editors/wicked-apps/grants': { grants: [] } });
    const navigate = vi.fn();
    render(<AppsPage navigate={navigate} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(2));
    expect(screen.getByTestId('apps-samples-note').textContent).toMatch(/sample apps/);
    expect(screen.getAllByTestId('apps-card-sample')).toHaveLength(2);
    const esc = screen.getAllByTestId('apps-card').find((c) => c.getAttribute('data-slug') === 'escalations')!;
    expect([...esc.querySelectorAll('.wk-appcard-kpi dd')].map((d) => d.textContent)).toStrictEqual(['214', '37', '2h 41m']);
    expect(esc.querySelector('[data-testid="apps-card-version"]')!.textContent).toBe('v1 · reviewed');
    expect(esc.querySelector('[data-testid="apps-card-sources"]')!.textContent).toBe('Reads support-pg, support-pg-writer');
    fireEvent.click(esc.querySelector('[data-testid="apps-card-open"]')!);
    expect(navigate).toHaveBeenLastCalledWith('/apps/escalations');
    fireEvent.click(esc.querySelector('[data-testid="apps-card-edit"]')!);
    expect(navigate).toHaveBeenLastCalledWith('/apps/escalations?mode=edit');
    expect(urls.filter((u) => u.includes('/query'))).toStrictEqual([]);
    expect(document.querySelectorAll('[data-testid="apps-page"] [style]')).toHaveLength(0);
  });

  it('with crew’s store: crew’s apps (hostile names as text), no numbers, and only store reads — never a query', async () => {
    const spec = (name: string, description: string): AppSpec => ({ ...structuredClone(SAMPLE_APPS['escalations']!.spec), name, description });
    const detail = (slug: string, name: string, description: string) => ({
      app: { slug, name, projectId: 'p', repoId: slug, createdAt: 1, head: { version: 3, tree: 't', receipt: 'you' }, turn: null, spec: spec(name, description),
        lock: { schema: 'wicked.apps.lock/v1', sources: {}, queries: {}, actions: {}, uploads: {} }, queryText: {},
        versions: [1, 2, 3].map((v) => ({ version: v, commit: 'c', tree: 't', base: v - 1 || null, at: Date.now() - 60_000, author: { kind: 'human', id: 'you' }, receipt: { kind: 'you', tree: 't', version: v, at: 1, actor: { id: 'you', kind: 'human', trust: 'operator' } }, summary: '', check: { level: 'spec', checked: [] } })),
        history: { states: [1, 2, 3], pointer: 2, canUndo: true, canRedo: false } },
    });
    const hostile = '<img src=x onerror=window.__pwned=1> Desk';
    const { urls } = mockDaemon({
      '/health': { status: 'ok', capabilities: { apps: { query: true, actions: true, turns: false, publish: false, uploads: false, sourceCheck: true } } },
      '/apps': { apps: [{ slug: 'desk', name: hostile }, { slug: 'ops', name: 'Ops' }] },
      '/apps/desk': detail('desk', hostile, '<script>window.__pwned=2</script> what it does'),
      '/apps/ops': detail('ops', 'Ops', ''),
      '/editors': EDITORS, '/editors/wicked-apps/grants': { grants: [] },
    });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(2));
    expect(screen.getAllByTestId('apps-card-name')[0]!.textContent).toBe(hostile);
    expect(screen.getAllByTestId('apps-card-desc')[0]!.textContent).toBe('<script>window.__pwned=2</script> what it does');
    expect(document.querySelectorAll('[data-testid="apps-page"] img, [data-testid="apps-page"] script')).toHaveLength(0);
    expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();
    expect(screen.queryAllByTestId('apps-card-sample')).toHaveLength(0);
    expect(screen.getAllByTestId('apps-card-nonumbers')).toHaveLength(2);
    expect(screen.getAllByTestId('apps-card-version')[0]!.textContent).toBe('v3 · you');
    // Store reads only (the list, each app once); never /query.
    const apps = urls.filter((u) => u.startsWith('/apps'));
    expect(apps.sort()).toStrictEqual(['/apps', '/apps/desk', '/apps/ops']);
    expect(document.querySelectorAll('[data-testid="apps-page"] [style]')).toHaveLength(0);
  });

  it('an empty store: one dashboard-shaped placeholder with what Apps are', async () => {
    mockDaemon({ '/health': { status: 'ok', capabilities: { apps: { query: false, actions: false, turns: false, publish: false, uploads: false, sourceCheck: false } } }, '/apps': { apps: [] }, '/editors': EDITORS });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('apps-empty')).toBeTruthy());
    expect(screen.getByTestId('apps-empty').textContent).toMatch(/^Apps are dashboards and tools over your data/);
  });
});

describe('/apps: crew’s records are data (codex r9)', () => {
  it('a slug outside crew’s grammar is never requested or linked (dot segments, slashes, reserved names)', async () => {
    for (const bad of ['..', '.', 'a/b', '%2e%2e', 'A', '-a', 'a--b', 'check', 'uploads', 'a'.repeat(49), 'a-b-c-d-e', '', 7]) expect(isAppSlug(bad)).toBe(false);
    for (const ok of ['desk', 'refund-approvals', 'a1-b2-c3-d4', 'x']) expect(isAppSlug(ok)).toBe(true);
    const { urls } = mockDaemon({
      '/health': { status: 'ok', capabilities: CAPS },
      '/apps': { apps: [{ slug: '..', name: 'Up' }, { slug: 'a/b', name: 'Slash' }, { slug: 'desk', name: 'Desk' }] },
      '/apps/desk': crewDetail('desk', 'Desk'), '/editors': EDITORS, '/editors/wicked-apps/grants': { grants: [] },
    });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(1));
    expect(screen.getByTestId('apps-skipped').textContent).toMatch(/^2 apps crew lists have an address studio can’t open/);
    expect(urls.filter((u) => u.startsWith('/apps')).sort()).toStrictEqual(['/apps', '/apps/desk']);
    expect(urls).not.toContain('/');
  });

  it('a detail that fails or is malformed leaves its card, drawn from the list and saying so; the others are whole', async () => {
    mockDaemon({
      '/health': { status: 'ok', capabilities: CAPS },
      '/apps': { apps: [{ slug: 'desk', name: 'Desk', head: { version: 2, receipt: 'you' }, createdAt: 5 }, { slug: 'ops', name: 'Ops' }, { slug: 'odd', name: { not: 'text' } }, { slug: 'other', name: 'Other' }] },
      '/apps/desk': { __status: 500 },
      '/apps/ops': crewDetail('ops', 'Ops', 'fine'),
      '/apps/odd': { app: { ...crewDetail('odd', 'Odd').app, spec: { ...crewDetail('odd', 'Odd').app.spec, description: 123 } } },
      '/apps/other': crewDetail('elsewhere', 'Other'),
      '/editors': EDITORS, '/editors/wicked-apps/grants': { grants: [] },
    });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(4));
    const card = (slug: string) => screen.getAllByTestId('apps-card').find((c) => c.getAttribute('data-slug') === slug)!;
    expect(card('desk').querySelector('[data-testid="apps-card-note"]')!.textContent).toMatch(/^Its details could not be read: /);
    expect(card('desk').querySelector('[data-testid="apps-card-version"]')!.textContent).toBe('v2 · you');
    expect(card('desk').querySelector('[data-testid="apps-card-share"]')).toBeNull();
    expect(card('odd').querySelector('[data-testid="apps-card-name"]')!.textContent).toBe('odd');
    expect(card('odd').querySelector('[data-testid="apps-card-note"]')!.textContent).toBe('Its details could not be read.');
    // A detail for another slug than the one asked for is not this app's.
    expect(card('other').querySelector('[data-testid="apps-card-note"]')).not.toBeNull();
    expect(card('ops').querySelector('[data-testid="apps-card-desc"]')!.textContent).toBe('fine');
    expect(card('ops').querySelector('[data-testid="apps-card-note"]')).toBeNull();
    expect(screen.queryByTestId('apps-error')).toBeNull();
  });

  it('every listed app gets a card: the first ones a preview, the rest from the list, and the page says so', async () => {
    const list = Array.from({ length: PREVIEW_LIMIT + 6 }, (_, i) => ({ slug: `app-${i}`, name: `App ${i}`, head: { version: 1, receipt: null } }));
    const routes: Routes = { '/health': { status: 'ok', capabilities: CAPS }, '/apps': { apps: list } };
    for (const a of list.slice(0, PREVIEW_LIMIT)) routes[`/apps/${a.slug}`] = crewDetail(a.slug, a.name);
    const { urls } = mockDaemon(routes);
    const d = await loadAppsDirectory(true);
    expect(d.source === 'crew' && d.apps.length).toBe(PREVIEW_LIMIT + 6);
    expect(urls.filter((u) => u.startsWith('/apps/'))).toHaveLength(PREVIEW_LIMIT);
    expect(d.source === 'crew' && d.apps.slice(PREVIEW_LIMIT).every((t) => t.detail === null && t.version === 'v1 · not accepted')).toBe(true);
  });

  it('a daemon that does not answer is an error with Try again, never the samples', async () => {
    mockDaemon({ '/health': { __status: 503 }, '/editors': EDITORS });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('apps-error')).toBeTruthy());
    expect(screen.queryByTestId('apps-samples-note')).toBeNull();
    expect(screen.queryAllByTestId('apps-card')).toHaveLength(0);
    vi.restoreAllMocks();
    mockDaemon({ '/health': { status: 'ok', capabilities: {} }, '/editors': EDITORS, '/editors/wicked-apps/grants': { grants: [] } });
    fireEvent.click(screen.getByTestId('apps-retry'));
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(2));
  });
});

describe('crew’s records are data (codex r10)', () => {
  it('a list that is not a list is an error to retry; entries that are not apps are counted, not shown', async () => {
    for (const body of [{}, { apps: null }, { apps: { desk: 1 } }]) {
      vi.restoreAllMocks();
      mockDaemon({ '/apps': body });
      expect(await loadAppsDirectory(true)).toMatchObject({ source: 'error' });
    }
    vi.restoreAllMocks();
    mockDaemon({ '/apps': { apps: [null, 5, 'desk', { slug: 'desk', name: 'Desk' }] }, '/apps/desk': crewDetail('desk', 'Desk') });
    expect(await loadAppsDirectory(true)).toMatchObject({ source: 'crew', skipped: 3, apps: [{ slug: 'desk' }] });
  });

  it('a source that is not a string is not shown, and the card stays whole', async () => {
    const d = crewDetail('desk', 'Desk');
    (d.app.spec.queries[0] as unknown as { source: unknown }).source = { toString: 5 };
    mockDaemon({ '/health': { status: 'ok', capabilities: CAPS }, '/apps': { apps: [{ slug: 'desk', name: 'Desk' }] }, '/apps/desk': d, '/editors': EDITORS, '/editors/wicked-apps/grants': { grants: [] } });
    render(<AppsPage navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getAllByTestId('apps-card')).toHaveLength(1));
    expect(screen.getByTestId('apps-card-sources').textContent).toMatch(/^Reads support-pg/);
    expect(screen.queryByTestId('apps-card-note')).toBeNull();
  });

  it('the app view opened directly (?app=) says when the daemon did not answer, with Try again', async () => {
    mockDaemon({ '/health': { __status: 503 } });
    render(<AppHostView editor="wicked-apps" version="0.13.0" sha={'a'.repeat(64)} app="desk" sample={null} />);
    await waitFor(() => expect(screen.getByTestId('apps-error').textContent).toMatch(/did not answer/));
    vi.restoreAllMocks();
    const { urls } = mockDaemon({ '/health': { __status: 503 } });
    fireEvent.click(screen.getByTestId('apps-error-retry'));
    await waitFor(() => expect(urls).toContain('/health'));
  });
});

describe('/apps/<slug>: one store decision (codex r9)', () => {
  it('a daemon that does not answer says so with Try again; it never opens a sample for crew’s app', async () => {
    mockDaemon({ '/health': { __status: 503 }, '/editors': EDITORS });
    render(<AppRoutePage slug="escalations" search="" navigate={vi.fn()} />);
    await waitFor(() => expect(screen.getByTestId('apps-route-failed')).toBeTruthy());
    expect(screen.queryByTestId('apps-route')).toBeNull();
    expect(screen.getByTestId('apps-route-retry')).toBeTruthy();
  });

  it('an address outside crew’s grammar sends nothing', async () => {
    const { urls } = mockDaemon({ '/health': { status: 'ok', capabilities: CAPS }, '/editors': EDITORS });
    render(<AppRoutePage slug=".." search="" navigate={vi.fn()} />);
    expect(screen.getByTestId('apps-route-unknown').textContent).toMatch(/is not an app’s address/);
    await new Promise((res) => setTimeout(res, 30));
    expect(urls).toStrictEqual([]);
  });

  it('health is read once and handed to the host: the app opens from crew’s store without a second health read', async () => {
    const { urls } = mockDaemon({ '/health': { status: 'ok', capabilities: CAPS }, '/editors': EDITORS, '/editors/wicked-apps/grants': { grants: [] }, '/apps/desk': crewDetail('desk', 'Desk') });
    render(<AppRoutePage slug="desk" search="" navigate={vi.fn()} />);
    await waitFor(() => expect(urls).toContain('/apps/desk'));
    await waitFor(() => expect(screen.getByTestId('apps-route')).toBeTruthy());
    expect(urls.filter((u) => u === '/health')).toHaveLength(1);
  });
});

// ── Share ───────────────────────────────────────────────────────────────────────────────────

describe('Share: a published link only when crew reports one', () => {
  let writes: string[];
  beforeEach(() => {
    writes = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: vi.fn(async (t: string) => { writes.push(t); }) } });
  });

  it('not published: says so, Publish is disabled (coming with Publish), and Copy copies the studio link', async () => {
    render(<ShareSheet name="<b>Desk</b>" slug="desk" published={null} onClose={vi.fn()} />);
    expect(screen.getByTestId('apps-share-state').textContent).toMatch(/Not published yet/);
    expect((screen.getByTestId('apps-share-publish') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Coming with Publish')).toBeTruthy();
    expect(screen.queryByTestId('apps-share-link-field')).toBeNull();
    fireEvent.click(screen.getByTestId('apps-share-studio-copy'));
    await waitFor(() => expect(writes).toStrictEqual([`${window.location.origin}/apps/desk`]));
    expect(screen.getByRole('dialog').querySelector('h2')!.textContent).toBe('Share “<b>Desk</b>”');
    expect(document.querySelectorAll('[data-testid="apps-share"] b')).toHaveLength(0);
  });

  it('published (K6’s record): the share link and crew’s snippet, each copied exactly as shown; who can open it; when', async () => {
    const snippet = '<iframe src="https://desk.example.test/" title="Desk"\n  width="100%" height="640"></iframe>';
    const published = publishedOf({ published: { shareUrl: 'https://desk.example.test/', audience: 'people in group support-ops who sign in at dex.apps.test', snippet, version: 7, at: 1_762_160_400_000, targets: ['site', 'embed'], tree: 't', runId: 'r' } })!;
    render(<ShareSheet name={'Desk "x" <y>'} slug="desk" published={published} onClose={vi.fn()} />);
    expect(screen.getByTestId('apps-share-state').textContent).toMatch(/^Published/);
    expect(screen.getByTestId('apps-share-audience').textContent).toBe('people in group support-ops who sign in at dex.apps.test');
    expect(screen.getByTestId('apps-share-when').textContent).toMatch(/^Published v7 on /);
    expect(screen.getByTestId('apps-share-when').textContent).not.toMatch(/published ·/);
    const field = screen.getByTestId('apps-share-embed-field') as HTMLTextAreaElement;
    expect(field.tagName).toBe('TEXTAREA');
    expect(field.value).toBe(snippet);
    fireEvent.click(screen.getByTestId('apps-share-link-copy'));
    fireEvent.click(screen.getByTestId('apps-share-embed-copy'));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes).toStrictEqual(['https://desk.example.test/', snippet]);
    expect(screen.queryByTestId('apps-share-publish')).toBeNull();
  });

  it('a malformed or partial record is "not published": no link is ever made up', () => {
    const ok = { shareUrl: 'https://a.test/', audience: 'x', version: 1, at: 1_762_160_400_000, snippet: null };
    expect(publishedOf({})).toBeNull();
    expect(publishedOf({ published: null })).toBeNull();
    expect(publishedOf({ published: { ...ok, shareUrl: 'javascript:alert(1)' } })).toBeNull();
    expect(publishedOf({ published: { ...ok, shareUrl: undefined, url: 'https://a.test/' } })).toBeNull();
    for (const audience of ['', '   ', 7]) expect(publishedOf({ published: { ...ok, audience } })).toBeNull();
    for (const version of [1.5, -1, 0, 2 ** 60, '1']) expect(publishedOf({ published: { ...ok, version } })).toBeNull();
    for (const at of [1e100, -5, Number.NaN, '1']) expect(publishedOf({ published: { ...ok, at } })).toBeNull();
    expect(publishedOf({ published: ok })).toMatchObject({ shareUrl: 'https://a.test/', snippet: null });
    // A snippet that does not name the share link's own site is not shown.
    expect(publishedOf({ published: { ...ok, snippet: '<iframe src="https://evil.test/"></iframe>' } })!.snippet).toBeNull();
    expect(studioLink('a b', 'http://h')).toBe('http://h/apps/a%20b');
  });

  it('codex/pi r10: a snippet shows only when it is exactly one iframe of the published site', () => {
    const site = 'https://desk.example.test/';
    const ok = '<iframe src="https://desk.example.test/" title="Desk" width="100%" height="640" loading="lazy" allowfullscreen></iframe>';
    expect(snippetOf(ok, site)).toBe(ok);
    expect(snippetOf('<iframe\n  src="https://desk.example.test/embed"\n  title="Desk"></iframe>', site)).not.toBeNull();
    for (const bad of [
      `${ok}<img src=x onerror=alert(1)>`, `<!-- https://desk.example.test/ -->${ok}`, ok.replace('<iframe ', '<iframe onload="alert(1)" '),
      '<iframe srcdoc="&lt;script&gt;" src="https://desk.example.test/"></iframe>', '<iframe src="https://desk.example.test.evil.test/"></iframe>',
      '<iframe src="https://desk.example.test@evil.test/"></iframe>', '<iframe src="javascript:alert(1)"></iframe>', '<iframe title="no src"></iframe>',
      '<iframe src="https://desk.example.test/" src="https://evil.test/"></iframe>', ok.replace(' title', '\r\n title'), "<iframe src='https://desk.example.test/'></iframe>",
      '<iframe src="https://desk.example.test/?a=1&b=2"></iframe>', '<IFRAME src="https://desk.example.test/"></IFRAME>', `${ok} `, 7, null,
    ]) expect(snippetOf(bad, site)).toBeNull();
  });

  it('is a modal: Escape closes the top layer only, and Tab stays inside', async () => {
    const onClose = vi.fn();
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    const { unmount } = render(<ShareSheet name="Desk" slug="desk" published={null} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    const first = dialog.querySelector('button')!;
    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    unmount();
    expect(document.activeElement).toBe(before);
  });
});

// ── editing in place ────────────────────────────────────────────────────────────────────────

const TEMPLATE = readFileSync(join(__dirname, '../src/plugins/wicked-apps/template.html'), 'utf8');
interface Booted {
  seen: Array<{ type: string; payload: Record<string, unknown> }>;
  /** What the next `artifact.read` answers (another tab's version, or the person's own landing). */
  set: (version: number, spec: AppSpec) => void;
  /** A host event on the port. */
  send: (type: string, payload: Record<string, unknown>) => void;
  /** Hold every `spec.edit` answer until `release()` (a slow acknowledgement). */
  hold: () => void;
  release: () => void;
}
async function boot(spec: AppSpec): Promise<Booted> {
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
  let ver = 1;
  let held: Array<() => void> | null = null;
  ch.port1.onmessage = (m) => {
    const d = m.data as { type: string; id?: string; payload: Record<string, unknown> };
    seen.push(d);
    if (d.id === undefined) return;
    const reply = (payload: unknown): void => ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload });
    if (d.type === 'artifact.read') { reply({ version: ver, content: { type: 'app', spec: current } }); return; }
    if (d.type === 'spec.edit') {
      const next = structuredClone(current);
      const op = (d.payload['ops'] as Array<Record<string, unknown>>)[0]!;
      const c = next.pages[0]!.components.find((x) => x.id === op['id'])! as unknown as Record<string, unknown>;
      if (op['prop'] === 'label' && c['type'] === 'button') (c['action'] as { label: string }).label = op['value'] as string; else c[op['prop'] as string] = op['value'];
      current = next;
      if (held !== null) { held.push(() => reply({ spec: next, added: [], pending: 1 })); return; }
      reply({ spec: next, added: [], pending: 1 });
      return;
    }
    reply({});
  };
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: { p: 'wicked.editor', v: 1, type: 'host.hello', payload: { protocol: 2, surface: 'full', grants: ['artifact.read', 'artifact.write', 'selection.chip'], app: { framed: false, mode: 'edit' }, theme: {}, prefs: { locale: 'en' } } },
    source: window, ports: [ch.port2],
  }));
  await vi.waitFor(() => expect(document.querySelector('.wk-palette')).not.toBeNull());
  return {
    seen,
    set: (v, sp) => { ver = v; current = sp; },
    send: (type, payload) => ch.port1.postMessage({ p: 'wicked.editor', v: 1, type, payload }),
    hold: () => { held = []; },
    release: () => { const h = held ?? []; held = null; for (const f of h) f(); },
  };
}
const SPEC = (): AppSpec => ({
  schema: 'wicked.apps/v1', name: 'T', linkHosts: [], queries: [{ id: 'x', source: 's', kind: 'sql', output: [{ name: 'n', type: 'integer' }] }],
  actions: [{ id: 'go', kind: 'api', source: 's', call: { kind: 'tool', tool: 'POST /go' }, args: {} }],
  pages: [{ id: 'p', title: 'P', components: [
    { id: 'k', type: 'kpi', title: 'Open', data: { query: 'x' }, value: 'n', box: { x: 0, y: 2, w: 3, h: 2 } },
    { id: 'note', type: 'text', title: 'Notes', text: 'Hello', box: { x: 0, y: 0, w: 6, h: 2 } },
    { id: 'go', type: 'button', action: { label: 'Go', action: 'go' }, box: { x: 6, y: 0, w: 2, h: 1 } },
    { id: 'q', type: 'filter', filter: 'search', label: 'Search', box: { x: 8, y: 0, w: 4, h: 1 } },
  ] }],
});
const dbl = (el: Element): void => { el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); };
const edits = (seen: Array<{ type: string }>): number => seen.filter((m) => m.type === 'spec.edit').length;

describe('Edit: a component’s own words, in place on the canvas', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('a double-click opens a text field (never contenteditable); Enter commits ONE op; the words show as text', async () => {
    const { seen } = await boot(SPEC());
    const title = document.querySelector('[data-component="k"] .wk-cell-title')!;
    expect(title.getAttribute('data-inline')).toBe('title');
    expect(title.classList.contains('wk-editable')).toBe(true);
    dbl(title);
    const field = document.querySelector('[data-testid="apps-inline"]') as HTMLInputElement;
    expect(field.tagName).toBe('INPUT');
    expect(document.querySelectorAll('[contenteditable]')).toHaveLength(0);
    field.value = '<img src=x onerror=window.__pwned=7> Queue';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(edits(seen)).toBe(1));
    expect(seen.find((m) => m.type === 'spec.edit')!.payload).toMatchObject({ ops: [{ op: 'component-set', id: 'k', prop: 'title', value: '<img src=x onerror=window.__pwned=7> Queue' }] });
    await vi.waitFor(() => expect(document.querySelector('[data-component="k"] .wk-cell-title')?.textContent).toBe('<img src=x onerror=window.__pwned=7> Queue'));
    expect(document.querySelectorAll('[data-testid="apps-runtime"] img')).toHaveLength(0);
    expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();
    expect(document.querySelectorAll('[style]')).toHaveLength(0);
  });

  it('Escape puts the words back and sends nothing; blur commits; a Text is a multi-line field; a Button and a Filter are renamed by their labels', async () => {
    const { seen } = await boot(SPEC());
    dbl(document.querySelector('[data-component="note"] .wk-text')!);
    const text = document.querySelector('[data-testid="apps-inline"]') as HTMLTextAreaElement;
    expect(text.tagName).toBe('TEXTAREA');
    text.value = 'Changed';
    text.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await new Promise((res) => setTimeout(res, 40));
    expect(edits(seen)).toBe(0);
    expect(document.querySelector('[data-component="note"] .wk-text')!.textContent).toBe('Hello');
    // A Button's label (the button is inert in Edit but still takes a double-click).
    const button = document.querySelector('[data-component="go"] button')!;
    expect(button.hasAttribute('disabled')).toBe(false);
    expect(button.getAttribute('aria-disabled')).toBe('true');
    dbl(button);
    const label = document.querySelector('[data-testid="apps-inline"]') as HTMLInputElement;
    label.value = 'Go now';
    label.dispatchEvent(new Event('blur'));
    await vi.waitFor(() => expect(edits(seen)).toBe(1));
    expect(seen.filter((m) => m.type === 'spec.edit')[0]!.payload).toMatchObject({ ops: [{ id: 'go', prop: 'label', value: 'Go now' }] });
    await vi.waitFor(() => expect(document.querySelector('[data-component="q"] .wk-filter-label')).not.toBeNull());
    dbl(document.querySelector('[data-component="q"] .wk-filter-label')!);
    const f = document.querySelector('[data-testid="apps-inline"]') as HTMLInputElement;
    f.value = 'Find';
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(edits(seen)).toBe(2));
    // An unchanged commit sends nothing.
    await vi.waitFor(() => expect(document.querySelector('[data-component="q"] .wk-filter-label')?.textContent).toBe('Find'));
    dbl(document.querySelector('[data-component="q"] .wk-filter-label')!);
    (document.querySelector('[data-testid="apps-inline"]') as HTMLInputElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await new Promise((res) => setTimeout(res, 40));
    expect(edits(seen)).toBe(2);
  });

  it('two taps on the same words open the field without any dblclick event (Firefox fires none after a prevented pointerdown)', async () => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
    await boot(SPEC());
    const title = document.querySelector('[data-component="k"] .wk-cell-title')!;
    const cell = document.querySelector('[data-component="k"]')!;
    for (let i = 0; i < 2; i += 1) {
      title.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      cell.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    }
    expect(document.querySelector('[data-testid="apps-inline"]')).not.toBeNull();
    expect((document.querySelector('[data-testid="apps-inline"]') as HTMLInputElement).value).toBe('Open');
  });

  it('codex r9: the person’s own version landing keeps the open field and its words; the commit goes on the newest version', async () => {
    const b = await boot(SPEC());
    dbl(document.querySelector('[data-component="k"] .wk-cell-title')!);
    const field = document.querySelector('[data-testid="apps-inline"]') as HTMLInputElement;
    field.value = 'Open now';
    b.set(2, SPEC()); // the earlier burst landed as v2: the same words
    b.send('artifact.changed', { version: 2, head: 2, by: 'this-editor', kind: 'deterministic' });
    await vi.waitFor(() => expect(b.seen.filter((m) => m.type === 'artifact.read')).toHaveLength(2));
    await new Promise((res) => setTimeout(res, 30));
    expect(document.querySelector('[data-testid="apps-inline"]')).toBe(field);
    expect(field.value).toBe('Open now');
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(edits(b.seen)).toBe(1));
    expect(b.seen.find((m) => m.type === 'spec.edit')!.payload).toMatchObject({ base: 2, ops: [{ id: 'k', prop: 'title', value: 'Open now' }] });
  });

  it('codex r9: another tab changing those words closes the field with nothing sent, and its blur sends nothing either', async () => {
    const b = await boot(SPEC());
    dbl(document.querySelector('[data-component="k"] .wk-cell-title')!);
    const field = document.querySelector('[data-testid="apps-inline"]') as HTMLInputElement;
    field.value = 'Mine';
    const theirs = SPEC();
    (theirs.pages[0]!.components[0] as { title?: string }).title = 'Theirs';
    b.set(2, theirs);
    b.send('artifact.changed', { version: 2, head: 2, by: 'other', kind: 'deterministic' });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="apps-inline"]')).toBeNull());
    field.dispatchEvent(new Event('blur')); // Chromium fires blur on the removed field
    await new Promise((res) => setTimeout(res, 40));
    expect(edits(b.seen)).toBe(0);
    expect(document.querySelector('[data-component="k"] .wk-cell-title')!.textContent).toBe('Theirs');
  });

  it('codex r10: a redraw carries the open field (same node, text, caret) and draws the rest; a finished field never lingers', async () => {
    const b = await boot(SPEC());
    b.hold();
    dbl(document.querySelector('[data-component="k"] .wk-cell-title')!);
    const a = document.querySelector('[data-testid="apps-inline"]') as HTMLInputElement;
    a.value = 'Open now';
    a.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(edits(b.seen)).toBe(1));
    // Field B opens before A's answer arrives.
    dbl(document.querySelector('[data-component="note"] .wk-text')!);
    const fields = [...document.querySelectorAll('[data-testid="apps-inline"]')];
    const field = fields.find((x) => x.tagName === 'TEXTAREA') as HTMLTextAreaElement;
    field.value = 'Hello there';
    field.setSelectionRange(5, 5);
    b.release();
    await vi.waitFor(() => expect(document.querySelector('[data-component="k"] .wk-cell-title')?.textContent).toBe('Open now'));
    expect([...document.querySelectorAll('[data-testid="apps-inline"]')]).toStrictEqual([field]);
    expect(field.value).toBe('Hello there');
    expect(field.selectionStart).toBe(5);
    // Another tab renames ANOTHER component: it is drawn now, and the field stays as it is.
    const theirs = SPEC();
    (theirs.pages[0]!.components[2] as { action: { label: string } }).action.label = 'Go elsewhere';
    (theirs.pages[0]!.components[0] as { title?: string }).title = 'Open now';
    b.set(3, theirs);
    b.send('artifact.changed', { version: 3, head: 3, by: 'other', kind: 'deterministic' });
    await vi.waitFor(() => expect(document.querySelector('[data-component="go"] button')?.textContent).toBe('Go elsewhere'));
    expect([...document.querySelectorAll('[data-testid="apps-inline"]')]).toStrictEqual([field]);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(edits(b.seen)).toBe(2));
    expect(b.seen.filter((m) => m.type === 'spec.edit')[1]!.payload).toMatchObject({ base: 3, ops: [{ id: 'note', prop: 'text', value: 'Hello there' }] });
  });

  it('codex r9: two taps on a Button’s label open it, with no dblclick (Firefox and WebKit fire none for two touch taps)', async () => {
    await boot(SPEC());
    for (let i = 0; i < 2; i += 1) {
      const button = document.querySelector('[data-component="go"] button[data-inline]')!;
      button.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
      button.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    }
    expect((document.querySelector('[data-testid="apps-inline"]') as HTMLInputElement | null)?.value).toBe('Go');
    // A native dblclick after the two taps opens no second field.
    dbl(document.querySelector('[data-component="go"]')!);
    expect(document.querySelectorAll('[data-testid="apps-inline"]')).toHaveLength(1);
  });

  it('a click selects without rebuilding the canvas, so the second click of a double-click lands on the same words', async () => {
    Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: () => {} });
    await boot(SPEC());
    const title = document.querySelector('[data-component="k"] .wk-cell-title')!;
    const cell = document.querySelector('[data-component="k"]')!;
    title.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    cell.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    expect(document.querySelector('[data-testid="apps-properties"]')).not.toBeNull();
    expect(document.querySelector('[data-component="k"] .wk-cell-title')).toBe(title);
    expect(cell.classList.contains('is-selected')).toBe(true);
  });
});

// ── a dashboard tile is read-only even if its frame is not honest (codex r9) ────────────────

describe('a tile’s host refuses everything a compromised frame could ask', () => {
  it('no edit, no history, no query to crew, no action, no link — with the person’s click and focus in the frame', async () => {
    const urls = mockDaemon({}).urls;
    const detail = crewDetail('desk', 'Desk').app as never;
    const tile = { slug: 'desk', name: 'Desk', description: '', sample: false, sampleKey: null, detail, note: null, version: 'v3', changedAt: 1, sources: [], kpis: [], published: null };
    const session = new AppSession(new FixedAppStore('desk', detail, 'crew'));
    await session.load();
    const port = tileHostPort(session, tile);
    const edit = vi.spyOn(session, 'edit');
    const move = vi.spyOn(session, 'move');
    const prepare = vi.spyOn(port.data, 'prepare');
    const container = document.createElement('div');
    document.body.append(container);
    const host = new EditorHost({
      container, src: 'about:blank', editor: 'wicked-apps', version: '0.13.0', name: 'App', title: 'Preview', size: 'inline', surface: 'card',
      grants: ['artifact.read', 'artifact.write', 'data.read', 'data.write'], theme: {}, prefs: { reducedMotion: true, techDetails: false, locale: 'en' },
      firstParty: true, adapter: new AppAdapter(session, 'Desk'), app: port, activation: () => true, focusInFrame: () => true,
      ui: { chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(), thread: vi.fn(), fullscreen: vi.fn(async () => false), torn: vi.fn(), log: () => {} },
    });
    host.mount();
    let p: MessagePort | null = null;
    vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { p = (tr?.[0] as MessagePort) ?? null; }) as never);
    const surfaces = JSON.parse(readFileSync(join(__dirname, '../src/plugins/wicked-apps/surfaces.json'), 'utf8'));
    window.dispatchEvent(new MessageEvent('message', { data: { p: 'wicked.editor', v: 1, type: 'plugin.ready', payload: { editor: 'wicked-apps', version: '0.13.0', protocol: [1, 2], surfaces } }, source: host.frame.contentWindow }));
    await vi.waitFor(() => expect(p).not.toBeNull());
    const replies: Array<{ re?: string; ok?: boolean; error?: { code: string } }> = [];
    p!.onmessage = (m) => replies.push(m.data as never);
    const ask = async (type: string, payload: unknown, id: string) => {
      p!.postMessage({ p: 'wicked.editor', v: 1, type, id, payload });
      await vi.waitFor(() => expect(replies.some((r) => r.re === id)).toBe(true), { timeout: 2_000 });
      return replies.find((r) => r.re === id)!;
    };
    expect(await ask('spec.edit', { base: 3, ops: [{ op: 'component-set', id: 'by_region', prop: 'title', value: 'x' }] }, 'e')).toMatchObject({ ok: false });
    expect(await ask('app.history', { move: 'undo', base: 3 }, 'h')).toMatchObject({ ok: false });
    expect(await ask('data.query', { query: 'open_count', params: {} }, 'q')).toMatchObject({ ok: false });
    expect(await ask('data.action', { action: 'assign_to_me', params: { id: 1 } }, 'a')).toMatchObject({ ok: false });
    const openLink = vi.spyOn(port, 'openLink');
    const link = await ask('link.open', { href: 'https://status.example.com/support' }, 'l') as { ok?: boolean; payload?: { opened?: boolean } };
    expect(link.ok === false || link.payload?.opened === false).toBe(true);
    expect(await Promise.all(openLink.mock.results.map((r) => r.value))).not.toContain(true);
    expect(edit).not.toHaveBeenCalled();
    expect(move).not.toHaveBeenCalled();
    expect(urls).toStrictEqual([]);
    expect(prepare.mock.calls.length === 0 || (await prepare.mock.results[0]!.value as { error?: string }).error === 'refused').toBe(true);
    expect(session.head).toBe(3);
    host.teardown('done');
  });
});
