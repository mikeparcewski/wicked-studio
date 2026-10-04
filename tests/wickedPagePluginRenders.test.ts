import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * EP-P2 (codex r3) — what the `wicked-page` plugin does with a head it is told about more than once, and
 * with its own version arriving late. The host may announce the same head twice (a stale reply names it
 * AND `moved` carries it; the idle refresh and a result can cross): the version on its way is never read
 * and mounted a second time, because the re-mount would throw away what the operator typed meanwhile.
 * And the words about an own version are the host's (its written line, with Undo) — the plugin's
 * `ui.status` would replace that line.
 *
 * The plugin is a page script: importing it runs `start()` against this document; the tests in this file
 * share that one instance, in order.
 */
const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id !== undefined ? { id } : {}) });

type Seen = { type?: string; id?: string; payload?: Record<string, unknown> };
const ch = new MessageChannel();
const seen: Seen[] = [];
/** The FIRST read of v3 is held back until the test releases it; every other read is answered at once. */
const held = new Map<number, string>();
let heldOnce = false;
const answer = (id: string, version: number): void => {
  ch.port1.postMessage({ p: 'wicked.editor', v: 1, re: id, ok: true, payload: { version, content: { type: 'html', html: `<p data-wid="a">v${version}</p>` } } });
};

beforeAll(async () => {
  const ready = new Promise<void>((resolve) => {
    window.addEventListener('message', (e: MessageEvent) => { if ((e.data as { type?: string } | null)?.type === 'plugin.ready') resolve(); });
  });
  await import('../src/plugins/wicked-page/plugin.js');
  await ready;
  ch.port1.onmessage = (m: MessageEvent) => {
    const d = m.data as Seen;
    seen.push(d);
    if (d.type === 'artifact.read' && d.id !== undefined) {
      const v = typeof d.payload?.['version'] === 'number' ? d.payload['version'] : 1;
      if (v === 3 && !heldOnce) { heldOnce = true; held.set(v, d.id); } else answer(d.id, v);
    }
  };
  const hello = Object.assign(new Event('message'), { data: env('host.hello', { grants: ['artifact.read', 'artifact.write'], size: 'pane', theme: {} }), ports: [ch.port2] });
  window.dispatchEvent(hello);
  await vi.waitFor(() => expect(document.querySelectorAll('#stage iframe').length).toBe(1));
});

describe('wicked-page: a head announced twice, an own version arriving late', () => {
  it('the same version announced while its render is in flight is read and mounted ONCE', async () => {
    const first = document.querySelector<HTMLIFrameElement>('#stage iframe')!;
    const readsOf3 = (): number => seen.filter((m) => m.type === 'artifact.read' && m.payload?.['version'] === 3).length;
    ch.port1.postMessage(env('artifact.changed', { version: 3, head: 3, by: 'agent', kind: 'generated' }));
    await vi.waitFor(() => expect(held.has(3)).toBe(true)); // the read for v3 is on its way, held
    // The same head again — a stale reply's `moved`, or the idle refresh crossing the result.
    ch.port1.postMessage(env('artifact.changed', { version: 3, head: 3, by: 'agent', kind: 'generated' }));
    await new Promise((r) => setTimeout(r, 60));
    answer(held.get(3)!, 3);
    held.delete(3);
    await vi.waitFor(() => expect(document.querySelector('#stage iframe')).not.toBe(first));
    await new Promise((r) => setTimeout(r, 300)); // a queued second render would have asked again by now
    expect(readsOf3()).toBe(1);
    expect(document.querySelectorAll('#stage iframe').length).toBe(1);
  }, 10_000);

  it('an own version arriving as artifact.changed is rendered with NO ui.status — the host’s written line (with Undo) owns the words', async () => {
    const before = seen.length;
    const current = document.querySelector<HTMLIFrameElement>('#stage iframe')!;
    ch.port1.postMessage(env('artifact.changed', { version: 4, head: 4, by: 'this-editor', kind: 'deterministic' }));
    await vi.waitFor(() => expect(document.querySelector('#stage iframe')).not.toBe(current));
    await new Promise((r) => setTimeout(r, 60));
    const statuses = seen.slice(before).filter((m) => m.type === 'ui.status').map((m) => m.payload?.['line']);
    expect(statuses).toEqual([]);
  }, 10_000);
});
