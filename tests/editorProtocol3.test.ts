import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorHost, type HostAdapter, type HostEvents, type HostUi } from '../src/editors/host.js';
import { negotiate, parseInbound } from '../src/editors/protocol.js';
import type { EventsBatch } from '../src/editors/runEvents.js';

/** Program DES-PLUGIN-EVENTS spike 1: protocol 3 (observe) on the editor host. */

const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id !== undefined ? { id } : {}) });
const CARD = { card: { interactive: true, aspect: 'auto', actions: [] } };

const NO_ARTIFACT: HostAdapter = {
  artifact: () => ({ kind: 'run-events', title: 'Run events', version: 0, head: 0, readonly: true, lockedParts: [] }),
  read: async () => ({ error: 'unsupported', message: 'no artifact' }),
  versions: async () => ({ error: 'unsupported', message: 'no artifact' }),
  write: vi.fn(async () => ({ error: 'refused' as const, message: 'no' })),
  undo: async () => ({ error: 'refused', message: 'no' }),
  fork: async () => ({ error: 'refused', message: 'no' }),
};

function makeHost(opts: { events?: boolean; scope?: HostEvents['scope'] } = {}) {
  const fold = vi.fn<(folded: boolean) => void>();
  const cardHeight = vi.fn<(px: number) => void>();
  const ui: HostUi = {
    chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(),
    thread: vi.fn(), fullscreen: vi.fn(async () => true), torn: vi.fn(), log: () => undefined, fold, cardHeight,
  };
  let deliver: ((b: EventsBatch) => void) | null = null;
  const unsubscribe = vi.fn();
  const events: HostEvents = { runId: 'r1', topics: ['wicked.run.unit.*'], ...(opts.scope !== undefined ? { scope: opts.scope } : {}), subscribe: (d) => { deliver = d; return unsubscribe; } };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const host = new EditorHost({
    container, src: 'about:blank', editor: 'wicked-phase-report', version: '1.0.0', name: 'Phase report', title: 'Phase report: a job',
    size: 'inline', surface: 'card', grants: [], theme: {}, prefs: { reducedMotion: false, techDetails: false, locale: 'en' },
    firstParty: true, adapter: NO_ARTIFACT, ui, activation: () => false, heightRange: { min: 28, max: 1600 },
    ...(opts.events !== false ? { events } : {}),
  });
  host.mount();
  let port: MessagePort | null = null;
  const hello: Record<string, unknown>[] = [];
  vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((m: { payload: Record<string, unknown> }, _o: unknown, tr?: Transferable[]) => {
    hello.push(m.payload);
    port = (tr?.[0] as MessagePort) ?? null;
  }) as never);
  const ready = (protocol: number[]): MessagePort => {
    window.dispatchEvent(new MessageEvent('message', {
      data: env('plugin.ready', { editor: 'wicked-phase-report', version: '1.0.0', protocol, surfaces: CARD }), source: host.frame.contentWindow,
    }));
    return port!;
  };
  return { host, ready, hello, fold, cardHeight, deliver: () => deliver, unsubscribe };
}

function listen(port: MessagePort) {
  const seen: Array<{ type?: string; re?: string; ok?: boolean; error?: { code: string }; payload?: Record<string, unknown> }> = [];
  port.onmessage = (e) => seen.push(e.data as never);
  return seen;
}
const tick = () => new Promise((r) => setTimeout(r, 10));

afterEach(() => { document.body.innerHTML = ''; });

describe('protocol 3 (observe)', () => {
  it('is negotiated by a plugin that says 3, and only then may it send ui.fold', () => {
    expect(negotiate([3])).toBe(3);
    expect(negotiate([1, 2])).toBe(2);
    expect(parseInbound(env('ui.fold', { folded: true }), 3).ok).toBe(true);
    expect(parseInbound(env('ui.fold', { folded: true }), 2).ok).toBe(false);
    expect(parseInbound(env('ui.fold', { folded: 'yes' }), 3).ok).toBe(false);
  });

  it('subscribes to events only after the handshake, and says the granted topics in host.hello', async () => {
    const h = makeHost();
    expect(h.deliver()).toBeNull();
    const port = h.ready([3]);
    const seen = listen(port);
    expect(h.hello[0]).toMatchObject({ protocol: 3, observe: { runId: 'r1', topics: ['wicked.run.unit.*'] }, grants: [] });
    h.deliver()!({ runId: 'r1', replay: true, rows: [{ id: 's1', topic: 'wicked.run.unit.started', runId: 'r1', seq: 1, at: 1, ord: 1, data: {} }] });
    await tick();
    expect(seen.find((m) => m.type === 'events.batch')?.payload).toMatchObject({ replay: true, rows: [{ id: 's1' }] });
    h.host.teardown('done');
    expect(h.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('a power run\'s phase instance is told its phase in host.hello (observe.scope); a run-level one has none', () => {
    const h = makeHost({ scope: { phase: 'review', label: 'Review', ords: [5] } });
    h.ready([3]);
    expect(h.hello[0]).toMatchObject({ observe: { runId: 'r1', scope: { phase: 'review', label: 'Review', ords: [5] } } });
    const whole = makeHost();
    whole.ready([3]);
    expect((whole.hello[0]!['observe'] as Record<string, unknown>)).not.toHaveProperty('scope');
  });

  it('a protocol-2 plugin never hears events, even with events offered', () => {
    const h = makeHost();
    h.ready([1, 2]);
    expect(h.deliver()).toBeNull();
    expect(h.hello[0]).not.toHaveProperty('observe');
  });

  it('host.fold reaches the plugin; its ui.fold reaches the host; ui.height is held to the slot’s range', async () => {
    const h = makeHost();
    const port = h.ready([3]);
    const seen = listen(port);
    h.host.setFold(false);
    await tick();
    expect(seen.find((m) => m.type === 'host.fold')?.payload).toEqual({ folded: false });
    port.postMessage(env('ui.fold', { folded: true }));
    port.postMessage(env('ui.height', { px: 30 }));
    port.postMessage(env('ui.height', { px: 9_000 }));
    await tick();
    expect(h.fold).toHaveBeenCalledWith(true);
    expect(h.cardHeight.mock.calls.map((c) => c[0])).toEqual([30, 1600]);
  });

  it('an observing plugin can call no write: every request is refused not_granted', async () => {
    const h = makeHost();
    const port = h.ready([3]);
    const seen = listen(port);
    port.postMessage(env('version.write', { base: 0, ops: [], summary: 'x' }, 'w1'));
    port.postMessage(env('artifact.read', {}, 'r1'));
    port.postMessage(env('composer.draft', { text: 'approve it', anchors: [] }, 'd1'));
    await tick();
    for (const id of ['w1', 'r1', 'd1']) expect(seen.find((m) => m.re === id), id).toMatchObject({ ok: false, error: { code: 'not_granted' } });
    expect(NO_ARTIFACT.write).not.toHaveBeenCalled();
  });
});
