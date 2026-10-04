import { describe, expect, it, vi } from 'vitest';

/**
 * EP-P3 codex r1 — the `wicked-page` plugin's keyboard entry and the peek's placement:
 *  - Tab from the editor root enters the first control (the width header) instead of leaving;
 *  - the peek of an element near the right edge stays inside the editor.
 */
const env = (type: string, payload: unknown) => ({ p: 'wicked.editor', v: 1, type, payload });
const rect = (left: number) => ({ x: left, y: 60, width: 40, height: 20, top: 60, left, right: left + 40, bottom: 80 });

describe('wicked-page: keyboard entry and the peek inside the editor', () => {
  it('Tab from the root enters the controls; a right-edge peek is clamped to the editor', async () => {
    const ready = new Promise<void>((resolve) => {
      window.addEventListener('message', (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === 'plugin.ready') resolve(); });
    });
    await import('../src/plugins/wicked-page/plugin.js');
    await ready;
    const ch = new MessageChannel();
    const seen: { type?: string; payload?: { key?: string } }[] = [];
    ch.port1.onmessage = (m: MessageEvent) => {
      const d = m.data as { type?: string; id?: string };
      seen.push(d);
      if (d.type === 'artifact.read') ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload: { version: 1, content: { type: 'html', html: '<button data-wid="b">Go</button>' } } });
    };
    window.dispatchEvent(Object.assign(new Event('message'), { data: env('host.hello', { grants: ['artifact.read', 'artifact.write'], size: 'pane', theme: {} }), ports: [ch.port2] }));
    const editor = document.getElementById('editor')!;
    await vi.waitFor(() => expect(editor.dataset['head']).toBe('1'));

    // Tab from the root (where a Tab into the frame lands) enters the first width button.
    editor.focus();
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(document.querySelector('[data-testid="page-width"]'));
    expect(seen.some((m) => m.type === 'ui.key')).toBe(false);

    // A 640 px editor, a 400 px peek, an element at x = 620: the peek stays inside.
    Object.defineProperty(editor, 'clientWidth', { configurable: true, value: 640 });
    Object.defineProperty(editor, 'clientHeight', { configurable: true, value: 480 });
    const peek = document.getElementById('peek')!;
    Object.defineProperty(peek, 'offsetWidth', { configurable: true, value: 400 });
    Object.defineProperty(peek, 'offsetHeight', { configurable: true, value: 30 });
    const frame = document.querySelector<HTMLIFrameElement>('#stage iframe')!;
    frame.dispatchEvent(new Event('load'));
    const fromPage = (data: unknown): void => { window.dispatchEvent(new MessageEvent('message', { data, source: frame.contentWindow })); };
    fromPage({ v: 1, type: 'wid-inventory', scrollX: 0, scrollY: 0, widMap: { b: rect(620) }, blocks: { b: { text: 'Go', composite: false } } });
    await vi.waitFor(() => expect(editor.dataset['pickable']).toBe('true'));
    fromPage({ v: 1, type: 'wid-click', wid: 'b' });
    expect(peek.hidden).toBe(false);
    const left = parseFloat(peek.style.left);
    expect(left + 400).toBeLessThanOrEqual(640 - 4);
    expect(left).toBeGreaterThanOrEqual(4);
    ch.port1.close();
  }, 10_000);
});
