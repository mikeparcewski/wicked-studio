import { beforeAll, describe, expect, it, vi } from 'vitest';

import { NESTED_PRELUDE } from '../src/plugins/_shared/nestedGuard.js';

/**
 * The `wicked-page` plugin's nested frame shows the page's own HTML with its scripts. The `srcdoc` it mounts is
 * guarded (`nestedGuard.ts`): the page's scripts and the `data-wid` bridge each start with the WebRTC prelude, and a
 * policy first in `<head>` lets nothing else run. The plugin is a page script: importing it runs `start()`.
 */
const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id !== undefined ? { id } : {}) });
const ch = new MessageChannel();
const PAGE = '<!doctype html><html><head><title>p</title></head><body><p data-wid="a">hello</p><script>window.chart = 1</script></body></html>';

beforeAll(async () => {
  const ready = new Promise<void>((resolve) => {
    window.addEventListener('message', (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === 'plugin.ready') resolve(); });
  });
  await import('../src/plugins/wicked-page/plugin.js');
  await ready;
  ch.port1.onmessage = (m: MessageEvent) => {
    const d = m.data as { type?: string; id?: string };
    if (d.type === 'artifact.read' && d.id !== undefined) {
      ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload: { version: 1, content: { type: 'html', html: PAGE } } });
    }
  };
  window.dispatchEvent(Object.assign(new Event('message'), { data: env('host.hello', { grants: ['artifact.read'], size: 'pane', theme: {} }), ports: [ch.port2] }));
  await vi.waitFor(() => expect(document.querySelectorAll('#stage iframe').length).toBe(1));
});

describe('wicked-page: the nested frame runs the page\'s scripts only after the WebRTC prelude', () => {
  it('the mounted srcdoc leads with the policy, and the page script and the bridge both start with the prelude', () => {
    const frame = document.querySelector<HTMLIFrameElement>('#stage iframe')!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    const doc = new DOMParser().parseFromString(frame.srcdoc, 'text/html');
    expect(doc.head.firstElementChild!.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(doc.head.firstElementChild!.getAttribute('content')).toMatch(/^script-src 'sha256-/);
    const scripts = Array.from(doc.querySelectorAll('script')).map((s) => s.textContent ?? '');
    expect(scripts.some((t) => t === `${NESTED_PRELUDE}window.chart = 1`)).toBe(true);
    expect(scripts.find((t) => t.includes('__wickedInstrumentBridge'))!.startsWith(NESTED_PRELUDE)).toBe(true);
    expect(scripts.every((t) => t.startsWith(NESTED_PRELUDE))).toBe(true);
    expect(doc.querySelector('[data-wid="a"]')!.textContent).toBe('hello');
  });
});
