import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

async function boot(app: { framed: boolean; mode: 'edit' | 'preview' }): Promise<{ host: MessagePort; seen: Array<{ type?: string; payload?: unknown }> }> {
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
    if (d.type === 'artifact.read') reply({ version: 1, content: { type: 'app', spec: SPEC } });
    if (d.type === 'data.query') {
      const q = SPEC.queries.find((x) => x.id === d.payload['query'])!;
      reply({ columns: q.output, rows: ROWS[q.id], truncated: false, hasMore: false, ms: 1, cachedAt: null });
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

beforeEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });
afterEach(() => { delete (window as unknown as { __pwned?: unknown }).__pwned; });

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
