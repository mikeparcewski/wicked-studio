import { afterEach, describe, expect, it, vi } from 'vitest';
import { defaultVideoStyle, videoValues } from '../src/editors/demoCutModel.js';

type Pack = 'apps' | 'doc' | 'page' | 'insights' | 'video';
interface Message { type?: string; id?: string; re?: string; payload?: Record<string, unknown> }
const envelope = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id === undefined ? {} : { id }) });
let teardown: (() => void) | undefined;
let handlers: [string, EventListenerOrEventListenerObject][] = [];
afterEach(() => {
  teardown?.(); teardown = undefined;
  for (const [type, handler] of handlers) window.removeEventListener(type, handler);
  handlers = [];
  document.body.replaceChildren();
  document.getElementById('wk-apps-sheet')?.remove();
  vi.restoreAllMocks();
});

// Exercise each real plugin entry over the granted port, including the shared Style pane in doc/page.
async function boot(pack: Pack, tab = 'style', surface = 'options') {
  vi.resetModules();
  const add = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(((type: string, handler: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    handlers.push([type, handler]); add(type, handler, options);
  }) as typeof window.addEventListener);
  vi.spyOn(window, 'postMessage').mockImplementation(() => {});
  if (pack === 'apps') {
    const sheet = document.createElement('style'); sheet.id = 'wk-apps-sheet'; document.head.append(sheet);
    const { startRuntime } = await import('../src/plugins/wicked-apps/runtime/runtime.js');
    startRuntime({ editor: 'wicked-apps', surfaces: {} });
  } else if (pack === 'insights') (await import('../src/plugins/wicked-insights/plugin.js')).start();
  else if (pack === 'doc') await import('../src/plugins/wicked-doc/plugin.js');
  else if (pack === 'page') await import('../src/plugins/wicked-page/plugin.js');
  else await import('../src/plugins/wicked-video/plugin.js');

  const content = pack === 'apps' ? {
    type: 'app', spec: { schema: 'wicked.apps/v1', name: 'Test app', theme: {}, queries: [], actions: [],
      pages: [{ id: 'main', title: 'Main', components: [{ id: 'note', type: 'text', text: 'App text', box: { x: 0, y: 0, w: 6, h: 1 } }] }] },
  } : pack === 'insights' ? { type: 'run-insights', reviews: [], metrics: [], trends: [], running: false }
    : { type: 'html', html: '<section data-wid="section"><p data-wid="text">Document text</p></section>' };
  const seen: Message[] = [];
  const port = {
    onmessage: null as ((event: MessageEvent) => void) | null,
    start() {}, close() {},
    postMessage(m: Message) {
      seen.push(m);
      if (m.type === 'artifact.read' || m.type === 'checks.read') queueMicrotask(() => port.onmessage?.(new MessageEvent('message', {
        data: { p: 'wicked.editor', v: 1, re: m.id, ok: true, payload: m.type === 'artifact.read' ? { version: 1, content } : { checks: [], total: 0 } },
      })));
    },
  };
  const send = (type: string, payload: unknown, id?: string) => port.onmessage?.(new MessageEvent('message', { data: envelope(type, payload, id) }));
  teardown = () => send('host.teardown', {});
  window.dispatchEvent(Object.assign(new Event('message'), {
    data: envelope('host.hello', { protocol: 2, surface, size: 'pane', tab, mode: 'advanced',
      grants: ['artifact.read', 'artifact.write', 'artifact.theme', 'selection.chip'], app: { framed: false, mode: 'edit' }, theme: {} }),
    source: window, ports: [port],
  }));
  const loaded = pack === 'apps' ? '.wk-cell' : pack === 'insights' ? 'main h1' : pack === 'video' ? '#status' : '#stage iframe';
  await vi.waitFor(() => {
    expect(seen.some(m => m.type === 'artifact.read')).toBe(true);
    expect(document.querySelector(loaded)).not.toBeNull();
    if (pack === 'video') expect(document.querySelector('#status')?.textContent).toBe('No cut is available here.');
  });
  const selector = pack === 'apps' ? '.wk-app' : pack === 'insights' ? 'main' : pack === 'video' ? '#video-editor' : '#style';
  return { root: document.querySelector<HTMLElement>(selector)!, seen, send };
}
const press = (node: Element, key: string, init: KeyboardEventInit = {}) => {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  node.dispatchEvent(e); return e;
};
const effects = (seen: Message[]) => seen.filter(m => m.type !== undefined && /^(?:ui\.(?:key|typed|draft)|selection\.|version\.write|spec\.edit|theme\.set|app\.history)/.test(m.type));

describe('editor frame conformance cases 5 and 6', () => {
  for (const pack of ['apps', 'doc', 'page', 'insights'] as const) {
    it(`${pack}: forwards one printable key from non-control content without edits or selections`, async () => {
      const { root, seen } = await boot(pack);
      const content = root.querySelector('h1, h2, p')!;
      seen.length = 0;
      expect.soft(press(content, 'x').defaultPrevented).toBe(true);
      expect(effects(seen)).toEqual([expect.objectContaining({ type: 'ui.typed', payload: { grapheme: 'x' } })]);
    });
    it(`${pack}: leaves Tab native from the surface itself and from a body whose focus a redraw dropped`, async () => {
      const { root, seen } = await boot(pack);
      if (pack === 'doc' || pack === 'page') { expect(root.getAttribute('tabindex')).toBe('-1'); root.focus(); expect(document.activeElement).toBe(root); }
      seen.length = 0;
      for (const node of [root, document.body]) {
        expect(press(node, 'Tab').defaultPrevented).toBe(false);
        expect(press(node, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
      }
      expect(effects(seen)).toEqual([]);
    });
    it(`${pack}: Backspace and Delete on unselected content do nothing`, async () => {
      const { root, seen } = await boot(pack);
      seen.length = 0;
      for (const key of ['Backspace', 'Delete']) expect(press(root, key).defaultPrevented).toBe(false);
      expect(effects(seen)).toEqual([]);
    });
  }
  it.each(['apps', 'insights'] as const)('%s: forwards host navigation chords, never action chords, with focus on the body', async pack => {
    const { seen } = await boot(pack);
    const root = document.body;
    seen.length = 0;
    for (const [key, init] of [
      ['Escape', {}], ['k', { ctrlKey: true }], ['k', { metaKey: true }], ['j', { code: 'KeyJ', altKey: true }],
    ] as const) expect.soft(press(root, key, init).defaultPrevented).toBe(true);
    for (const key of ['A', 'R', 'X', 'N']) expect(press(root, key.toLowerCase(), { code: `Key${key}`, altKey: true }).defaultPrevented).toBe(false);
    expect(effects(seen).map(m => [m.type, m.payload])).toEqual([
      ['ui.key', { key: 'Escape' }], ['ui.key', { key: 'Mod+K' }], ['ui.key', { key: 'Mod+K' }], ['ui.key', { key: 'Alt+J' }],
    ]);
  });
  it.each(['apps', 'insights'] as const)('%s: typing still reaches the composer when a redraw dropped the focused part', async pack => {
    const { seen } = await boot(pack);
    seen.length = 0;
    expect(press(document.body, 'q').defaultPrevented).toBe(true);
    expect(effects(seen)).toEqual([expect.objectContaining({ type: 'ui.typed', payload: { grapheme: 'q' } })]);
  });
  it('apps: Space and Enter on a focused editable component select it, not type', async () => {
    const { root, seen } = await boot('apps');
    const cell = root.querySelector<HTMLElement>('.wk-cell')!;
    expect(cell.tabIndex).toBe(0);
    seen.length = 0;
    expect(press(cell, ' ').defaultPrevented).toBe(true); // the runtime selects it (its own handler), the key is not typing
    expect(effects(seen).some(m => m.type === 'ui.typed')).toBe(false);
  });
  it('insights: Tab on a summary in the middle of the tab order is native', async () => {
    const { root, seen } = await boot('insights');
    root.insertAdjacentHTML('beforeend', '<button id="first">One</button><details><summary id="mid">Why</summary></details><button id="last">Two</button>');
    seen.length = 0;
    expect(press(root.querySelector('#mid')!, 'Tab').defaultPrevented).toBe(false);
    expect(press(root.querySelector('#mid')!, 'Tab', { shiftKey: true }).defaultPrevented).toBe(false);
    expect(press(root.querySelector('#last')!, 'Tab').defaultPrevented).toBe(true);
    expect(effects(seen)).toEqual([expect.objectContaining({ type: 'ui.key', payload: { key: 'Tab' } })]);
  });
  it('apps: Escape deselects before a subsequent Escape reaches the host', async () => {
    const { root, seen } = await boot('apps');
    press(root.querySelector('.wk-cell')!, 'Enter');
    expect(root.querySelector('.is-selected')).not.toBeNull();
    seen.length = 0;
    press(root, 'Escape');
    expect(root.querySelector('.is-selected')).toBeNull();
    expect(effects(seen)).toEqual([expect.objectContaining({ type: 'selection.set', payload: { anchors: [] } })]);
    press(root, 'Escape');
    expect(seen.at(-1)).toMatchObject({ type: 'ui.key', payload: { key: 'Escape' } });
  });
  it('preserves native control typing and activation, and forwards whole printable graphemes', async () => {
    const { root, seen } = await boot('insights');
    root.insertAdjacentHTML('beforeend', '<input><textarea></textarea><select></select><div contenteditable="true"><span>Editable</span></div><button><span>Button</span></button><details><summary><span>Summary</span></summary></details><a href="#"><span>Link</span></a>');
    seen.length = 0;
    for (const control of root.querySelectorAll('input,textarea,select,[contenteditable] span')) {
      for (const key of ['x', ' ', 'Backspace', 'Delete']) expect(press(control, key).defaultPrevented).toBe(false);
    }
    for (const control of root.querySelectorAll('button span,summary span,a span')) {
      for (const key of [' ', 'Enter']) expect(press(control, key).defaultPrevented).toBe(false);
    }
    for (const [key, init] of [['x', { ctrlKey: true }], ['x', { metaKey: true }], ['x', { altKey: true }], ['ab', {}], ['\n', {}], ['Dead', {}]] as const) {
      expect(press(root, key, init).defaultPrevented).toBe(false);
    }
    expect(effects(seen)).toEqual([]);
    for (const key of ['👍🏽', 'e\u0301', ' ']) expect.soft(press(root, key).defaultPrevented).toBe(true);
    expect(effects(seen).map(m => [m.type, m.payload])).toEqual(['👍🏽', 'e\u0301', ' '].map(grapheme => ['ui.typed', { grapheme }]));
  });
});

describe('insights conformance case 14', () => {
  it('reports a positive rounded card height once the read has drawn, once per height change', async () => {
    let height = 240.6;
    const watchers: (() => void)[] = [];
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { watchers.push(cb); } observe() {} disconnect() {} });
    const measure = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      // jsdom has no layout.
      return this.tagName === 'MAIN' ? new DOMRect(0, 0, 320, height) : measure.call(this);
    });
    const resized = () => { for (const w of watchers) w(); };
    const { seen } = await boot('insights', 'style', 'card');
    const heights = () => seen.filter(m => m.type === 'ui.height');
    resized();
    expect(heights()).toEqual([expect.objectContaining({ payload: { px: 241 } })]);
    resized();
    expect(heights()).toHaveLength(1);
    height = 300.2; resized();
    expect(heights().map(m => m.payload?.['px'])).toEqual([241, 300]);
    height = 300.4; resized();
    height = 0; resized();
    expect(heights()).toHaveLength(2);
    vi.unstubAllGlobals();
  });
});

describe('video conformance case 15', () => {
  it.each(['captions', 'theme'])('publishes effective %s defaults for non-video content and refuses changes', async tab => {
    const { seen, send } = await boot('video', tab);
    for (const controlsTab of ['captions', 'theme']) {
      expect.soft(seen.filter(m => m.type === 'options.values' && m.payload?.['tab'] === controlsTab)).toEqual([
        expect.objectContaining({ payload: { tab: controlsTab, rev: 1, values: videoValues(defaultVideoStyle(''), controlsTab, null) } }),
      ]);
    }
    send('options.changed', { tab, id: tab === 'captions' ? 'on' : 'palette', value: tab === 'captions' ? false : 'corporate' }, 'change');
    await vi.waitFor(() => expect(seen.find(m => m.re === 'change')?.payload).toMatchObject({ applied: false, values: videoValues(defaultVideoStyle(''), tab, null), reason: expect.any(String) }));
    expect(seen.some(m => m.type === 'theme.set' || m.type === 'version.write')).toBe(false);
  });
});
