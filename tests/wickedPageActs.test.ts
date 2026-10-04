import { describe, expect, it, vi } from 'vitest';

/**
 * EP-P3 — the `wicked-page` plugin's acts (DES-EDITOR-PLUGINS-001 §7.1 R-a…R-d), through the real
 * plugin script against this document: the picked element's peek (Remove, the page's own colours,
 * the whole section), ⌘⌫ and ⌥↑, a second click, the width header, and the Tab ring (§5.10 rule 5).
 * Bare Backspace never removes.
 */
const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id !== undefined ? { id } : {}) });
const RECT = { x: 10, y: 10, width: 100, height: 20, top: 10, left: 10, right: 110, bottom: 30 };

const PAGE = (v: number): string => `<html><head><style>:root{--wi-bg:#f4f1ea;--wi-primary:#1f3a5f;--wi-text:#1b1b1b}</style></head><body>
<section data-wid="section-0"><h2 data-wid="h">Hi ${v}</h2><p data-wid="p">x</p></section></body></html>`;

describe('wicked-page: act-first remove, restyle, section, widths', () => {
  it('runs every act through the host, one version each; bare Backspace removes nothing', async () => {
    const ready = new Promise<void>((resolve) => {
      window.addEventListener('message', (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === 'plugin.ready') resolve(); });
    });
    await import('../src/plugins/wicked-page/plugin.js');
    await ready;

    const ch = new MessageChannel();
    const seen: { type?: string; id?: string; payload?: Record<string, unknown> }[] = [];
    let version = 1;
    ch.port1.onmessage = (m: MessageEvent) => {
      const d = m.data as { type?: string; id?: string; payload?: Record<string, unknown> };
      seen.push(d);
      if (d.type === 'artifact.read') {
        const v = typeof d.payload?.['version'] === 'number' ? d.payload['version'] : version;
        ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload: { version: v, content: { type: 'html', html: PAGE(v) } } });
      } else if (d.type === 'version.write') {
        version += 1;
        ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload: { version } });
      }
    };
    window.dispatchEvent(Object.assign(new Event('message'), { data: env('host.hello', { grants: ['artifact.read', 'artifact.write', 'selection.chip'], size: 'pane', theme: {} }), ports: [ch.port2] }));

    const editor = (): HTMLElement => document.getElementById('editor')!;
    const frame = (): HTMLIFrameElement => document.querySelector<HTMLIFrameElement>('#stage iframe')!;
    const fromPage = (data: unknown): void => { window.dispatchEvent(new MessageEvent('message', { data, source: frame().contentWindow })); };
    const loaded = async (v: number): Promise<void> => {
      await vi.waitFor(() => expect(editor().dataset['head']).toBe(String(v)));
      frame().dispatchEvent(new Event('load'));
      fromPage({
        v: 1, type: 'wid-inventory', scrollX: 0, scrollY: 0, widMap: { 'section-0': RECT, h: RECT, p: RECT },
        blocks: { 'section-0': { text: `Hi ${v} x`, composite: true }, h: { text: `Hi ${v}`, composite: false, section: 'section-0' }, p: { text: 'x', composite: false, section: 'section-0' } },
      });
      await vi.waitFor(() => expect(editor().dataset['pickable']).toBe('true'));
    };
    const key = (k: string, mods: Partial<KeyboardEventInit> = {}): void => {
      (document.activeElement ?? editor()).dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...mods }));
    };
    const writes = (): Record<string, unknown>[] => seen.filter((m) => m.type === 'version.write').map((m) => m.payload!);

    await loaded(1);

    // R-b: the swatches are the page's own theme colours, then Default.
    const fill = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-testid="page-swatch"][data-prop="background"]')).map((b) => b.dataset['value']);
    expect(fill).toStrictEqual(['#f4f1ea', '#1f3a5f', '#1b1b1b', 'revert-layer']);

    // A pick shows the peek, with "Whole section" since the heading sits in one.
    fromPage({ v: 1, type: 'wid-click', wid: 'h' });
    expect(editor().dataset['selected']).toBe('h');
    expect(document.getElementById('peek')!.hidden).toBe(false);
    expect(document.getElementById('to-section')!.hidden).toBe(false);

    // R-c: ⌥↑ picks the section.
    key('ArrowUp', { altKey: true });
    expect(editor().dataset['selected']).toBe('section-0');

    // A second click on the picked element picks its section too.
    fromPage({ v: 1, type: 'wid-click', wid: 'p' });
    fromPage({ v: 1, type: 'wid-click', wid: 'p' });
    expect(editor().dataset['selected']).toBe('section-0');

    // R-a: bare Backspace never removes; ⌘⌫ removes — one write, then the next version.
    fromPage({ v: 1, type: 'wid-click', wid: 'p' });
    key('Backspace');
    key('Delete');
    expect(writes()).toHaveLength(0);
    key('Backspace', { metaKey: true });
    await vi.waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ base: 1, ops: [{ op: 'remove', anchor: 'p' }] });
    await loaded(2);

    // R-b: a swatch is one style write with the concrete colour; Default sends revert-layer.
    fromPage({ v: 1, type: 'wid-click', wid: 'h' });
    document.querySelector<HTMLButtonElement>('[data-testid="page-swatch"][data-prop="background"][data-value="#1f3a5f"]')!.click();
    await vi.waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toMatchObject({ base: 2, ops: [{ op: 'style', anchor: 'h', style: { background: '#1f3a5f' } }] });
    await loaded(3);
    fromPage({ v: 1, type: 'wid-click', wid: 'h' });
    document.querySelector<HTMLButtonElement>('[data-testid="page-swatch"][data-prop="color"][data-value="revert-layer"]')!.click();
    await vi.waitFor(() => expect(writes()).toHaveLength(3));
    expect(writes()[2]).toMatchObject({ ops: [{ op: 'style', anchor: 'h', style: { color: 'revert-layer' } }] });
    await loaded(4);

    // The Remove button is the same act as ⌘⌫.
    fromPage({ v: 1, type: 'wid-click', wid: 'h' });
    document.querySelector<HTMLButtonElement>('[data-testid="page-remove"]')!.click();
    await vi.waitFor(() => expect(writes()).toHaveLength(4));
    expect(writes()[3]).toMatchObject({ ops: [{ op: 'remove', anchor: 'h' }] });
    await loaded(5);

    // R-d: a width is the nested frame's width; the pressed one again lets the page fill the editor.
    const phone = document.querySelector<HTMLButtonElement>('[data-testid="page-width"][data-width="390"]')!;
    phone.click();
    expect(editor().dataset['width']).toBe('390');
    expect(phone.getAttribute('aria-pressed')).toBe('true');
    expect(frame().style.width).toBe('390px');
    phone.click();
    expect(editor().dataset['width']).toBe('');
    expect(frame().style.width).toBe('');

    // §5.10 rule 5: Tab moves through the plugin's own controls; past the last one it returns to the host.
    fromPage({ v: 1, type: 'wid-click', wid: 'h' });
    const handle = document.getElementById('handle')!;
    expect(document.activeElement).toBe(handle);
    key('Tab');
    expect(document.activeElement).toBe(document.getElementById('to-section'));
    const last = Array.from(document.querySelectorAll<HTMLButtonElement>('#peek button')).at(-1)!;
    last.focus();
    key('Tab');
    await vi.waitFor(() => expect(seen.some((m) => m.type === 'ui.key' && (m.payload as { key?: string } | undefined)?.key === 'Tab')).toBe(true));
    ch.port1.close();
  }, 15_000);
});
