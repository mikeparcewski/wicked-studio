import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorHost, type HostLogEntry, type HostUi } from '../src/editors/host.js';
import { FakeDocAdapter } from '../src/editors/fakeAdapter.js';
import { negotiate, parseInbound, parseReady, type PermissionId } from '../src/editors/protocol.js';
import {
  canonicalSurfaces, clampCardHeight, controlValueOk, parseSurfaces, sameSurfaces, usesDecisionWord, v1Surfaces, valuesOk,
  type Surfaces,
} from '../src/editors/surfaces.js';

/** DES-EDITOR-PLUGIN-CONTRACT-001: protocol 2, the surfaces declaration and the host's side of it. */

const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id !== undefined ? { id } : {}) });

const DECL = {
  card: { interactive: true, aspect: 'auto', actions: [{ id: 'next', label: 'Next chapter', verb: 'plugin' }, { id: 'export', label: 'Export', verb: 'host:export' }] },
  options: {
    tabs: [
      { id: 'chapters', label: 'Chapters', render: 'plugin' },
      {
        id: 'captions', label: 'Captions', render: 'controls', controls: [
          { id: 'show', label: 'Show', type: 'toggle' },
          { id: 'where', label: 'Where', type: 'segmented', options: [{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }] },
          { id: 'width', label: 'Wrap width', type: 'range', min: 40, max: 90, step: 2 },
          { id: 'colour', label: 'Band', type: 'color' },
          { id: 'title', label: 'Title', type: 'text', maxChars: 40 },
        ],
      },
    ],
  },
  full: { modes: ['simple', 'advanced'], default: 'simple' },
};

const ok = (raw: unknown): Surfaces => {
  const r = parseSurfaces(raw);
  if (!r.ok) throw new Error(r.reason);
  return r.value;
};
const reason = (raw: unknown): string => {
  const r = parseSurfaces(raw);
  return r.ok ? '' : r.reason;
};
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('the surfaces declaration (§5)', () => {
  it('parses a full declaration and fills the defaults', () => {
    const s = ok(DECL);
    expect(s.card).toMatchObject({ interactive: true, aspect: 'auto' });
    expect(s.card.actions.map((a) => a.id)).toEqual(['next', 'export']);
    expect(s.options?.tabs.map((t) => t.render)).toEqual(['plugin', 'controls']);
    expect(s.full).toEqual({ modes: ['simple', 'advanced'], default: 'simple' });
    expect(ok({ card: {} })).toEqual({ card: { interactive: false, aspect: '16:9', actions: [] }, options: null, full: null });
  });

  it('refuses labels with the host’s decision words, look-alikes and suffixes included, but not words that only contain one', () => {
    for (const label of ['Approve', 'approved', 'ApproveAll', 'Аpprove', 'İnstall', 'Ａpprove', 'Send it', 'Delete slide', 'De1ete', 'Install', 'Stop']) {
      expect(usesDecisionWord(label), label).toBe(true);
    }
    for (const label of ['Shallow', 'Next chapter', 'Play', 'Captions', 'Godsend']) expect(usesDecisionWord(label), label).toBe(false);
    const d = clone(DECL);
    d.card.actions[0]!.label = 'Approve slide';
    expect(reason(d)).toMatch(/only the host's own controls/u);
    // codex h1-r2: any non-ASCII letter is refused outright, so no look-alike spelling reaches the chrome.
    for (const label of ['1nstall', 'De1iver']) {
      const x = clone(DECL); x.card.actions[0]!.label = label;
      expect(reason(x), label).toMatch(/letters or digits/u);
    }
    for (const label of ['ınstall', 'Аpprove', 'İnstall', 'Ａpprove', 'Café']) {
      const x = clone(DECL); x.card.actions[0]!.label = label;
      expect(reason(x), label).toMatch(/plain characters/u);
    }
    // A trailing newline is not part of an id (JS \$ is the end of input).
    const nl = clone(DECL); nl.options.tabs[0]!.id = 'chapters\n';
    expect(reason(nl)).toMatch(/bad id/u);
  });

  it('refuses duplicates in each routing scope, unknown fields and out-of-bounds controls', () => {
    const a = clone(DECL); a.card.actions[1]!.id = 'next';
    expect(reason(a)).toMatch(/used twice/u);
    const t = clone(DECL); t.options.tabs[1]!.id = 'chapters';
    expect(reason(t)).toMatch(/used twice/u);
    const c = clone(DECL); (c.options.tabs[1]!.controls as Array<{ id: string }>)[1]!.id = 'show';
    expect(reason(c)).toMatch(/used twice/u);
    expect(reason({ card: { extra: 1 } })).toMatch(/unknown field/u);
    expect(reason({ card: { interactive: null } })).toMatch(/boolean/u);
    expect(reason({ card: { actions: null } })).toMatch(/at most 4/u);
    const r1 = clone(DECL); (r1.options.tabs[1]!.controls as Array<Record<string, unknown>>)[2]!['min'] = 95;
    expect(reason(r1)).toMatch(/min < max/u);
    const r2 = clone(DECL); (r2.options.tabs[1]!.controls as Array<Record<string, unknown>>)[2]!['step'] = 0;
    expect(reason(r2)).toMatch(/step/u);
    const seg = clone(DECL); (seg.options.tabs[1]!.controls as Array<Record<string, unknown>>)[1]!['options'] = [{ id: 'top', label: 'Top' }];
    expect(reason(seg)).toMatch(/2 to 8 options/u);
    const huge = clone(DECL); Object.assign((huge.options.tabs[1]!.controls as Array<Record<string, unknown>>)[2]!, { min: -1e308, max: 1e308, step: 1e308 });
    expect(reason(huge)).toMatch(/within ±1e9/u);
    const fine = clone(DECL); Object.assign((fine.options.tabs[1]!.controls as Array<Record<string, unknown>>)[2]!, { min: 999999999, max: 1000000000, step: 1e-6 });
    expect(reason(fine)).toMatch(/too fine/u);
    expect(reason({ card: { actions: [1, 2, 3, 4, 5].map((i) => ({ id: `a${i}`, label: `A ${i}`, verb: 'plugin' })) } })).toMatch(/at most 4/u);
    expect(reason({ card: { actions: [{ id: 'x', label: 'X', verb: 'host:approve' }] } })).toMatch(/verb/u);
  });

  it('accepts exactly the two modes, with a default among them', () => {
    expect(reason({ card: {}, full: { modes: ['advanced', 'simple'] } })).toMatch(/exactly/u);
    expect(reason({ card: {}, full: { modes: ['simple', 'advanced'], default: 'expert' } })).toMatch(/default/u);
    expect(reason({ card: {}, full: { default: 'advanced' } })).toMatch(/needs modes/u);
    expect(ok({ card: {}, full: {} }).full).toEqual({ modes: null, default: 'simple' });
  });

  it('compares canonically: key order and filled defaults do not make two declarations differ', () => {
    const a = ok(DECL);
    const reordered = { full: DECL.full, options: DECL.options, card: { actions: DECL.card.actions, aspect: 'auto', interactive: true } };
    expect(sameSurfaces(a, ok(reordered))).toBe(true);
    const b = clone(DECL); b.card.actions[0]!.label = 'Next';
    expect(sameSurfaces(a, ok(b))).toBe(false);
    expect(canonicalSurfaces(ok({ card: {} }))).toBe(canonicalSurfaces(ok({ card: { interactive: false, aspect: '16:9', actions: [] } })));
  });

  it('checks control values by type, and whole snapshots by their tab', () => {
    const tab = ok(DECL).options!.tabs[1]!;
    const [show, where, width, colour, title] = tab.controls!;
    expect(controlValueOk(show!, true)).toBe(true);
    expect(controlValueOk(show!, 'yes')).toBe(false);
    expect(controlValueOk(where!, 'top')).toBe(true);
    expect(controlValueOk(where!, 'left')).toBe(false);
    expect(controlValueOk(width!, 64)).toBe(true);
    expect(controlValueOk(width!, 65)).toBe(false); // off the step grid
    expect(controlValueOk(width!, 100)).toBe(false);
    const big = ok({ card: {}, options: { tabs: [{ id: 't', label: 'T', render: 'controls', controls: [{ id: 'r', label: 'R', type: 'range', min: 999999999, max: 1000000000, step: 0.1 }] }] } });
    expect(controlValueOk(big.options!.tabs[0]!.controls![0]!, 999999999.1)).toBe(true);
    expect(controlValueOk(big.options!.tabs[0]!.controls![0]!, 999999999.15)).toBe(false);
    expect(controlValueOk(big.options!.tabs[0]!.controls![0]!, 999999999 + 0.1 * 7)).toBe(true);
    expect(controlValueOk(colour!, '#1a1a1b')).toBe(true);
    expect(controlValueOk(colour!, 'red;}body{')).toBe(false);
    expect(controlValueOk(colour!, 'rgb(.,.,.)')).toBe(false);
    expect(controlValueOk(colour!, 'rgb(10, 20, 30)')).toBe(true);
    expect(controlValueOk(title!, 'x'.repeat(41))).toBe(false);
    expect(valuesOk(tab, { show: true, where: 'bottom' })).toBe(true);
    expect(valuesOk(tab, { show: true, nope: 1 })).toBe(false);
  });

  it('maps a protocol-1 plugin’s sizes, and clamps an auto card', () => {
    expect(v1Surfaces(['inline', 'pane', 'full'])).toEqual({
      card: { interactive: false, aspect: '16:9', actions: [] },
      options: { tabs: [{ id: 'editor', label: 'Editor', render: 'plugin' }] },
      full: { modes: null, default: 'simple' },
    });
    expect(v1Surfaces(['inline'])).toMatchObject({ options: null, full: null });
    expect(clampCardHeight(40)).toBe(120);
    expect(clampCardHeight(9000)).toBe(560);
  });
});

describe('protocol negotiation and the v2-only messages', () => {
  it('picks the highest common protocol', () => {
    expect(negotiate([1])).toBe(1);
    expect(negotiate([1, 2])).toBe(2);
    expect(negotiate([2])).toBe(2);
    expect(negotiate([3])).toBeNull();
  });

  it('refuses v2-only types on a v1 port, and parses them on a v2 one', () => {
    const m = env('theme.set', { base: 1, tokens: {} }, 't1');
    expect(parseInbound(m, 1)).toMatchObject({ ok: false, id: 't1' });
    expect(parseInbound(m, 2)).toMatchObject({ ok: true });
    expect(parseInbound(env('ui.height', { px: 300 }), 1).ok).toBe(false);
    expect(parseInbound(env('ui.height', { px: 300 }), 2).ok).toBe(true);
    expect(parseInbound(env('ui.morph', { to: 'card' }), 1).ok).toBe(false);
    expect(parseInbound(env('ui.morph', { to: 'card' }), 2).ok).toBe(true);
    expect(parseInbound(env('options.values', { tab: 'captions', rev: -1, values: {} }), 2).ok).toBe(false);
  });

  it('reads the surfaces off plugin.ready', () => {
    expect(parseReady(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1, 2], surfaces: DECL }))?.surfaces).toEqual(DECL);
    expect(parseReady(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }))).not.toHaveProperty('surfaces');
  });
});

// ── the host's side ───────────────────────────────────────────────────────────────────────

function makeHost(opts: { grants?: PermissionId[]; declared?: unknown; surface?: 'card' | 'options' | 'full' } = {}) {
  const log: HostLogEntry[] = [];
  const spies = {
    surfaces: vi.fn<(s: Surfaces, protocol: number, note: string | null) => void>(),
    optionsValues: vi.fn<(tab: string, values: Record<string, unknown>) => void>(),
    cardHeight: vi.fn<(px: number) => void>(),
    selected: vi.fn<(anchors: unknown[]) => void>(),
    torn: vi.fn<(reason: string) => void>(),
  };
  const ui: HostUi = {
    chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(),
    thread: vi.fn(), fullscreen: vi.fn(async () => true), torn: spies.torn, log: (e) => log.push(e),
    surfaces: spies.surfaces, optionsValues: spies.optionsValues, cardHeight: spies.cardHeight, selected: spies.selected,
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const adapter = new FakeDocAdapter();
  const host = new EditorHost({
    container, src: 'about:blank', editor: 'acme', version: '0.1.0', name: 'Acme', title: 'Acme: a page', size: 'inline',
    grants: opts.grants ?? ['artifact.read', 'selection.chip'], theme: {}, prefs: { reducedMotion: false, techDetails: false, locale: 'en' },
    firstParty: false, adapter, ui, activation: () => false,
    ...(opts.surface !== undefined ? { surface: opts.surface } : {}),
    ...(opts.declared !== undefined ? { declared: opts.declared } : {}),
  });
  host.mount();
  let port: MessagePort | null = null;
  const hello: Record<string, unknown>[] = [];
  vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((m: { type: string; payload: Record<string, unknown> }, _o: unknown, tr?: Transferable[]) => {
    hello.push(m.payload);
    port = (tr?.[0] as MessagePort) ?? null;
  }) as never);
  const ready = (protocol: number[], surfaces?: unknown): MessagePort => {
    window.dispatchEvent(new MessageEvent('message', {
      data: env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol, ...(surfaces !== undefined ? { surfaces } : {}) }),
      source: host.frame.contentWindow,
    }));
    return port!;
  };
  return { host, ui: spies, log, adapter, ready, hello };
}

/** Collect what the host posts on the port, and answer its requests with `answer`. */
function plugin(port: MessagePort, answer: (m: { type: string; id: string; payload: Record<string, unknown> }) => unknown = () => ({})) {
  const seen: Array<{ type?: string; id?: string; re?: string; payload?: Record<string, unknown> }> = [];
  port.onmessage = (e) => {
    const m = e.data as { type?: string; id?: string; payload?: Record<string, unknown> };
    seen.push(m);
    if (typeof m.id === 'string' && typeof m.type === 'string' && m.type !== 'host.ping') {
      const r = answer(m as { type: string; id: string; payload: Record<string, unknown> });
      if (r !== undefined) port.postMessage({ p: 'wicked.editor', v: 1, re: m.id, ok: true, payload: r });
    }
  };
  return seen;
}

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

describe('the host, protocol 2', () => {
  it('negotiates 2, says the surface in host.hello and hands the surfaces to the UI', () => {
    const { host, ui, ready, hello } = makeHost({ surface: 'card' });
    ready([1, 2], DECL);
    expect(host.negotiated).toBe(2);
    expect(hello[0]).toMatchObject({ protocol: 2, surface: 'card', size: 'inline' });
    expect(ui.surfaces).toHaveBeenCalledWith(ok(DECL), 2, null);
    host.teardown('done');
  });

  it('a full instance with modes is told its mode', () => {
    const { host, ready, hello } = makeHost({ surface: 'full' });
    ready([2], DECL);
    expect(hello[0]).toMatchObject({ surface: 'full', mode: 'simple' });
    host.teardown('done');
  });

  it('falls back to the v1 mapping, and says why, when the surfaces are refused or differ from the registry', () => {
    const bad = makeHost();
    bad.ready([1, 2], { card: { actions: [{ id: 'a', label: 'Approve', verb: 'plugin' }] } });
    expect(bad.host.negotiated).toBe(1);
    expect(bad.ui.surfaces.mock.calls[0]![2]).toMatch(/refused/u);
    bad.host.teardown('done');
    const other = makeHost({ declared: { card: {} } });
    other.ready([1, 2], DECL);
    expect(other.host.negotiated).toBe(1);
    expect(other.ui.surfaces.mock.calls[0]![2]).toMatch(/other surfaces than its manifest/u);
    other.host.teardown('done');
  });

  it('a protocol-2-only plugin whose surfaces are refused does not start', () => {
    const { host, ui, ready } = makeHost();
    ready([2], { card: { nope: true } });
    expect(host.alive).toBe(false);
    expect(ui.torn).toHaveBeenCalled();
  });

  it('a declared plugin action reaches the plugin and its answer comes back; an undeclared one never leaves', async () => {
    const { host, ready } = makeHost();
    const seen = plugin(ready([2], DECL), (m) => (m.type === 'host.action' ? { handled: true, status: 'Chapter 3\nnext' } : undefined));
    await expect(host.action('next')).resolves.toEqual({ handled: true, status: 'Chapter 3 next' });
    await expect(host.action('export')).resolves.toBeNull(); // a host verb, not the plugin's
    await expect(host.action('nope')).resolves.toBeNull();
    expect(seen.filter((m) => m.type === 'host.action').map((m) => m.payload)).toEqual([{ id: 'next' }]);
    host.teardown('done');
  });

  it('host.action grants no activation: a tools/call right after it is refused for want of a click in the frame', async () => {
    const { host, ready } = makeHost({ grants: ['mcp.session'] });
    const port = ready([2], DECL);
    const replies: Array<{ re?: string; ok?: boolean; error?: { code: string } }> = [];
    port.onmessage = (e) => {
      const m = e.data as { type?: string; id?: string };
      if (m.type === 'host.action') {
        port.postMessage(env('mcp.request', { method: 'tools/call', params: { name: 'save_split' } }, 'c1'));
        port.postMessage({ p: 'wicked.editor', v: 1, re: m.id, ok: true, payload: { handled: true } });
      } else replies.push(e.data as { re?: string });
    };
    await host.action('next');
    await vi.waitFor(() => expect(replies.some((r) => r.re === 'c1')).toBe(true));
    expect(replies.find((r) => r.re === 'c1')).toMatchObject({ ok: false, error: { code: 'refused' } });
    host.teardown('done');
  });

  it('host.mode is answered with the mode now shown; a plugin with no modes is never asked', async () => {
    const { host, ready } = makeHost({ surface: 'full' });
    plugin(ready([2], DECL), (m) => (m.type === 'host.mode' ? { mode: m.payload['mode'] } : undefined));
    await expect(host.setMode('advanced')).resolves.toBe('advanced');
    host.teardown('done');
    const flat = makeHost({ surface: 'full' });
    const seen = plugin(flat.ready([2], { card: {}, full: {} }));
    await expect(flat.host.setMode('advanced')).resolves.toBeNull();
    expect(seen.some((m) => m.type === 'host.mode')).toBe(false);
    flat.host.teardown('done');
  });

  it('options.changed: confirmed by the reply, serialized per tab, newest rev wins, stale snapshots dropped', async () => {
    const { host, ui, ready } = makeHost({ surface: 'options' });
    let rev = 0;
    const truth: Record<string, unknown> = { show: true, where: 'bottom' };
    const port = ready([2], DECL);
    const order: string[] = [];
    plugin(port, (m) => {
      if (m.type !== 'options.changed') return undefined;
      order.push(String(m.payload['id']));
      truth[String(m.payload['id'])] = m.payload['value'];
      rev += 1;
      return { applied: true, rev, values: { ...truth } };
    });
    const first = host.changeOption('captions', 'where', 'top');
    const second = host.changeOption('captions', 'show', false); // queued behind the first
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(true);
    await vi.waitFor(() => expect(order).toEqual(['where', 'show']));
    await vi.waitFor(() => expect(ui.optionsValues).toHaveBeenLastCalledWith('captions', { show: false, where: 'top' }));
    // A snapshot older than the confirmed one is discarded, whenever it arrives.
    port.postMessage(env('options.values', { tab: 'captions', rev: 1, values: { show: true, where: 'bottom' } }));
    port.postMessage(env('options.values', { tab: 'captions', rev: 9, values: { show: true, where: 'bottom' } }));
    await vi.waitFor(() => expect(ui.optionsValues).toHaveBeenLastCalledWith('captions', { show: true, where: 'bottom' }));
    expect(ui.optionsValues.mock.calls.filter((c) => (c[1] as { show: boolean }).show === true && (c[1] as { where: string }).where === 'bottom').length).toBe(1);
    // A value no control can hold never leaves.
    await expect(host.changeOption('captions', 'where', 'left')).resolves.toBe(false);
    host.teardown('done');
  });

  it('codex h1-r1: a queued change resolves with its own outcome, and an unconfirmed "applied" is not success', async () => {
    const { host, ready } = makeHost({ surface: 'options' });
    let n = 0;
    plugin(ready([2], DECL), (m) => {
      if (m.type !== 'options.changed') return undefined;
      n += 1;
      // The first is applied and confirmed; the second says applied but sends no valid snapshot.
      return n === 1 ? { applied: true, rev: 1, values: { show: false } } : { applied: true, rev: 'x', values: { show: true } };
    });
    const first = host.changeOption('captions', 'show', false);
    const second = host.changeOption('captions', 'where', 'top');
    await expect(first).resolves.toBe(true);
    await expect(second).resolves.toBe(false);
    host.teardown('done');
  });

  it('codex h1-r2: a reply with no payload resolves false and the queue keeps moving', async () => {
    const { host, ready } = makeHost({ surface: 'options' });
    const port = ready([2], DECL);
    port.onmessage = (e) => {
      const m = e.data as { type?: string; id?: string };
      if (m.type === 'options.changed') port.postMessage({ p: 'wicked.editor', v: 1, re: m.id, ok: true });
    };
    const a = host.changeOption('captions', 'show', false);
    const b = host.changeOption('captions', 'where', 'top');
    await expect(a).resolves.toBe(false);
    await expect(b).resolves.toBe(false);
    host.teardown('done');
  });

  it('a plugin tab picked before the handshake is the tab host.hello carries; a controls tab is not (desk_doc_editors)', () => {
    const early = makeHost({ surface: 'options' });
    early.host.setTab('chapters'); // the operator clicked the tab while the options frame was still loading
    early.ready([2], DECL);
    expect(early.hello[0]).toMatchObject({ surface: 'options', tab: 'chapters' });
    early.host.teardown('done');
    const controls = makeHost({ surface: 'options' });
    controls.host.setTab('captions');
    controls.ready([2], DECL);
    expect(controls.hello[0]?.['tab']).toBeUndefined();
    controls.host.teardown('done');
  });

  it('a change the plugin did not apply resolves false', async () => {
    const { host, ready } = makeHost({ surface: 'options' });
    plugin(ready([2], DECL), (m) => (m.type === 'options.changed' ? { applied: false, rev: 1, values: { show: true }, reason: 'read-only' } : undefined));
    await expect(host.changeOption('captions', 'show', false)).resolves.toBe(false);
    host.teardown('done');
  });

  it('ui.height only for an auto card, clamped; host.selection relays; host.surface replaces host.size', async () => {
    const { host, ui, ready } = makeHost();
    const port = ready([2], DECL);
    const seen = plugin(port);
    port.postMessage(env('ui.height', { px: 9000 }));
    await vi.waitFor(() => expect(ui.cardHeight).toHaveBeenCalledWith(560));
    host.relaySelection([{ kind: 'chapter', id: 'c2' }]);
    host.setSurface('full', 'advanced');
    host.setTab('chapters');
    host.setTab('captions'); // a controls tab is not the plugin's to show
    await vi.waitFor(() => expect(seen.map((m) => m.type)).toEqual(expect.arrayContaining(['host.selection', 'host.surface', 'host.tab'])));
    expect(seen.find((m) => m.type === 'host.surface')?.payload).toEqual({ surface: 'full', mode: 'advanced' });
    expect(seen.filter((m) => m.type === 'host.tab').map((m) => m.payload)).toEqual([{ tab: 'chapters' }]);
    host.teardown('done');
  });

  it('a 16:9 card asking for a height is dropped', async () => {
    const d = clone(DECL); d.card.aspect = '16:9';
    const { host, ui, log, ready } = makeHost();
    const port = ready([2], d);
    port.postMessage(env('ui.height', { px: 300 }));
    await vi.waitFor(() => expect(log.some((e) => e.kind === 'dropped' && e.type === 'ui.height')).toBe(true));
    expect(ui.cardHeight).not.toHaveBeenCalled();
    host.teardown('done');
  });

  it('a protocol-1 plugin on this host still hears host.size, and has no v2 requests', async () => {
    const { host, ready } = makeHost();
    const seen = plugin(ready([1]));
    expect(host.negotiated).toBe(1);
    host.setSurface('full');
    await expect(host.action('next')).resolves.toBeNull();
    await vi.waitFor(() => expect(seen.map((m) => m.type)).toContain('host.size'));
    expect(seen.find((m) => m.type === 'host.size')?.payload).toEqual({ size: 'full' });
    host.teardown('done');
  });
});
