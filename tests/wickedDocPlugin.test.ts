import { afterEach, describe, expect, it, vi } from 'vitest';
import { canonicalSurfaces, parseSurfaces } from '../src/editors/surfaces.js';
import surfaces from '../src/plugins/wicked-doc/surfaces.json';

const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id === undefined ? {} : { id }) });
type Message = { type?: string; id?: string; re?: string; ok?: boolean; payload?: Record<string, unknown> };
const HTML = `<section data-wid="section-1">REQ-4
  <p data-wid="paragraph-1">We name (req-1).</p>
  <p data-wid="paragraph-2">REQ-20, REQ-2-1, REQ-2_b, REQ-2.1, x.REQ-2</p>
  <p data-wid="paragraph-3"><b>REQ-3</b> is also named.</p>
</section>`;
const CHECKS = [1, 2, 3, 4].map((n) => ({ id: `REQ-${n}`, text: `Requirement ${n}` }));

// Each test imports the actual entry. Remove its window handlers along with its DOM at teardown.
let handlers: [string, EventListenerOrEventListenerObject][] = [];
afterEach(() => {
  for (const [type, handler] of handlers) window.removeEventListener(type, handler);
  handlers = [];
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function boot({ surface = 'options', tab = 'coverage', checks = CHECKS, refused = false, html = HTML }:
  { surface?: string; tab?: string; checks?: typeof CHECKS; refused?: boolean; html?: string } = {}) {
  vi.resetModules();
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, handler: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    handlers.push([type, handler]); add(type, handler, options);
  }) as typeof window.addEventListener);
  const ready = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  await import('../src/plugins/wicked-doc/plugin.js');
  expect(ready).toHaveBeenCalled();
  const announcement = ready.mock.calls[0]![0] as Message;
  const seen: Message[] = [];
  let currentHTML = html;
  const port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage(m: Message) {
      seen.push(m);
      if (m.type !== 'artifact.read' && m.type !== 'checks.read' && m.type !== 'version.write') return;
      const fail = m.type === 'checks.read' && refused;
      const payload = m.type === 'checks.read' ? { checks } : m.type === 'version.write' ? { version: Number(m.payload?.['base']) + 1 } : { version: m.payload?.['version'] ?? 1, content: { type: 'html', html: currentHTML } };
      queueMicrotask(() => port.onmessage?.(new MessageEvent('message', { data: {
        p: 'wicked.editor', v: 1, re: m.id, ok: !fail, payload,
        ...(fail ? { error: { code: 'not_granted', message: 'needs checks.read' } } : {}),
      } })));
    },
  };
  const send = (type: string, payload: unknown, id?: string) => port.onmessage?.(new MessageEvent('message', { data: env(type, payload, id) }));
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: env('host.hello', { protocol: 2, surface, tab, size: surface === 'card' ? 'inline' : 'pane', grants: ['artifact.read', 'checks.read', 'selection.chip', 'artifact.write'], theme: {} }),
    ports: [port],
  }));
  await vi.waitFor(() => expect(document.querySelector('#stage iframe')).not.toBeNull());
  return { announcement, seen, send, changeHTML: (html: string) => { currentHTML = html; } };
}

const coverage = () => document.querySelector<HTMLElement>('#coverage')!;
const row = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="doc-coverage-row"][data-req="${id}"]`)!;

describe('wicked-doc protocol 2', () => {
  it('announces both protocols and the exact manifest surfaces; coverage uses whole requirement ids in leaf blocks', async () => {
    const { announcement, seen } = await boot();
    expect(announcement.type).toBe('plugin.ready');
    expect(announcement.payload).toMatchObject({ editor: 'wicked-doc', protocol: [1, 2] });
    const declared = parseSurfaces(announcement.payload!['surfaces']);
    const expected = parseSurfaces(surfaces);
    expect(declared.ok).toBe(true); expect(expected.ok).toBe(true);
    if (declared.ok && expected.ok) expect(canonicalSurfaces(declared.value)).toBe(canonicalSurfaces(expected.value));
    expect(seen.some((m) => m.type === 'checks.read')).toBe(true);
    expect(coverage().hidden).toBe(false);
    expect(document.querySelector('#style')).toHaveProperty('hidden', true);
    expect(document.querySelector('[data-testid="doc-coverage-line"]')?.textContent).toBe('2 of 4 named in this document');
    for (const id of ['REQ-1', 'REQ-3']) expect(row(id).dataset['named']).toBe('true');
    for (const id of ['REQ-2', 'REQ-4']) { expect(row(id).dataset['named']).toBe('false'); expect(row(id).disabled).toBe(true); }
    expect(row('REQ-1').textContent).toContain('Requirement 1');
  });

  it('clicking a named row points at its element through the host; tab switches preserve the document', async () => {
    const { seen, send } = await boot();
    row('REQ-1').click();
    expect(seen.at(-1)).toMatchObject({ type: 'selection.set', payload: { anchors: [{ kind: 'element', id: 'paragraph-1' }] } });
    const frame = document.querySelector('#stage iframe');
    send('host.tab', { tab: 'style' });
    expect(coverage().hidden).toBe(true);
    expect(document.querySelector('#style')).toHaveProperty('hidden', false);
    expect(document.querySelector('#style h2')?.textContent).toBe('Style');
    send('host.tab', { tab: 'coverage' });
    expect(coverage().hidden).toBe(false);
    expect(document.querySelector('#stage iframe')).toBe(frame);
  });

  it.each([{ checks: [] }, { refused: true }])('shows the plain no-requirements line for %j', async (options) => {
    await boot(options);
    expect(coverage().textContent).toBe("No requirements for this document's repository");
    expect(coverage().querySelectorAll('button')).toHaveLength(0);
  });

  it('a Style hello reads coverage only when host.tab selects Coverage', async () => {
    const { seen, send } = await boot({ tab: 'style' });
    expect(seen.some((m) => m.type === 'checks.read')).toBe(false);
    send('host.tab', { tab: 'coverage' });
    await vi.waitFor(() => expect(row('REQ-1')?.dataset['named']).toBe('true'));
    expect(seen.filter((m) => m.type === 'checks.read')).toHaveLength(1);
  });

  it('points from an interactive card and edits text in full Simple mode through one version.write', async () => {
    const { seen, send } = await boot({ surface: 'card' });
    const frame = document.querySelector<HTMLIFrameElement>('#stage iframe')!;
    frame.dispatchEvent(new Event('load'));
    const fromPage = (data: unknown) => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data }));
    fromPage({ v: 1, type: 'wid-inventory', scrollX: 0, scrollY: 0,
      widMap: { 'paragraph-1': { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 } },
      blocks: { 'paragraph-1': { text: 'We name (req-1).', composite: false } },
    });
    fromPage({ v: 1, type: 'wid-click', wid: 'paragraph-1' });
    expect(document.querySelector('#editor')?.getAttribute('data-selected')).toBe('paragraph-1');
    expect(seen.at(-1)).toMatchObject({ type: 'selection.set', payload: { anchors: [{ kind: 'element', id: 'paragraph-1' }] } });
    send('host.surface', { surface: 'full', mode: 'simple' });
    expect(document.querySelector('#stage iframe')).toBe(frame);
    document.querySelector<HTMLButtonElement>('[data-width="390"]')!.click();
    expect(document.querySelector('#editor')?.getAttribute('data-width')).toBe('390');
    document.querySelector('#editor')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    const input = document.querySelector<HTMLTextAreaElement>('#input')!;
    expect(input.hidden).toBe(false);
    expect(input.value).toBe('We name (req-1).');
    input.value = 'REQ-1 now has new words.';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(document.querySelector('#editor')?.getAttribute('data-head')).toBe('2'));
    expect(seen.filter((m) => m.type === 'version.write')).toHaveLength(1);
    expect(seen.find((m) => m.type === 'version.write')?.payload).toMatchObject({ base: 1, ops: [{ op: 'text', anchor: 'paragraph-1', value: 'REQ-1 now has new words.', before: 'We name (req-1).' }] });
  });

  it('keeps the page frame across card/full morphs; Advanced adds coverage and receives host selection', async () => {
    const { seen, send, changeHTML } = await boot({ surface: 'card' });
    const frame = document.querySelector<HTMLIFrameElement>('#stage iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.srcdoc).toContain('paragraph-1');
    expect(document.querySelector('#editor')).toHaveProperty('hidden', false);
    expect(document.querySelector('#editor')?.getAttribute('data-kind')).toBe('document');
    expect(coverage().hidden).toBe(true);
    expect(seen.some((m) => m.type === 'checks.read')).toBe(false);
    send('host.surface', { surface: 'full', mode: 'simple' });
    expect(document.querySelector('#stage iframe')).toBe(frame);
    expect(document.querySelector('#remove')).toHaveProperty('hidden', true);
    send('host.mode', { mode: 'advanced' }, 'mode-1');
    expect(seen.find((m) => m.re === 'mode-1')).toMatchObject({ ok: true, payload: { mode: 'advanced' } });
    await vi.waitFor(() => expect(row('REQ-1')?.dataset['named']).toBe('true'));
    expect(coverage().hidden).toBe(false);
    expect(document.body.dataset['coverage']).toBe('side');
    expect(document.querySelector('#remove')).toHaveProperty('hidden', false);
    frame.dispatchEvent(new Event('load'));
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: {
      v: 1, type: 'wid-inventory', scrollX: 0, scrollY: 0,
      widMap: { 'paragraph-1': { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 } },
      blocks: { 'paragraph-1': { text: 'We name (req-1).', composite: false } },
    } }));
    send('host.selection', { anchors: [{ kind: 'element', id: 'paragraph-1' }] });
    expect(document.querySelector('#editor')?.getAttribute('data-selected')).toBe('paragraph-1');
    send('host.selection', { anchors: [] });
    expect(document.querySelector('#editor')?.getAttribute('data-selected')).toBe('');
    changeHTML('<p data-wid="paragraph-1">No ids here.</p>');
    send('artifact.changed', { version: 2, head: 2, by: 'agent', kind: 'generated' });
    await vi.waitFor(() => expect(document.querySelector('#editor')?.getAttribute('data-head')).toBe('2'));
    expect(row('REQ-1').dataset['named']).toBe('false');
    send('host.mode', { mode: 'simple' }, 'mode-2');
    expect(coverage().hidden).toBe(true);
    send('host.surface', { surface: 'card' });
    expect(document.querySelector('#editor')?.getAttribute('data-size')).toBe('inline');
  });
});
