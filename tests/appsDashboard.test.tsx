import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '../src/api/types.js';
import { navCurrent, navGroups } from '../src/board/navModel.js';
import { parseRoute } from '../src/hooks/useRoute.js';
import { AppsPage, appPath } from '../src/components/apps/AppsPage.js';
import { ShareSheet, embedSnippet, studioLink } from '../src/components/apps/ShareSheet.js';
import { publishedOf } from '../src/editors/apps/appsDirectory.js';
import { SAMPLE_APPS } from '../src/editors/apps/samples.js';

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
    return new Response(JSON.stringify(hit[1]), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch);
  return { urls };
}
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

  it('published: the link, who can open it, the escaped snippet and when; Copy copies each', async () => {
    const published = publishedOf({ published: { url: 'https://apps.example.test/desk/', audience: 'signed-in members of support-ops', embedUrl: 'https://apps.example.test/desk/embed', version: 7, at: 1_762_160_400_000 } })!;
    render(<ShareSheet name={'Desk "x" <y>'} slug="desk" published={published} onClose={vi.fn()} />);
    expect(screen.getByTestId('apps-share-state').textContent).toMatch(/^Published/);
    expect(screen.getByTestId('apps-share-audience').textContent).toBe('signed-in members of support-ops');
    expect(screen.getByTestId('apps-share-when').textContent).toMatch(/v7 · published/);
    fireEvent.click(screen.getByTestId('apps-share-link-copy'));
    fireEvent.click(screen.getByTestId('apps-share-embed-copy'));
    await waitFor(() => expect(writes).toHaveLength(2));
    expect(writes[0]).toBe('https://apps.example.test/desk/');
    expect(writes[1]).toBe('<iframe src="https://apps.example.test/desk/embed" title="Desk &quot;x&quot; &lt;y&gt;" width="100%" height="640" loading="lazy"></iframe>');
    expect(screen.queryByTestId('apps-share-publish')).toBeNull();
  });

  it('a malformed or partial record is "not published": no link is ever made up', () => {
    expect(publishedOf({})).toBeNull();
    expect(publishedOf({ published: { url: 'javascript:alert(1)', audience: 'x', version: 1, at: 1 } })).toBeNull();
    expect(publishedOf({ published: { url: 'https://a.test/', audience: '', version: 1, at: 1 } })).toBeNull();
    expect(publishedOf({ published: { url: 'https://a.test/', audience: 'x', version: 1.5, at: 1 } })).toBeNull();
    expect(publishedOf({ published: { url: 'https://a.test/', audience: 'x', version: 1, at: 1, embedUrl: 'data:text/html,x' } })!.embedUrl).toBeNull();
    expect(studioLink('a b', 'http://h')).toBe('http://h/apps/a%20b');
    expect(embedSnippet('https://e.test/"x', 'n')).toContain('src="https://e.test/&quot;x"');
  });
});

// ── editing in place ────────────────────────────────────────────────────────────────────────

const TEMPLATE = readFileSync(join(__dirname, '../src/plugins/wicked-apps/template.html'), 'utf8');
async function boot(spec: AppSpec): Promise<{ seen: Array<{ type: string; payload: Record<string, unknown> }> }> {
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
    if (d.type === 'artifact.read') { reply({ version: 1, content: { type: 'app', spec: current } }); return; }
    if (d.type === 'spec.edit') {
      const next = structuredClone(current);
      const op = (d.payload['ops'] as Array<Record<string, unknown>>)[0]!;
      const c = next.pages[0]!.components.find((x) => x.id === op['id'])! as unknown as Record<string, unknown>;
      if (op['prop'] === 'label' && c['type'] === 'button') (c['action'] as { label: string }).label = op['value'] as string; else c[op['prop'] as string] = op['value'];
      current = next;
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
  return { seen };
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
