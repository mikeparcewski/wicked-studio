import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiBase } from '../src/api/client.js';
import { EditorHostPage } from '../src/components/editors/EditorHostPage.js';

const SHA = 'a'.repeat(64);
const topic = 'wicked.run.unit.started';
const samples = [
  { type: 'unitExecuting', ord: 1 }, { type: 'cliUsage', ord: 1 },
  { type: 'unitExecuting', ord: 2 }, { type: 'unitExecuting', ord: 3 },
].map((e, i) => ({ ...e, session: 'conformance-run', seq: i + 1, ts: 1 }));
const ports: MessagePort[] = [];
function setup(events = samples, query = ''): void {
  window.history.replaceState(null, '', `/editors/conformance?plugin=acme-cost&version=1.0.0&sha=${SHA}&observe=${topic}&samples=/samples.ndjson${query}`);
  vi.stubGlobal('fetch', vi.fn(async (input: unknown) => String(input).endsWith('/samples.ndjson')
    ? new Response(events.map((e) => JSON.stringify(e)).join('\n'))
    : new Response(JSON.stringify({ editors: [{ id: 'acme-cost', title: 'Cost', version: '1.0.0', sha256: SHA,
      protocol: [3], kinds: [], sizes: [], permissions: [], enabled: true, first_party: false,
      inline: 'run-thread', run_panels: [{ slot: 'run.details', id: 'cost', title: 'Cost', order: 1 }] }] }))));
}
function handshake(protocol = [3]): { hello: Record<string, unknown>[]; batches: Array<{ type: string; payload: { rows: Array<{ id: string }> } }> } {
  const frame = screen.getByTestId('editor-frame') as HTMLIFrameElement;
  const hello: Record<string, unknown>[] = [];
  const batches: Array<{ type: string; payload: { rows: Array<{ id: string }> } }> = [];
  vi.spyOn(frame.contentWindow!, 'postMessage').mockImplementation(((msg: { payload: Record<string, unknown> }, _origin: unknown, transfer?: Transferable[]) => {
    hello.push(msg.payload);
    const port = transfer?.[0] as MessagePort;
    ports.push(port);
    port.onmessage = (event) => batches.push(event.data as never);
  }) as never);
  act(() => window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow,
    data: { p: 'wicked.editor', v: 1, type: 'plugin.ready', payload: { editor: 'acme-cost', version: '1.0.0', protocol,
      surfaces: { card: { interactive: true, aspect: 'auto', actions: [] } } } } })));
  return { hello, batches };
}

afterEach(() => { cleanup(); for (const p of ports.splice(0)) p.close(); vi.unstubAllGlobals(); window.history.replaceState(null, '', '/'); });

describe('the run-plugin conformance host', () => {
  it('exposes the contracted controls, uses the pinned route and real protocol 3 feed; remount replays once', async () => {
    setup();
    render(<EditorHostPage mode="conformance" />);
    await screen.findByTestId('editor-frame');
    const controls = window.__wickedRunPlugin!;
    expect(controls.host()).toEqual({ alive: true, negotiated: null });
    expect(controls.feed()).toEqual({ history: 2, held: 2, emitted: 0 });
    expect(screen.getByTestId('editor-frame')).toHaveAttribute('src', `${apiBase()}/editors/acme-cost/1.0.0/entry?sha=${SHA}`);
    expect(screen.getByTestId('editor-frame')).toHaveAttribute('sandbox', 'allow-scripts');
    const first = handshake();
    expect(first.hello[0]).toMatchObject({ protocol: 3, grants: [], observe: { runId: 'conformance-run', topics: [topic], panel: { slot: 'run.details', id: 'cost' } } });
    await waitFor(() => expect(controls.delivered).toHaveLength(1));
    expect(controls.host()).toEqual({ alive: true, negotiated: 3 });
    expect(controls.delivered[0]).toEqual({ mount: 1, replay: true, rows: [{ id: 's1', topic }] });
    act(() => { expect(controls.emit(1)).toBe(1); });
    expect(controls.feed()).toEqual({ history: 3, held: 1, emitted: 1 });
    await waitFor(() => expect(first.batches.filter((b) => b.type === 'events.batch')).toHaveLength(2));
    const old = screen.getByTestId('editor-frame');
    act(() => controls.remount());
    expect(screen.getByTestId('editor-frame')).not.toBe(old);
    const second = handshake();
    await waitFor(() => expect(controls.delivered.filter((b) => b.mount === 2)).toHaveLength(1));
    expect(controls.delivered.filter((b) => b.mount === 2)).toEqual([{ mount: 2, replay: true, rows: [{ id: 's1', topic }, { id: 's3', topic }] }]);
    act(() => { expect(controls.emit()).toBe(1); expect(controls.emit()).toBe(0); });
    await waitFor(() => expect(second.batches.filter((b) => b.type === 'events.batch')).toHaveLength(2));
    for (const mount of [1, 2]) {
      const rows = controls.delivered.filter((b) => b.mount === mount).flatMap((b) => b.rows);
      expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
      expect(rows.every((r) => r.topic === topic)).toBe(true);
      expect(controls.delivered.filter((b) => b.mount === mount).some((b) => b.gap !== undefined)).toBe(false);
    }
    expect(controls.log.filter((l) => l.kind === 'handshake')).toHaveLength(2);
    cleanup();
    expect(window.__wickedRunPlugin).toBeUndefined();
  });

  it('can mount the standalone harness entry before it is listed in the registry', async () => {
    setup();
    vi.stubGlobal('fetch', vi.fn(async (input: unknown) => String(input).endsWith('/samples.ndjson')
      ? new Response(samples.map((e) => JSON.stringify(e)).join('\n')) : Promise.reject(new Error('Registry unavailable'))));
    render(<EditorHostPage mode="conformance" />);
    await screen.findByTestId('editor-frame');
    expect(handshake().hello[0]).toMatchObject({ observe: { panel: { slot: 'run.details', id: 'main' } } });
  });

  it('includes events emitted before the handshake and rounds an odd history up', async () => {
    setup(samples.slice(0, 3));
    render(<EditorHostPage mode="conformance" />);
    await screen.findByTestId('editor-frame');
    expect(window.__wickedRunPlugin!.feed()).toEqual({ history: 2, held: 1, emitted: 0 });
    act(() => { expect(window.__wickedRunPlugin!.emit(-2)).toBe(0); expect(window.__wickedRunPlugin!.emit()).toBe(1); });
    handshake();
    await waitFor(() => expect(window.__wickedRunPlugin!.delivered[0]?.rows).toHaveLength(2));
  });

  it('an empty grant set still handshakes, delivers no topics and cannot fall back to protocol 2', async () => {
    setup(samples);
    // The only granted pattern is not a run topic: the page drops it, so nothing is granted.
    window.history.replaceState(null, '', window.location.href.replace(`observe=${topic}`, 'observe=wicked.bus.x'));
    render(<EditorHostPage mode="conformance" />);
    await screen.findByTestId('editor-frame');
    expect(handshake().hello[0]).toMatchObject({ observe: { topics: [] } });
    await waitFor(() => expect(window.__wickedRunPlugin!.delivered[0]?.rows).toEqual([]));
    act(() => window.__wickedRunPlugin!.remount());
    handshake([1, 2]);
    await waitFor(() => expect(window.__wickedRunPlugin!.host()?.alive).toBe(false));
  });

  it.each(['&samples=https://elsewhere.test/events', '&sha=wrong'])('refuses invalid host input %s', async (query) => {
    setup();
    const q = new URL(window.location.href);
    const [key, value] = query.slice(1).split('=');
    q.searchParams.set(key!, value!);
    window.history.replaceState(null, '', q);
    render(<EditorHostPage mode="conformance" />);
    await screen.findByRole('alert');
    act(() => window.__wickedRunPlugin!.remount());
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(window.__wickedRunPlugin!.host()).toBeNull();
    expect(screen.queryByTestId('editor-frame')).toBeNull();
  });

  it('refuses sample rows for another run or with duplicate sequence numbers', async () => {
    setup([samples[0]!, samples[0]!]);
    render(<EditorHostPage mode="conformance" />);
    await screen.findByRole('alert');
    expect(screen.queryByTestId('editor-frame')).toBeNull();
    cleanup();
    setup([{ ...samples[0]!, session: 'other-run' }]);
    render(<EditorHostPage mode="conformance" />);
    await screen.findByRole('alert');
    expect(screen.queryByTestId('editor-frame')).toBeNull();
  });
});
