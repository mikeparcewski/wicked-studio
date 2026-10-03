import { describe, expect, it, vi } from 'vitest';

/**
 * EP-P2 — the `wicked-page` plugin's nested frame (DES-EDITOR-PLUGINS-001 §7.1). Every version gets a
 * NEW frame element: a message is accepted only from the current element's own window, and a load that
 * finishes late on a previous element asks that document nothing (codex r1: the generation guard was
 * not bound to the document that loaded, so a stale load re-armed the new generation).
 *
 * The plugin is a page script: importing it runs `start()` against this document.
 */
const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id !== undefined ? { id } : {}) });

describe('wicked-page: one nested frame element per version', () => {
  it('a new version mounts a NEW frame and removes the old; a late load of the old one asks the new one nothing', async () => {
    const ready = new Promise<void>((resolve) => {
      window.addEventListener('message', (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === 'plugin.ready') resolve(); });
    });
    await import('../src/plugins/wicked-page/plugin.js');
    await ready;

    const ch = new MessageChannel();
    const seen: { type?: string; id?: string }[] = [];
    ch.port1.onmessage = (m: MessageEvent) => {
      const d = m.data as { type?: string; id?: string; payload?: { version?: number } };
      seen.push(d);
      if (d.type === 'artifact.read') {
        ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: d.id, ok: true, payload: { version: d.payload?.version ?? 1, content: { type: 'html', html: '<p data-wid="a">x</p>' } } });
      }
    };
    // host.hello hands the port (jsdom's MessageEvent takes the ports as own fields).
    const hello = Object.assign(new Event('message'), { data: env('host.hello', { grants: ['artifact.read'], size: 'pane', theme: {} }), ports: [ch.port2] });
    window.dispatchEvent(hello);

    await vi.waitFor(() => expect(document.querySelectorAll('#stage iframe').length).toBe(1));
    const first = document.querySelector<HTMLIFrameElement>('#stage iframe')!;
    expect(first.getAttribute('data-testid')).toBe('page-frame');
    expect(first.getAttribute('sandbox')).toBe('allow-scripts');

    ch.port1.postMessage(env('artifact.changed', { version: 2, head: 2, by: 'other', kind: 'generated' }));
    await vi.waitFor(() => expect(document.querySelector('#stage iframe')).not.toBe(first));
    const second = document.querySelector<HTMLIFrameElement>('#stage iframe')!;
    expect(document.querySelectorAll('#stage iframe').length).toBe(1);
    expect(first.isConnected).toBe(false);
    expect(second.contentWindow).not.toBeNull();

    // Let the second frame's own (legitimate) inventory asks run out, then watch its window.
    await new Promise((r) => setTimeout(r, 1700));
    const asked = vi.spyOn(second.contentWindow!, 'postMessage');
    first.dispatchEvent(new Event('load'));
    await new Promise((r) => setTimeout(r, 120));
    expect(asked).not.toHaveBeenCalled();
    second.dispatchEvent(new Event('load'));
    await vi.waitFor(() => expect(asked).toHaveBeenCalled());
    expect(seen.filter((m) => m.type === 'artifact.read').length).toBe(2);
    ch.port1.close();
  }, 10_000);
});
