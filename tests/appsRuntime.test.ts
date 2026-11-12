import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppSpec } from '../src/api/types.js';
import { colourOf, Sheet } from '../src/plugins/wicked-apps/runtime/sheet.js';

/**
 * DES-APPS-001 K4 (S4, S12, §7.1): the wicked-apps runtime itself, rendered in jsdom from its own template. Hostile
 * values render as text (no element, no script, no handler); styling is CSSOM-only (no `style` attribute anywhere,
 * in Preview or Edit); a spec colour that is not `#rrggbb` never reaches a rule; and a framed host gets no action.
 */

const TEMPLATE = readFileSync(join(__dirname, '../src/plugins/wicked-apps/template.html'), 'utf8');
const HOSTILE = ['<img src=x onerror=window.__pwned=1>', 'javascript:alert(1)', '<script>window.__pwned=3</script>'] as const;

const SPEC: AppSpec = {
  schema: 'wicked.apps/v1', name: 'Hostile', linkHosts: ['docs.example.com'], theme: { accent: 'red;}body{background:url(https://x/)}', palette: ['#00ff00', 'url(x)'] },
  pages: [{ id: 'main', title: 'Main <b>page</b>', components: [
    { id: 'note', type: 'text', text: HOSTILE[0]!, box: { x: 0, y: 0, w: 6, h: 1 } },
    { id: 'kpi', type: 'kpi', title: HOSTILE[2], data: { query: 'k' }, value: 'n', box: { x: 6, y: 0, w: 3, h: 2 } },
    { id: 'chart', type: 'chart', chart: 'bar', data: { query: 'by' }, x: 'region', series: [{ column: 'n', color: '#ff0000;background:url(x)' }], box: { x: 0, y: 1, w: 6, h: 4 } },
    { id: 'tickets', type: 'table', data: { query: 't' }, rowActions: [{ label: 'Assign to me', action: 'assign' }], box: { x: 0, y: 5, w: 12, h: 4 } },
    { id: 'pic', type: 'image', src: 'https://evil.example/x.png', alt: 'nope', box: { x: 9, y: 0, w: 3, h: 2 } },
    { id: 'trend', type: 'chart', chart: 'line', data: { query: 'per' }, x: 'day', series: [{ column: 'a' }, { column: 'b' }], box: { x: 0, y: 9, w: 6, h: 4 } },
    { id: 'trend_area', type: 'chart', chart: 'area', data: { query: 'per' }, x: 'day', series: [{ column: 'a' }], box: { x: 6, y: 9, w: 6, h: 4 } },
  ] }],
  queries: [
    { id: 'k', source: 's', kind: 'sql', output: [{ name: 'n', type: 'integer' }] },
    { id: 'by', source: 's', kind: 'sql', output: [{ name: 'region', type: 'string' }, { name: 'n', type: 'integer' }] },
    { id: 't', source: 's', kind: 'sql', output: [{ name: 'id', type: 'integer' }, { name: 'subject', type: 'string' }] },
    { id: 'per', source: 's', kind: 'sql', output: [{ name: 'day', type: 'string' }, { name: 'a', type: 'integer' }, { name: 'b', type: 'integer' }] },
  ],
  actions: [{ id: 'assign', kind: 'row-write', source: 'w', table: 's.t', op: 'update', set: { owner: { kind: 'viewer', claim: 'email' } }, key: { id: { kind: 'param', name: 'id' } } }],
};
const ROWS: Record<string, unknown[][]> = {
  k: [[HOSTILE[1]]], by: [[HOSTILE[0], 3], ['APAC', 1]], t: HOSTILE.map((h, i) => [i + 1, h]),
  per: [['Mon', 3, 1], ['Tue', 5, 2], ['Wed', 2, 4], ['Thu', 6, 3]],
};

function mountTemplate(): void {
  const style = /<style id="wk-apps-sheet">([\s\S]*?)<\/style>/u.exec(TEMPLATE)![1]!;
  const el = document.createElement('style');
  el.id = 'wk-apps-sheet';
  el.textContent = style;
  document.head.append(el);
}

async function boot(app: { framed: boolean; mode: 'edit' | 'preview'; propsHost?: boolean }, fixture: {
  spec?: AppSpec; rows?: Record<string, unknown[][]>; hasMore?: boolean; truncated?: boolean;
} = {}): Promise<{ host: MessagePort; seen: Array<{ type?: string; payload?: unknown }> }> {
  const spec = fixture.spec ?? SPEC;
  vi.resetModules();
  mountTemplate();
  const { startRuntime } = await import('../src/plugins/wicked-apps/runtime/runtime.js');
  startRuntime({ editor: 'wicked-apps', surfaces: {} });
  const ch = new MessageChannel();
  const seen: Array<{ type?: string; payload?: unknown }> = [];
  ch.port1.onmessage = (m) => {
    const d = m.data as { type: string; id?: string; payload: Record<string, unknown> };
    seen.push(d);
    if (d.id === undefined) return;
    const reply = (payload: unknown): void => ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload });
    if (d.type === 'artifact.read') reply({ version: 1, content: { type: 'app', spec } });
    if (d.type === 'data.query') {
      const q = spec.queries.find((x) => x.id === d.payload['query'])!;
      reply({ columns: q.output, rows: fixture.rows?.[q.id] ?? ROWS[q.id], truncated: fixture.truncated ?? false, hasMore: fixture.hasMore ?? false, ms: 1, cachedAt: null });
    }
  };
  const hello = Object.assign(new Event('message'), {
    data: { p: 'wicked.editor', v: 1, type: 'host.hello', payload: { protocol: 2, surface: 'full', grants: ['artifact.read', 'artifact.write', 'selection.chip', 'data.read', 'data.write'], app, theme: { '--accent': 'url(https://x/)', '--ink-high': '#111111' }, prefs: { locale: 'en' } } },
    source: window, ports: [ch.port2],
  });
  window.dispatchEvent(hello);
  await vi.waitFor(() => expect(document.querySelectorAll('.wk-table tbody tr')).toHaveLength(3), { timeout: 2_000 });
  return { host: ch.port1, seen };
}

beforeEach(() => {
  document.head.innerHTML = ''; document.body.innerHTML = '';
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { value: vi.fn(), configurable: true });
});
afterEach(() => {
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
  delete (window as unknown as { __pwned?: unknown }).__pwned;
});

describe('studio#1119: phone tables, tabs and large select filters', () => {
  const cases = Array.from({ length: 457 }, (_, i) => [`case-${i}`, `${i < 310 ? 'Open' : i < 322 ? 'Rare' : 'Closed'} case ${i}`]);
  const filterSpec = (kind: 'query' | 'values', selected = '', count = 457): AppSpec => ({
    ...SPEC,
    queries: [...SPEC.queries, { id: 'cases', source: 's', kind: 'sql', output: [{ name: 'id', type: 'string' }, { name: 'label', type: 'string' }] }],
    pages: [{ ...SPEC.pages[0]!, components: [...SPEC.pages[0]!.components, {
      id: 'case_picker', type: 'filter', filter: 'select', label: 'Case', default: selected,
      options: kind === 'query' ? { kind: 'query', query: { query: 'cases' }, value: 'id', label: 'label' }
        : { kind: 'values', values: cases.slice(0, count).map(([value, label]) => ({ value: value!, label: label! })) },
      box: { x: 0, y: 13, w: 6, h: 1 },
    }] }],
  });
  const picker = (): HTMLElement => document.querySelector('[data-component="case_picker"]')!;
  const select = (): HTMLSelectElement => picker().querySelector('select')!;
  const countText = (): string | null => picker().querySelector('[aria-live]')?.getAttribute('aria-label') ?? null;
  const search = (): HTMLInputElement => picker().querySelector('input[type="search"]')!;
  const find = (value: string): void => { search().value = value; search().dispatchEvent(new Event('input', { bubbles: true })); };
  const rule = (selector: string): string => {
    const rules = (document.getElementById('wk-apps-sheet') as HTMLStyleElement).sheet!.cssRules;
    return [...rules].filter((r) => (r as CSSStyleRule).selectorText === selector).map((r) => r.cssText).join('\n');
  };

  it('contains the table in its own horizontal scroller and wraps cells only at word boundaries', async () => {
    await boot({ framed: false, mode: 'preview' });
    const table = document.querySelector('.wk-table')!;
    expect(table.parentElement?.className).toBe('wk-table-scroll');
    expect(table.closest('.wk-cell-body')).not.toBeNull();
    expect(rule('.wk-table-scroll')).toContain('overflow-x: auto');
    expect(rule('.wk-table-scroll')).toContain('max-width: 100%');
    expect(rule('.wk-table td')).toContain('overflow-wrap: normal');
    expect(rule('.wk-table td')).toContain('word-break: normal');
    const prose = document.querySelector('.wk-table tbody td:nth-child(2)')!;
    expect(getComputedStyle(prose).whiteSpace).toBe('normal');
    expect(getComputedStyle(prose).minWidth).toBe('16ch');
    expect(getComputedStyle(prose).maxWidth).toBe('60ch');
    // A touch-action:none ancestor would prevent phone users from swiping the scroller.
    expect(rule('.wk-cell, .wk-handle')).toBe('');
    expect(rule('.wk-app[data-mode="edit"] .wk-cell, .wk-handle')).toContain('touch-action: none');
  });

  it('keeps every identifier unbroken whatever its length, and gives the scroller a keyboard stop (approver r2)', async () => {
    const long = `${'A'.repeat(70)}-SUFFIX`;
    await boot({ framed: false, mode: 'preview' }, { rows: { t: [[1, long], [2, 'CASE-A00224'], [3, 'two words']] } });
    const cells = [...document.querySelectorAll<HTMLElement>('.wk-table tbody td:nth-child(2)')];
    expect(cells.map((td) => td.className)).toEqual(['wk-token wk-token--long', 'wk-token', 'wk-prose']);
    expect(cells[0]!.title).toBe(long);
    expect(cells[1]!.title).toBe('');
    expect(getComputedStyle(cells[0]!).whiteSpace).toBe('nowrap');
    expect(rule('.wk-table td.wk-token--long')).toContain('text-overflow: ellipsis');
    const scroll = document.querySelector<HTMLElement>('.wk-table-scroll')!;
    expect(scroll.tabIndex).toBe(0);
    expect(scroll.getAttribute('role')).toBe('region');
    expect(scroll.getAttribute('aria-label')).toBe('Table, scrolls sideways');
    expect(rule('.wk-table-scroll:focus-visible')).toContain('outline');
  });

  it('a narrow filter keeps a usable search on its one row; a select without a search keeps its label (approver r3)', async () => {
    expect(TEMPLATE).toMatch(/\.wk-filter-select \{[^}]*container: wkfilter \/ inline-size;/u);
    expect(TEMPLATE).toMatch(/\.wk-filter-select--search \.wk-filter-label \{ flex: 0 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; \}/u);
    expect(TEMPLATE).toMatch(/\.wk-filter-select--search \.wk-filter \.wk-input \{ flex: 1 1 0; width: 0; min-width: 6ch; \}/u);
    expect(TEMPLATE).toMatch(/@container wkfilter \(max-width: 300px\) \{\s*\.wk-filter-select--search \.wk-filter-options \.wk-muted \{ position: absolute;/u);
    // No rule hides a label outright any more.
    expect(TEMPLATE).not.toMatch(/\.wk-filter-label \{ position: absolute;/u);
    await boot({ framed: false, mode: 'preview' }, { spec: filterSpec('query'), rows: { cases } });
    await vi.waitFor(() => expect(select().options.length).toBeGreaterThan(200));
    expect(picker().querySelector('.wk-filter-select')!.classList.contains('wk-filter-select--search')).toBe(true);
    expect(picker().querySelector('.wk-filter-label')!.getAttribute('title')).toBe('Case');
  });

  it('a small select has no search and no search layout', async () => {
    await boot({ framed: false, mode: 'preview' }, { spec: filterSpec('values', '', 3), rows: { cases } });
    await vi.waitFor(() => expect(select().options.length).toBe(4));
    expect(picker().querySelector('.wk-filter-select')!.classList.contains('wk-filter-select--search')).toBe(false);
    expect(picker().querySelector('input[type="search"]')).toBeNull();
  });

  it('keeps every page tab inside a width-constrained horizontal scroller', async () => {
    await boot({ framed: false, mode: 'preview' }, { spec: { ...SPEC, pages: [...SPEC.pages,
      ...Array.from({ length: 5 }, (_, i) => ({ id: `page-${i}`, title: `Another page ${i}`, components: [] })),
    ] } });
    expect(document.querySelectorAll('.wk-pages .wk-page')).toHaveLength(6);
    expect(rule('.wk-pages')).toContain('overflow-x: auto');
    expect(rule('.wk-pages')).toContain('max-width: 100%');
    expect(rule('.wk-page')).toContain('flex: 0 0 auto');
    expect(rule('.wk-main')).toContain('overflow-x: hidden');
  });

  it('restores tab scroll and active focus after a click, keyboard activation and a redraw', async () => {
    const user = userEvent.setup();
    const { host } = await boot({ framed: false, mode: 'preview' }, { spec: { ...SPEC, pages: [...SPEC.pages,
      ...Array.from({ length: 6 }, (_, i) => ({ id: `page-${i}`, title: `Another page ${i}`, components: [] })),
    ] } });
    const nav = (): HTMLElement => document.querySelector('.wk-pages')!;
    nav().scrollLeft = 423;
    (nav().lastElementChild as HTMLButtonElement).click();
    expect(nav().scrollLeft).toBe(423);
    expect(document.activeElement).toBe(nav().lastElementChild);
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', inline: 'nearest' });
    // Native button keyboard activation must hand focus to the replacement button too.
    (nav().firstElementChild as HTMLButtonElement).focus();
    await user.keyboard('{Enter}');
    expect(document.activeElement).toBe(nav().firstElementChild);
    expect(nav().scrollLeft).toBe(423);
    host.postMessage({ p: 'wicked.editor', v: 1, type: 'host.theme', payload: { theme: {} } });
    const old = nav();
    await vi.waitFor(() => expect(nav()).not.toBe(old));
    expect(nav().scrollLeft).toBe(423);
    expect(document.activeElement).toBe(nav().firstElementChild);
  });

  it('restores option-search text, focus and selection through query refresh without stealing focus', async () => {
    const { host, seen } = await boot({ framed: false, mode: 'preview' }, { spec: filterSpec('query'), rows: { cases } });
    await vi.waitFor(() => expect(search()).not.toBeNull());
    find('Case 32');
    search().focus();
    search().setSelectionRange(2, 6, 'backward');
    const old = search();
    host.postMessage({ p: 'wicked.editor', v: 1, type: 'data.invalidate', payload: {} });
    await vi.waitFor(() => expect(search()).not.toBe(old));
    expect(document.activeElement).toBe(search());
    expect(search().value).toBe('Case 32');
    expect([search().selectionStart, search().selectionEnd, search().selectionDirection]).toEqual([2, 6, 'backward']);
    const other = document.querySelector<HTMLButtonElement>('.wk-page')!;
    other.focus();
    const queries = seen.filter((m) => m.type === 'data.query').length;
    host.postMessage({ p: 'wicked.editor', v: 1, type: 'data.invalidate', payload: {} });
    const previous = search();
    await vi.waitFor(() => expect(search()).not.toBe(previous));
    expect(seen.filter((m) => m.type === 'data.query').length).toBeGreaterThan(queries);
    expect(document.activeElement).toBe(other);
    expect(search().value).toBe('Case 32');
  });

  it('defers a query redraw until option-search composition ends', async () => {
    const { host, seen } = await boot({ framed: false, mode: 'preview' }, { spec: filterSpec('query'), rows: { cases } });
    await vi.waitFor(() => expect(search()).not.toBeNull());
    search().focus();
    const old = search();
    const oldChart = document.querySelector('[data-component="trend_area"] polyline');
    old.dispatchEvent(new CompositionEvent('compositionstart'));
    find('Case 32');
    const queries = seen.filter((m) => m.type === 'data.query').length;
    host.postMessage({ p: 'wicked.editor', v: 1, type: 'data.invalidate', payload: {} });
    await vi.waitFor(() => expect(seen.filter((m) => m.type === 'data.query').length).toBeGreaterThan(queries));
    // Wait for the refresh batch to redraw the chart before ending composition.
    await vi.waitFor(() => expect(document.querySelector('[data-component="trend_area"] polyline')).not.toBe(oldChart));
    expect(search()).toBe(old);
    old.dispatchEvent(new CompositionEvent('compositionend'));
    expect(search()).not.toBe(old);
    expect(document.activeElement).toBe(search());
    expect(search().value).toBe('Case 32');
  });

  it('fits select controls in one desktop row with a short, accessible count', async () => {
    await boot({ framed: false, mode: 'preview' }, { spec: filterSpec('values') });
    const box = picker().querySelector('.wk-filter-select')!;
    expect(getComputedStyle(box).flexDirection).not.toBe('column');
    expect(rule('.wk-filter-options')).not.toContain('flex-wrap: wrap');
    expect(picker().querySelector('[aria-live]')!.textContent).toBe('200 of 457');
    expect(countText()).toBe('Showing 200 of 457');
    expect(picker().querySelector('[aria-live]')!.getAttribute('title')).toBe(countText());
  });

  it('keeps single tokens unbroken at any length, gives prose room, and top-aligns table cells', async () => {
    await boot({ framed: false, mode: 'preview' }, { rows: { t: [
      [1, 'CASE-A00224'], [2, 'A'.repeat(65)], [3, 'Review the renewal terms'],
    ] } });
    const cells = [...document.querySelectorAll<HTMLElement>('.wk-table tbody td:nth-child(2)')];
    expect(cells.map((c) => getComputedStyle(c).whiteSpace)).toEqual(['nowrap', 'nowrap', 'normal']);
    expect(cells.every((c) => getComputedStyle(c).verticalAlign === 'top')).toBe(true);
    expect(getComputedStyle(cells[2]!).minWidth).toBe('16ch');
    expect(getComputedStyle(cells[2]!).maxWidth).toBe('60ch');
  });

  it.each(['query', 'values'] as const)('ends a capped %s select with a disabled search notice', async (kind) => {
    await boot({ framed: false, mode: 'preview' }, { spec: filterSpec(kind), rows: { cases } });
    await vi.waitFor(() => expect(select().options.length).toBeGreaterThan(200));
    const last = select().options[select().options.length - 1]!;
    expect(last.disabled).toBe(true);
    expect(last.textContent).toBe('Showing 200 of 457: search to narrow');
    expect([...select().options].filter((option) => !option.disabled)).toHaveLength(201);
  });

  it('shows 200 of 457 query options, searches all fetched labels, and keeps the selection and All', async () => {
    const { seen } = await boot({ framed: false, mode: 'preview' }, { spec: filterSpec('query'), rows: { cases } });
    await vi.waitFor(() => expect(countText()).toContain('Showing 200 of 457'));
    expect(select().options).toHaveLength(202);
    expect(select().options[0]!.textContent).toBe('All');
    expect(select().options[201]!.textContent).toBe('Showing 200 of 457: search to narrow');
    expect(select().options[201]!.disabled).toBe(true);
    expect(picker().querySelector('[aria-live]')!.textContent).toBe('200 of 457');
    expect(picker().querySelector('[aria-live]')!.getAttribute('title')).toBe('Showing 200 of 457');
    expect(search().getAttribute('aria-label')).toBe('Search Case options');
    select().value = 'case-1';
    select().dispatchEvent(new Event('change', { bubbles: true }));
    await vi.waitFor(() => expect(seen.filter((m) => m.type === 'data.query' && (m.payload as { query: string }).query === 'cases')).toHaveLength(2));
    await vi.waitFor(() => expect(select().value).toBe('case-1'));
    const queries = seen.filter((m) => m.type === 'data.query').length;
    find('rArE');
    expect(countText()).toContain('Showing 12 matches');
    expect(select().options).toHaveLength(14); // All, twelve matches and the current selection.
    expect(select().value).toBe('case-1');
    expect(select().selectedOptions[0]!.textContent).toBe('Open case 1');
    expect([...select().options].some((o) => o.value === 'case-321')).toBe(true);
    find('OPEN CASE');
    expect(countText()).toContain('Showing 200 of 310 matches');
    expect(select().options).toHaveLength(202);
    find('nothing matches');
    expect(countText()).toContain('Showing 0 matches');
    expect(select().options).toHaveLength(2);
    expect(select().value).toBe('case-1');
    find('');
    expect(countText()).toContain('Showing 200 of 457');
    expect(seen.filter((m) => m.type === 'data.query')).toHaveLength(queries);
  });

  it.each(['hasMore', 'truncated'] as const)('marks the query count as incomplete when %s is true', async (flag) => {
    await boot({ framed: false, mode: 'preview' }, { spec: filterSpec('query'), rows: { cases }, [flag]: true });
    await vi.waitFor(() => expect(countText()).toContain('Showing 200 of 457+'));
    expect(select().options[select().options.length - 1]!.textContent).toBe('Showing 200 of 457+: search to narrow');
    expect(select().options[select().options.length - 1]!.disabled).toBe(true);
    find('rare');
    expect(countText()).toContain('Showing 12 matches in fetched rows');
  });

  it('offers search even below the cap when the source has more rows', async () => {
    await boot({ framed: false, mode: 'preview' }, { spec: filterSpec('query'), rows: { cases: cases.slice(0, 20) }, hasMore: true });
    await vi.waitFor(() => expect(countText()).toContain('Showing 20 of 20+'));
    expect(search()).not.toBeNull();
  });

  it('gives values-fed selects the same count and search, reserving a slot for a selected value past the cap', async () => {
    const { host } = await boot({ framed: false, mode: 'preview' }, { spec: filterSpec('values', 'case-456') });
    expect(countText()).toContain('Showing 200 of 457');
    expect(select().options).toHaveLength(202);
    expect(select().value).toBe('case-456');
    expect(select().selectedOptions[0]!.textContent).toBe('Closed case 456');
    find('open case');
    expect(countText()).toContain('Showing 199 of 310 matches');
    expect(select().options).toHaveLength(202);
    expect(select().value).toBe('case-456');
    find('rare');
    expect(countText()).toContain('Showing 12 matches');
    expect(select().value).toBe('case-456');
    host.postMessage({ p: 'wicked.editor', v: 1, type: 'host.theme', payload: { theme: { '--ink-high': '#eeeeee', '--surface-raised': '#151515' } } });
    await vi.waitFor(() => expect(rule(':root')).toContain('--ink-high: #eeeeee'));
    expect(search().value).toBe('rare');
    expect(select().value).toBe('case-456');
    expect(rule('.wk-input')).toContain('var(--surface-raised)');
    expect(rule('.wk-muted')).toContain('var(--ink-muted)');
    select().value = '';
    select().dispatchEvent(new Event('change', { bubbles: true }));
    expect(select().value).toBe('');
    expect(select().options).toHaveLength(13);
    expect(countText()).toContain('Showing 12 matches');
  });

  it('keeps a selected value absent from fetched options selectable', async () => {
    await boot({ framed: false, mode: 'preview' }, { spec: filterSpec('query', 'saved-case'), rows: { cases } });
    await vi.waitFor(() => expect(countText()).toContain('Showing 199 of 457'));
    expect(select().options).toHaveLength(202);
    expect(select().value).toBe('saved-case');
    find('rare');
    expect(select().selectedOptions[0]!.textContent).toBe('saved-case');
    expect(select().options[0]!.textContent).toBe('All');
  });

  it('leaves a complete small values list without a count or search', async () => {
    await boot({ framed: false, mode: 'preview' }, { spec: filterSpec('values', '', 20) });
    expect(select().options).toHaveLength(21);
    expect(search()).toBeNull();
    expect(picker().textContent).not.toContain('Showing');
  });
});

describe('S4 / S12: values are text', () => {
  it('hostile cells, titles, text and chart labels render as their characters; nothing runs; no network image', async () => {
    await boot({ framed: false, mode: 'preview' });
    const root = document.querySelector('[data-testid="apps-runtime"]')!;
    const cells = [...root.querySelectorAll('.wk-table tbody td:nth-child(2)')].map((td) => td.textContent);
    expect(cells).toStrictEqual(HOSTILE);
    expect(root.querySelector('.wk-text')!.textContent).toBe(HOSTILE[0]);
    expect(root.querySelector('[data-component="kpi"] .wk-cell-title')!.textContent).toBe(HOSTILE[2]);
    expect(root.querySelector('.wk-kpi-value')!.textContent).toBe(HOSTILE[1]);
    expect(root.querySelector('.wk-page')!.textContent).toBe('Main <b>page</b>');
    expect([...root.querySelectorAll('svg text')].some((t) => t.textContent!.startsWith('<img'))).toBe(true);
    expect(root.querySelectorAll('img, script, iframe, b, a[href]')).toHaveLength(0);
    expect(root.querySelector('[data-component="pic"]')!.textContent).toMatch(/not one the app can show/);
    expect((window as unknown as { __pwned?: unknown }).__pwned).toBeUndefined();
    for (const e of root.querySelectorAll('*')) for (const a of e.getAttributeNames()) expect(a.startsWith('on'), `${e.tagName} ${a}`).toBe(false);
  });
});

describe('K5: the host draws Properties', () => {
  it('with app.propsHost the runtime draws no Properties column in Edit, and a selection that ends is said to the host', async () => {
    const { host, seen } = await boot({ framed: false, mode: 'preview', propsHost: true });
    host.postMessage({ p: 'wicked.editor', v: 1, type: 'app.mode', payload: { mode: 'edit' } });
    await vi.waitFor(() => expect(document.querySelector('.wk-palette')).not.toBeNull());
    expect(document.querySelector('[data-testid="apps-properties"], [data-testid="apps-properties-empty"]')).toBeNull();
    // Enter on a focused component selects it (no pointer), as a click does.
    (document.querySelector('[data-component="chart"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await vi.waitFor(() => expect(seen.some((m) => m.type === 'selection.set' && JSON.stringify(m.payload).includes('"chart"'))).toBe(true));
    expect(document.querySelector('[data-testid="apps-properties"]')).toBeNull();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await vi.waitFor(() => expect(seen.some((m) => m.type === 'selection.set' && JSON.stringify((m.payload as { anchors?: unknown }).anchors) === '[]')).toBe(true));
  });

  it('without it (K4 hosts) the runtime keeps its own Properties column', async () => {
    const { host } = await boot({ framed: false, mode: 'preview' });
    host.postMessage({ p: 'wicked.editor', v: 1, type: 'app.mode', payload: { mode: 'edit' } });
    await vi.waitFor(() => expect(document.querySelector('[data-testid="apps-properties-empty"]')).not.toBeNull());
  });
});

describe('§7.1: CSSOM only', () => {
  it('no style attribute in Preview or in Edit; spec colours that are not #rrggbb never reach a rule', async () => {
    const { host } = await boot({ framed: false, mode: 'preview' });
    expect(document.querySelectorAll('[style]')).toHaveLength(0);
    host.postMessage({ p: 'wicked.editor', v: 1, type: 'app.mode', payload: { mode: 'edit' } });
    await vi.waitFor(() => expect(document.querySelector('.wk-palette')).not.toBeNull());
    (document.querySelector('[data-component="chart"]') as HTMLElement).dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(document.querySelectorAll('[style]')).toHaveLength(0);
    const css = [...(document.getElementById('wk-apps-sheet') as HTMLStyleElement).sheet!.cssRules].map((r) => r.cssText).join('\n');
    expect(css).not.toMatch(/url\(|red;|background:url/u);
    expect(css).toMatch(/--s0:\s*#00ff00/u);
    expect(css).toMatch(/grid-column:\s*1 \/ span 6/u);
    expect(colourOf('#A0b1C2')).toBe('#a0b1c2');
    for (const bad of ['red', '#fff', '#ff0000;x', 'url(x)', '#ff00001']) expect(colourOf(bad)).toBeNull();
  });

  it('a selector outside the runtime’s vocabulary is refused', () => {
    mountTemplate();
    const s = new Sheet(document.getElementById('wk-apps-sheet') as HTMLStyleElement);
    expect(() => (s as unknown as { rule(x: string): unknown }).rule('body{}*')).toThrow(/vocabulary/u);
  });
});

describe('studio#963: a line chart draws lines, not shapes', () => {
  it('every line series and the line over an area resolve to fill none; an area has no outline; the colour still reaches the stroke', async () => {
    await boot({ framed: false, mode: 'preview' });
    await vi.waitFor(() => expect(document.querySelectorAll('[data-component="trend"] polyline.wk-stroke')).toHaveLength(2));
    const lines = [...document.querySelectorAll('[data-component="trend"] polyline.wk-stroke')];
    const overArea = [...document.querySelectorAll('[data-component="trend_area"] polyline.wk-stroke')];
    const areas = [...document.querySelectorAll('[data-component="trend_area"] path.wk-area')];
    expect(overArea).toHaveLength(1);
    expect(areas).toHaveLength(1);
    // The series rules set fill and stroke; the role rules must win over them (they lost on order before the fix).
    // jsdom resolves by source order only; e2e/apps_runtime_test.py step 6b checks the real cascade in every engine.
    for (const l of [...lines, ...overArea]) expect(getComputedStyle(l).fill, l.getAttribute('class')!).toBe('none');
    for (const a of areas) expect(getComputedStyle(a).stroke).toBe('none');
    expect(getComputedStyle(lines[0]!).stroke).toMatch(/--c0|--s0/u);
    expect(getComputedStyle(lines[1]!).strokeDasharray).toBe('5 4');
  });
});

describe('§7.1: a framed host gets no action at all', () => {
  it('framed: "Open to make changes" instead of the row button, and no data.action is ever sent', async () => {
    const { seen } = await boot({ framed: true, mode: 'preview' });
    expect(document.querySelectorAll('.wk-td-actions button')).toHaveLength(0);
    expect(document.querySelector('.wk-td-actions')!.textContent).toMatch(/Open to make changes/);
    expect(seen.some((m) => m.type === 'data.action')).toBe(false);
  });

  it('not framed, Preview: the row button asks the host (data.action) with the row’s values', async () => {
    const { seen } = await boot({ framed: false, mode: 'preview' });
    (document.querySelector('.wk-td-actions button') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(seen.find((m) => m.type === 'data.action')).toMatchObject({ payload: { action: 'assign', params: {} } }));
  });
});
