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

async function boot({ surface = 'options', tab = 'coverage', mode = 'simple', checks = CHECKS, total = checks.length, checksError = null, html = HTML }:
  { surface?: string; tab?: string; mode?: string; checks?: typeof CHECKS; total?: number; checksError?: string | null; html?: string } = {}) {
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
  let currentChecksError = checksError;
  const port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    postMessage(m: Message) {
      seen.push(m);
      if (m.type !== 'artifact.read' && m.type !== 'checks.read' && m.type !== 'version.write') return;
      const fail = m.type === 'checks.read' ? currentChecksError : null;
      const payload = m.type === 'checks.read' ? { checks, total } : m.type === 'version.write' ? { version: Number(m.payload?.['base']) + 1 } : { version: m.payload?.['version'] ?? 1, content: { type: 'html', html: currentHTML } };
      queueMicrotask(() => port.onmessage?.(new MessageEvent('message', { data: {
        p: 'wicked.editor', v: 1, re: m.id, ok: !fail, payload,
        ...(fail ? { error: { code: fail, message: 'could not read checks' } } : {}),
      } })));
    },
  };
  const send = (type: string, payload: unknown, id?: string) => port.onmessage?.(new MessageEvent('message', { data: env(type, payload, id) }));
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: env('host.hello', { protocol: 2, surface, tab, mode, size: surface === 'card' ? 'inline' : surface === 'full' ? 'full' : 'pane', grants: ['artifact.read', 'checks.read', 'selection.chip', 'artifact.write'], theme: {} }),
    ports: [port],
  }));
  await vi.waitFor(() => expect(document.querySelector('#stage iframe')).not.toBeNull());
  return { announcement, seen, send, changeHTML: (html: string) => { currentHTML = html; },
    failChecks: (error: string | null) => { currentChecksError = error; } };
}

const coverage = () => document.querySelector<HTMLElement>('#coverage')!;
const row = (id: string) => document.querySelector<HTMLButtonElement>(`[data-testid="doc-coverage-row"][data-req="${id}"]`)!;
const keyOn = (node: HTMLElement, key: string, options: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...options });
  node.dispatchEvent(event);
  return event;
};
const measure = (frame: HTMLIFrameElement) => {
  frame.dispatchEvent(new Event('load'));
  window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: {
    v: 1, type: 'wid-inventory', scrollX: 0, scrollY: 0,
    widMap: { 'paragraph-1': { x: 0, y: 0, top: 0, left: 0, right: 100, bottom: 20, width: 100, height: 20 } },
    blocks: { 'paragraph-1': { text: 'We name (req-1).', composite: false } },
  } }));
};

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

  it('shows the plain no-requirements line for an empty successful read', async () => {
    await boot({ checks: [] });
    expect(coverage().textContent).toBe("No requirements for this document's repository");
    expect(coverage().querySelectorAll('button')).toHaveLength(0);
  });

  it('discloses the first 50 of the repository total using the existing coverage copy', async () => {
    const checks = Array.from({ length: 50 }, (_, n) => ({ id: `REQ-${n + 1}`, text: `Requirement ${n + 1}` }));
    await boot({ checks, total: 73 });
    expect(coverage().dataset).toMatchObject({ total: '73', rows: '50', named: '3' });
    expect(document.querySelector('[data-testid="doc-coverage-line"]')?.textContent).toBe('3 of 50 named in this document (the first 50 of 73)');
    expect(coverage().querySelectorAll('[data-testid="doc-coverage-row"]')).toHaveLength(50);
  });

  it.each(['not_granted', 'refused', 'timeout', 'unavailable'])('keeps a %s read distinct from empty and recovers with Try again', async (checksError) => {
    const { seen, failChecks } = await boot({ checksError });
    expect(coverage().textContent).toBe("Couldn't read the requirements · Try again");
    expect(coverage().textContent).not.toContain('No requirements');
    const retry = coverage().querySelector<HTMLButtonElement>('button')!;
    expect(retry.textContent).toBe('Try again');
    failChecks(null);
    retry.click();
    await vi.waitFor(() => expect(row('REQ-1')?.dataset['named']).toBe('true'));
    expect(seen.filter((m) => m.type === 'checks.read')).toHaveLength(2);
    expect(coverage().textContent).not.toContain("Couldn't read");
  });

  it('retries on every switch to Coverage after a failure', async () => {
    const { seen, send, failChecks } = await boot({ checksError: 'unavailable' });
    send('host.tab', { tab: 'style' });
    send('host.tab', { tab: 'coverage' });
    await vi.waitFor(() => expect(coverage().textContent).toBe("Couldn't read the requirements · Try again"));
    expect(seen.filter((m) => m.type === 'checks.read')).toHaveLength(2);
    failChecks(null);
    send('host.tab', { tab: 'style' });
    send('host.tab', { tab: 'coverage' });
    await vi.waitFor(() => expect(row('REQ-1')?.dataset['named']).toBe('true'));
    expect(seen.filter((m) => m.type === 'checks.read')).toHaveLength(3);
    send('host.tab', { tab: 'style' });
    send('host.tab', { tab: 'coverage' });
    expect(seen.filter((m) => m.type === 'checks.read')).toHaveLength(3);
  });

  it('retries on every artifact.changed after a failure, including while Coverage is hidden', async () => {
    const { seen, send, failChecks } = await boot({ checksError: 'timeout' });
    send('host.tab', { tab: 'style' });
    send('artifact.changed', { version: 1, head: 1 });
    await vi.waitFor(() => expect(coverage().textContent).toBe("Couldn't read the requirements · Try again"));
    expect(seen.filter((m) => m.type === 'checks.read')).toHaveLength(2);
    failChecks(null);
    send('artifact.changed', { version: 3, head: 3 });
    await vi.waitFor(() => expect(row('REQ-1')?.dataset['named']).toBe('true'));
    await vi.waitFor(() => expect(document.querySelector('#editor')?.getAttribute('data-head')).toBe('3'));
    expect(seen.filter((m) => m.type === 'checks.read')).toHaveLength(3);
    send('host.tab', { tab: 'coverage' });
    expect(coverage().hidden).toBe(false);
    expect(seen.filter((m) => m.type === 'checks.read')).toHaveLength(3);
  });

  it.each([
    { key: 'Escape', options: {}, forwarded: 'Escape' },
    { key: 'k', options: { metaKey: true }, forwarded: 'Mod+K' },
    { key: 'K', options: { ctrlKey: true }, forwarded: 'Mod+K' },
    { key: 'j', options: { altKey: true, code: 'KeyJ' }, forwarded: 'Alt+J' },
  ])('forwards $forwarded from a focused Coverage row', async ({ key, options, forwarded }) => {
    const { seen } = await boot();
    row('REQ-1').focus();
    expect(keyOn(row('REQ-1'), key, options).defaultPrevented).toBe(true);
    expect(seen.at(-1)).toMatchObject({ type: 'ui.key', payload: { key: forwarded } });
  });

  it('forwards the first printable key from Coverage even when an element is selected in Advanced', async () => {
    const { seen, send } = await boot({ surface: 'full', mode: 'advanced' });
    measure(document.querySelector<HTMLIFrameElement>('#stage iframe')!);
    send('host.selection', { anchors: [{ kind: 'element', id: 'paragraph-1' }] });
    row('REQ-1').focus();
    expect(keyOn(row('REQ-1'), 'x').defaultPrevented).toBe(true);
    expect(seen.at(-1)).toMatchObject({ type: 'ui.typed', payload: { grapheme: 'x' } });
    expect(document.querySelector('#input')).toHaveProperty('hidden', true);
    keyOn(row('REQ-1'), 'Escape');
    expect(seen.at(-1)).toMatchObject({ type: 'ui.key', payload: { key: 'Escape' } });
  });

  it('tabs through enabled Coverage rows and hands both boundaries back to the host', async () => {
    const { seen } = await boot();
    row('REQ-1').focus();
    keyOn(row('REQ-1'), 'Tab');
    expect(document.activeElement).toBe(row('REQ-3'));
    keyOn(row('REQ-3'), 'Tab');
    expect(seen.at(-1)).toMatchObject({ type: 'ui.key', payload: { key: 'Tab' } });
    keyOn(row('REQ-3'), 'Tab', { shiftKey: true });
    expect(document.activeElement).toBe(row('REQ-1'));
    keyOn(row('REQ-1'), 'Tab', { shiftKey: true });
    expect(seen.at(-1)).toMatchObject({ type: 'ui.key', payload: { key: 'Shift+Tab' } });
  });

  it('preserves native Enter and Space activation on Coverage buttons', async () => {
    const { seen } = await boot();
    row('REQ-1').focus();
    const before = seen.length;
    expect(keyOn(row('REQ-1'), 'Enter').defaultPrevented).toBe(false);
    expect(keyOn(row('REQ-1'), ' ').defaultPrevented).toBe(false);
    expect(seen).toHaveLength(before);
    row('REQ-1').click();
    expect(seen.at(-1)).toMatchObject({ type: 'selection.set', payload: { anchors: [{ kind: 'element', id: 'paragraph-1' }] } });
    // The focus stays on the row (agy h4b-r1), never the hidden editor's handle.
    expect(document.activeElement).toBe(row('REQ-1'));
  });

  it('hides swatches after Advanced shrinks to a card and refuses style writes after picking again', async () => {
    const { seen, send } = await boot({ surface: 'full', mode: 'advanced' });
    const frame = document.querySelector<HTMLIFrameElement>('#stage iframe')!;
    measure(frame);
    send('host.selection', { anchors: [{ kind: 'element', id: 'paragraph-1' }] });
    expect(document.querySelector('#fills')).toHaveProperty('hidden', false);
    expect(document.querySelector('#inks')).toHaveProperty('hidden', false);
    const fill = document.querySelector<HTMLButtonElement>('#fills button')!;
    const ink = document.querySelector<HTMLButtonElement>('#inks button')!;
    send('host.surface', { surface: 'card' });
    expect(document.querySelector('#fills')).toHaveProperty('hidden', true);
    expect(document.querySelector('#inks')).toHaveProperty('hidden', true);
    send('host.selection', { anchors: [] });
    window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { v: 1, type: 'wid-click', wid: 'paragraph-1' } }));
    expect(document.querySelector('#editor')?.getAttribute('data-selected')).toBe('paragraph-1');
    expect(document.querySelector('#fills')).toHaveProperty('hidden', true);
    expect(document.querySelector('#inks')).toHaveProperty('hidden', true);
    fill.click(); ink.click();
    document.querySelector<HTMLButtonElement>('#remove')!.click();
    expect(seen.filter((m) => m.type === 'version.write')).toHaveLength(0);
    send('host.surface', { surface: 'full', mode: 'simple' });
    fill.click(); ink.click();
    expect(seen.filter((m) => m.type === 'version.write')).toHaveLength(0);
    expect(document.querySelector('#fills')).toHaveProperty('hidden', true);
    send('host.mode', { mode: 'advanced' }, 'advanced-again');
    expect(document.querySelector('#fills')).toHaveProperty('hidden', false);
    fill.click();
    await vi.waitFor(() => expect(document.querySelector('#editor')?.getAttribute('data-head')).toBe('2'));
    expect(seen.filter((m) => m.type === 'version.write')).toHaveLength(1);
    expect(seen.find((m) => m.type === 'version.write')?.payload).toMatchObject({ base: 1, ops: [{ op: 'style', anchor: 'paragraph-1', style: { background: 'revert-layer' } }] });
  });

  it('a Style hello reads coverage only when host.tab selects Coverage', async () => {
    const { seen, send } = await boot({ tab: 'style' });
    expect(seen.some((m) => m.type === 'checks.read')).toBe(false);
    send('host.tab', { tab: 'coverage' });
    await vi.waitFor(() => expect(row('REQ-1')?.dataset['named']).toBe('true'));
    expect(seen.filter((m) => m.type === 'checks.read')).toHaveLength(1);
  });

  it('forwards Style host chords and boundary Tab while keeping control typing native', async () => {
    const { seen } = await boot({ tab: 'style' });
    const controls = Array.from(document.querySelectorAll<HTMLElement>('#style button, #style input, #style select'));
    expect(keyOn(controls[0]!, 'Tab', { shiftKey: true }).defaultPrevented).toBe(true);
    expect(keyOn(controls.at(-1)!, 'Tab').defaultPrevented).toBe(true);
    keyOn(controls[3]!, 'Escape');
    keyOn(controls[3]!, 'k', { metaKey: true });
    keyOn(controls[3]!, 'j', { altKey: true, code: 'KeyJ' });
    expect(keyOn(controls[3]!, 'x').defaultPrevented).toBe(false);
    expect(seen.filter((m) => m.type === 'ui.key').map((m) => m.payload?.['key']))
      .toEqual(['Shift+Tab', 'Tab', 'Escape', 'Mod+K', 'Alt+J']);
    expect(seen.filter((m) => m.type === 'ui.typed')).toHaveLength(0);
  });

  it('buffers host selection before inventory without echoing it and lets an empty selection cancel it', async () => {
    const { seen, send } = await boot({ surface: 'card' });
    const frame = document.querySelector<HTMLIFrameElement>('#stage iframe')!;
    send('host.selection', { anchors: [{ kind: 'element', id: 'paragraph-1' }] });
    measure(frame);
    expect(document.querySelector('#editor')?.getAttribute('data-selected')).toBe('paragraph-1');
    expect(seen.filter((m) => m.type === 'selection.set')).toHaveLength(0);
    send('artifact.changed', { version: 2 });
    await vi.waitFor(() => expect(document.querySelector('#editor')?.getAttribute('data-head')).toBe('2'));
    send('host.selection', { anchors: [{ kind: 'element', id: 'paragraph-1' }] });
    send('host.selection', { anchors: [] });
    measure(document.querySelector<HTMLIFrameElement>('#stage iframe')!);
    expect(document.querySelector('#editor')?.getAttribute('data-selected')).toBe('');
    expect(seen.filter((m) => m.type === 'selection.set')).toHaveLength(0);
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
    for (const id of ['input', 'peek', 'hint', 'fills', 'inks', 'remove']) {
      expect(document.getElementById(id)).toHaveProperty('hidden', true);
    }
    keyOn(document.querySelector<HTMLElement>('#handle')!, 'Enter');
    keyOn(document.querySelector<HTMLElement>('#handle')!, 'x');
    expect(seen.at(-1)).toMatchObject({ type: 'ui.typed', payload: { grapheme: 'x' } });
    expect(document.querySelector('#input')).toHaveProperty('hidden', true);
    expect(seen.filter((m) => m.type === 'version.write')).toHaveLength(0);
    send('host.surface', { surface: 'full', mode: 'simple' });
    expect(document.querySelector('#stage iframe')).toBe(frame);
    expect(document.querySelector('#peek')).toHaveProperty('hidden', true);
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
