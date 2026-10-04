import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorHost, type HostLogEntry, type HostUi } from '../src/editors/host.js';
import { FakeDocAdapter, SAMPLE_PAGE } from '../src/editors/fakeAdapter.js';
import { CHORD_TABLE, isForwardable, isOneGrapheme, judgeKey, judgeTyped } from '../src/editors/keys.js';
import { builtinDefaults, changedBy, chipsFor, elementLabel, resolveKind } from '../src/editors/model.js';
import { checkOps, inventoryOf, isColour, themeTokensOf } from '../src/editors/ops.js';
import { LIMITS, parseInbound, parseReady, type PermissionId } from '../src/editors/protocol.js';

/**
 * EP-P1 (DES-EDITOR-PLUGINS-001 §12.2): the protocol parser, the grants, the op mapping with text
 * escaping and the colour grammar, the host's own inventory, kind resolution, chips with host labels,
 * the forwardable keys and the typing rule, `artifact.changed.by`, and the host controller's
 * handshake / teardown / window-message / per-request grant rules.
 */

const env = (type: string, payload: unknown, id?: string) => ({ p: 'wicked.editor', v: 1, type, payload, ...(id !== undefined ? { id } : {}) });

describe('the strict parser', () => {
  it('accepts each request and event shape, and drops anything else whole', () => {
    expect(parseInbound(env('artifact.read', {}, 'r1'))).toMatchObject({ ok: true, msg: { kind: 'request', type: 'artifact.read', id: 'r1' } });
    expect(parseInbound(env('version.write', { base: 1, ops: [], summary: 'x' }, 'r2'))).toMatchObject({ ok: true });
    expect(parseInbound(env('selection.set', { anchors: [{ kind: 'element', id: 'cta' }] }))).toMatchObject({ ok: true, msg: { kind: 'event' } });
    expect(parseInbound({ p: 'wicked.editor', v: 1, re: 'ping-1', ok: true, payload: {} })).toMatchObject({ ok: true, msg: { kind: 'reply' } });
    // wrong protocol, wrong version, not an object
    expect(parseInbound({ ...env('artifact.read', {}, 'r'), p: 'other' }).ok).toBe(false);
    expect(parseInbound({ ...env('artifact.read', {}, 'r'), v: 2 }).ok).toBe(false);
    expect(parseInbound('artifact.read').ok).toBe(false);
    // unknown type: dropped, its id answered
    expect(parseInbound(env('gate.decide', { approve: true }, 'r9'))).toStrictEqual({ ok: false, reason: 'unknown type gate.decide', id: 'r9' });
    // a request with no id, an event with one, a bad id
    expect(parseInbound(env('artifact.read', {})).ok).toBe(false);
    expect(parseInbound(env('ui.status', { line: 'x' }, 'e1')).ok).toBe(false);
    expect(parseInbound(env('artifact.read', {}, 'x'.repeat(65))).ok).toBe(false);
    // a mistyped field rejects the request with its id
    expect(parseInbound(env('version.write', { base: '1', ops: [], summary: 'x' }, 'r3'))).toMatchObject({ ok: false, id: 'r3' });
    expect(parseInbound(env('ui.status', { line: 'x'.repeat(121) })).ok).toBe(false);
    expect(parseInbound(env('composer.draft', { text: 'x'.repeat(2001), anchors: [] }, 'r4')).ok).toBe(false);
    expect(parseInbound(env('selection.set', { anchors: [{ kind: 'element' }] })).ok).toBe(false);
    // oversized
    expect(parseInbound(env('ui.status', { line: 'x', pad: 'y'.repeat(1_000_001) }))).toMatchObject({ ok: false, reason: 'too large' });
  });

  it('codex: an ambiguous reply, a malformed ready, and a malformed checks list are rejected', () => {
    expect(parseInbound({ p: 'wicked.editor', v: 1, re: 'ping-1', ok: true, type: 'version.write', id: 'x', payload: {} }).ok).toBe(false);
    expect(parseReady(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1, 'invalid'] }))).toBeNull();
    expect(parseInbound(env('checks.contribute', { checks: ['approve'] })).ok).toBe(false);
    expect(parseInbound(env('checks.contribute', { checks: Array.from({ length: 101 }, () => ({ id: 'c', text: 't' })) })).ok).toBe(false);
    expect(parseInbound(env('checks.contribute', { checks: [{ id: 'c1', text: 'The term "free" is used 3 times' }] })).ok).toBe(true);
    // One line means one line; sizes are UTF-8 bytes (Copilot).
    expect(parseInbound(env('checks.contribute', { checks: [{ id: 'c1', text: 'line one\nline two' }] })).ok).toBe(false);
    expect(parseInbound(env('ui.status', { line: 'a\rb' })).ok).toBe(false);
    expect(parseInbound(env('ui.status', { line: 'x', pad: '😀'.repeat(300_000) }))).toMatchObject({ ok: false, reason: 'too large' });
    // Additive payload fields are ignored within v1 (§5.4), never acted on.
    expect(parseInbound(env('ui.status', { line: 'x', extra: true })).ok).toBe(true);
  });

  it('reads the one plugin.ready window message', () => {
    expect(parseReady(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1, 2] }))).toStrictEqual({ editor: 'acme', version: '0.1.0', protocol: [1, 2] });
    expect(parseReady(env('plugin.ready', { editor: 1 }))).toBeNull();
    expect(parseReady(env('host.hello', {}))).toBeNull();
  });
});

describe('ops: text and colours, never markup', () => {
  const inv = inventoryOf(SAMPLE_PAGE);

  it('sends text as typed — the engine lands a content-edit as text (interactive #250), so markup is literal', () => {
    const r = checkOps([{ op: 'text', anchor: 'hero-title', value: '<b>Hi</b>', before: 'Book a study room in under a minute' }], inv);
    expect(r).toStrictEqual({ ok: true, items: [{ selector: 'hero-title', type: 'content-edit', value: '<b>Hi</b>', before: 'Book a study room in under a minute' }] });
  });

  it('the colour grammar: each accepted and refused form', () => {
    const tokens = themeTokensOf(SAMPLE_PAGE);
    for (const ok of ['#fff', '#224a5e', '#224a5ecc', 'rgb(1, 2, 3)', 'rgba(1,2,3,0.5)', 'hsl(200, 47%, 25%)', 'hsla(200deg,47%,25%,.5)', 'var(--wi-accent)']) {
      expect(isColour(ok, tokens), ok).toBe(true);
    }
    for (const bad of ['url(https://x)', 'red; position:fixed', '#fff}body{x', 'expression(alert(1))', 'var(--wi-unknown)', 'red', '#ffff', 'rgb(1,2)', 'var(--accent)']) {
      expect(isColour(bad, tokens), bad).toBe(false);
    }
    expect(checkOps([{ op: 'style', anchor: 'cta', style: { background: 'url(https://x)' } }], inv)).toMatchObject({ ok: false, code: 'bad_request' });
    expect(checkOps([{ op: 'style', anchor: 'cta', style: { position: 'fixed' } }], inv)).toMatchObject({ ok: false, code: 'bad_request' });
    expect(checkOps([{ op: 'style', anchor: 'cta', style: { color: '#fff' } }], inv)).toMatchObject({ ok: true, items: [{ type: 'style-edit', style: { color: '#fff' } }] });
  });

  it('anchors come from the host inventory; structural-change is not an op; caps hold', () => {
    expect(checkOps([{ op: 'remove', anchor: 'ghost' }], inv)).toMatchObject({ ok: false, code: 'bad_request' });
    expect(checkOps([{ op: 'structural-change', anchor: 'cta' }], inv)).toMatchObject({ ok: false, code: 'bad_request' });
    expect(checkOps([{ op: 'remove', anchor: 'cta' }], inv)).toStrictEqual({ ok: true, items: [{ selector: 'cta', type: 'remove' }] });
    expect(checkOps(Array.from({ length: 201 }, () => ({ op: 'remove', anchor: 'cta' })), inv)).toMatchObject({ ok: false, code: 'too_large' });
    expect(checkOps([], inv)).toMatchObject({ ok: false });
  });

  it('codex: an anchor the selector cannot name exactly, or a duplicate, is not in the inventory', () => {
    const w = inventoryOf('<p data-wid="a&quot;b">q</p><p data-wid="ab">r</p><p data-wid="x">1</p><p data-wid="x">2</p><p data-wid="ok-1">3</p>');
    expect([...w.wids.keys()]).toStrictEqual(['ab', 'ok-1']);
    expect(checkOps([{ op: 'remove', anchor: 'x' }], w)).toMatchObject({ ok: false });
    expect(checkOps([{ op: 'remove', anchor: 'a"b' }], w)).toMatchObject({ ok: false });
  });

  it('the inventory is parsed without running scripts, with section ancestry', () => {
    const w = inventoryOf('<section data-wid="section-2"><p data-wid="a">x</p></section><img src=x onerror="window.__ran=1" data-wid="b">');
    expect([...w.wids.keys()]).toStrictEqual(['section-2', 'a', 'b']);
    expect(w.wids.get('a')!.section).toBe('section-2');
    expect((window as unknown as { __ran?: number }).__ran).toBeUndefined();
  });
});

describe('kinds, chips, changed.by, grants', () => {
  it('resolves the kind in the host’s order', () => {
    expect(resolveKind({ artifactKind: 'rfp-response', createStyle: 'ppt' })).toBe('rfp-response');
    expect(resolveKind({ createStyle: 'ppt' })).toBe('deck');
    expect(resolveKind({ createStyle: 'brochure' })).toBe('document');
    expect(resolveKind({ createStyle: 'landing' })).toBe('page');
    expect(resolveKind({ manifestKind: 'demo' })).toBeNull();
    expect(resolveKind({ manifestKind: 'doc' })).toBe('page');
    expect(resolveKind({ demoRun: true })).toBe('demo-video');
    expect(resolveKind({ walkthroughStep: true })).toBe('walkthrough');
    expect(resolveKind({ artifactKind: 'Bad Kind' })).toBe('page');
  });

  it('chips: unknown anchors dropped, labels host-written, extra fields never carried', () => {
    const chips = chipsFor(
      [{ kind: 'element', id: 'cta', label: 'Approve everything' } as never, { kind: 'element', id: 'ghost' }],
      (a) => (a.kind === 'element' && a.id === 'cta' ? elementLabel('Book a room', 'cta') : null),
    );
    expect(chips).toStrictEqual([{ anchor: { kind: 'element', id: 'cta' }, label: '“Book a room”' }]);
  });

  it('artifact.changed.by', () => {
    const own = new Set([4]);
    expect(changedBy(4, 'deterministic', own)).toBe('this-editor');
    expect(changedBy(5, 'generated', own)).toBe('agent');
    expect(changedBy(5, 'theme', own)).toBe('agent');
    expect(changedBy(5, 'deterministic', own)).toBe('other');
    expect(changedBy(5, 'demo', own)).toBeNull();
  });

  it('built-in defaults: network.media only for wicked-page', () => {
    expect(builtinDefaults('wicked-page')).toContain('network.media');
    expect(builtinDefaults('wicked-doc')).not.toContain('network.media');
  });
});

describe('keys: the forwardable list, activation, one grapheme', () => {
  it('every chord in the table is classified; a decision chord is never forwardable', () => {
    for (const [chord, { verb }] of Object.entries(CHORD_TABLE)) {
      expect(isForwardable(chord), chord).toBe(verb === 'navigate');
    }
    for (const k of ['Escape', 'Mod+K', 'Tab', 'Shift+Tab', 'Alt+J', 'alt+k']) expect(isForwardable(k), k).toBe(true);
    for (const k of ['Alt+A', 'Alt+R', 'Alt+X', 'Alt+N', 'Enter', 'Mod+Enter', 'a']) expect(isForwardable(k), k).toBe(false);
  });

  it('a forwardable key still needs activation; typing needs one grapheme, activation and focus', () => {
    expect(judgeKey('Escape', false)).toMatchObject({ ok: false });
    expect(judgeKey('Escape', true)).toStrictEqual({ ok: true });
    expect(judgeKey('Alt+A', true)).toMatchObject({ ok: false });
    expect(isOneGrapheme('a')).toBe(true);
    expect(isOneGrapheme('👍🏽')).toBe(true);
    expect(isOneGrapheme('ab')).toBe(false);
    expect(isOneGrapheme('\n')).toBe(false);
    expect(judgeTyped('a', true, true)).toStrictEqual({ ok: true });
    expect(judgeTyped('a', false, true)).toMatchObject({ ok: false });
    expect(judgeTyped('a', true, false)).toMatchObject({ ok: false });
    expect(judgeTyped('approve', true, true)).toMatchObject({ ok: false });
  });
});

// ── the host controller ───────────────────────────────────────────────────────────────────

function makeHost(grants: PermissionId[] = ['artifact.read', 'selection.chip']) {
  const log: HostLogEntry[] = [];
  const ui: HostUi = {
    chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(),
    thread: vi.fn(), fullscreen: vi.fn(async () => true), torn: vi.fn(), log: (e) => log.push(e),
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const adapter = new FakeDocAdapter();
  const host = new EditorHost({
    container, src: 'about:blank', editor: 'acme', version: '0.1.0', name: 'Acme', title: 'Acme: a page', size: 'pane', grants,
    theme: {}, prefs: { reducedMotion: false, techDetails: false, locale: 'en' }, firstParty: false, adapter, ui,
    activation: () => false,
  });
  host.mount();
  const fromFrame = (data: unknown): void => {
    window.dispatchEvent(new MessageEvent('message', { data, source: host.frame.contentWindow }));
  };
  return { host, ui, log, adapter, fromFrame };
}

afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); });

describe('the host controller', () => {
  it('creates exactly a sandbox="allow-scripts" frame with no allow= features', () => {
    const { host } = makeHost();
    expect(host.frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(host.frame.hasAttribute('allow')).toBe(false);
    expect(host.frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    host.teardown('done');
  });

  it('handshakes once per element, only for the editor it loaded; later window messages are ignored', () => {
    const { host, log, fromFrame } = makeHost();
    const posted = vi.spyOn(host.frame.contentWindow!, 'postMessage');
    fromFrame(env('plugin.ready', { editor: 'other', version: '0.1.0', protocol: [1] }));
    expect(host.connected).toBe(false);
    fromFrame(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }));
    expect(host.connected).toBe(true);
    expect(posted).toHaveBeenCalledTimes(1);
    expect((posted.mock.calls[0]![0] as { type: string }).type).toBe('host.hello');
    fromFrame(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }));
    fromFrame(env('selection.set', { anchors: [{ kind: 'element', id: 'cta' }] }));
    expect(posted).toHaveBeenCalledTimes(1);
    // the wrong editor's ready, the second ready, the window selection.set
    expect(log.filter((e) => e.kind === 'ignored-window-message').length).toBe(3);
    // A message from any other window is not even looked at.
    window.dispatchEvent(new MessageEvent('message', { data: env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }), source: window }));
    expect(posted).toHaveBeenCalledTimes(1);
    host.teardown('done');
  });

  it('codex: a sustained flood tears down even when each second starts under the limit', () => {
    let t = 0;
    const { host, fromFrame } = makeHost();
    (host as unknown as { now: () => number }).now = () => t;
    let port: MessagePort | null = null;
    vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { port = (tr?.[0] as MessagePort) ?? null; }) as never);
    fromFrame(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }));
    const portMessage = (host as unknown as { portMessage: (d: unknown) => void }).portMessage.bind(host);
    expect(port).not.toBeNull();
    for (let sec = 0; sec < 7 && host.alive; sec++) {
      t = sec * 1000;
      for (let i = 0; i < 205; i++) portMessage(env('ui.status', { line: 'x' }));
    }
    expect(host.alive).toBe(false);
  });

  it('Copilot r2: one write in flight even while the inventory read is pending', async () => {
    const { host, fromFrame, adapter } = makeHost(['artifact.read', 'artifact.write']);
    let port: MessagePort | null = null;
    vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { port = (tr?.[0] as MessagePort) ?? null; }) as never);
    fromFrame(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }));
    const write = vi.spyOn(adapter, 'write');
    // The inventory read is slow: the second write arrives while the first is still reading.
    const read = adapter.read.bind(adapter);
    vi.spyOn(adapter, 'read').mockImplementation(async (v?: number) => { await new Promise((r) => setTimeout(r, 50)); return read(v); });
    const replies: { re: string; ok: boolean; error?: { code: string } }[] = [];
    port!.onmessage = (m) => replies.push(m.data);
    const op = { op: 'style', anchor: 'cta', style: { color: '#fff' } };
    port!.postMessage(env('version.write', { base: 1, ops: [op], summary: 'a' }, 'w1'));
    port!.postMessage(env('version.write', { base: 1, ops: [op], summary: 'b' }, 'w2'));
    await vi.waitFor(() => expect(replies.length).toBe(2));
    expect(write).toHaveBeenCalledTimes(1);
    expect(replies.find((r) => r.re === 'w2')).toMatchObject({ ok: false, error: { code: 'rate_limited' } });
    host.teardown('done');
  });

  it('Copilot r3: one typed character per gesture, even in a burst under activation', async () => {
    const log: HostLogEntry[] = [];
    const typed = vi.fn();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const host = new EditorHost({
      container, src: 'about:blank', editor: 'acme', version: '0.1.0', name: 'Acme', title: 'Acme: a page', size: 'pane',
      grants: ['artifact.read'], theme: {}, prefs: { reducedMotion: false, techDetails: false, locale: 'en' }, firstParty: false,
      adapter: new FakeDocAdapter(),
      ui: { chips: vi.fn(), draft: vi.fn(), typed, key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(), thread: vi.fn(), fullscreen: vi.fn(async () => true), torn: vi.fn(), log: (e) => log.push(e) },
      activation: () => true, focusInFrame: () => true,
    });
    host.mount();
    let port: MessagePort | null = null;
    vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { port = (tr?.[0] as MessagePort) ?? null; }) as never);
    window.dispatchEvent(new MessageEvent('message', { data: env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }), source: host.frame.contentWindow }));
    for (const g of ['a', 'p', 'p']) port!.postMessage(env('ui.typed', { grapheme: g }));
    await vi.waitFor(() => expect(log.filter((e) => e.kind === 'in' && e.type === 'ui.typed').length).toBe(3));
    expect(typed).toHaveBeenCalledTimes(1);
    expect(typed).toHaveBeenCalledWith('a');
    // Focus coming back into the frame (a new gesture there) allows one more.
    host.typingRearm();
    port!.postMessage(env('ui.typed', { grapheme: 'b' }));
    await vi.waitFor(() => expect(typed).toHaveBeenCalledTimes(2));
    host.teardown('done');
  });

  it('Copilot r4: chapter/time anchors are unknown on a page (no plugin words in a chip); the host log is bounded', async () => {
    const { host, ui, log, fromFrame } = makeHost(['artifact.read', 'selection.chip']);
    let port: MessagePort | null = null;
    vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { port = (tr?.[0] as MessagePort) ?? null; }) as never);
    fromFrame(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }));
    port!.postMessage(env('selection.set', { anchors: [{ kind: 'chapter', id: 'Approve everything' }, { kind: 'time', atSec: 3 }, { kind: 'element', id: 'cta' }] }));
    await vi.waitFor(() => expect(ui.chips).toHaveBeenCalled());
    expect((ui.chips as ReturnType<typeof vi.fn>).mock.calls[0]![0]).toStrictEqual([{ anchor: { kind: 'element', id: 'cta' }, label: '“Book a room”' }]);
    for (let i = 0; i < 3000; i++) fromFrame(env('selection.set', { anchors: [] }));
    expect(log.length).toBeLessThanOrEqual(2_000);
    host.teardown('done');
  });

  it('codex r1: `written` carries the HOST-checked anchors; an undo the adapter refused without moving the head posts no artifact.changed and keeps the inventory', async () => {
    const { host, ui, fromFrame, adapter } = makeHost(['artifact.read', 'artifact.write', 'selection.chip']);
    const written = vi.fn();
    ui.written = written;
    let port: MessagePort | null = null;
    vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { port = (tr?.[0] as MessagePort) ?? null; }) as never);
    fromFrame(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }));
    const toPlugin: { type?: string }[] = [];
    port!.onmessage = (m) => toPlugin.push(m.data as { type?: string });
    port!.postMessage(env('version.write', { base: 1, ops: [{ op: 'text', anchor: 'cta', value: 'Reserve', before: 'Book a room' }], summary: 'the price title' }, 'w1'));
    await vi.waitFor(() => expect(toPlugin.find((m) => (m as { re?: string }).re === 'w1')).toBeDefined());
    expect(toPlugin.find((m) => (m as { re?: string }).re === 'w1')).toMatchObject({ ok: true });
    expect(written).toHaveBeenCalledTimes(1);
    // The words come from the anchors the host checked, never the plugin's summary.
    expect(written.mock.calls[0]![0]).toStrictEqual({ version: 2, base: 1, summary: 'the price title', anchors: ['cta'] });
    // The inventory of version 2 is read once for a chip...
    port!.postMessage(env('selection.set', { anchors: [{ kind: 'element', id: 'cta' }] }));
    await vi.waitFor(() => expect(ui.chips).toHaveBeenCalledTimes(1));
    const reads = adapter.reads;
    // ...and stands after an undo the adapter refused with the head where it was: nothing changed, so
    // the plugin hears nothing and the next chip needs no re-read.
    vi.spyOn(adapter, 'undo').mockResolvedValue({ error: 'unavailable', message: 'The change was sent, but no new version appeared.' });
    expect(await host.undo(2)).toMatchObject({ error: 'unavailable' });
    expect(toPlugin.filter((m) => m.type === 'artifact.changed')).toHaveLength(0);
    port!.postMessage(env('selection.set', { anchors: [{ kind: 'element', id: 'cta' }] }));
    await vi.waitFor(() => expect(ui.chips).toHaveBeenCalledTimes(2));
    expect(adapter.reads).toBe(reads);
    host.teardown('done');
  });

  it('codex r2: a write that landed under a helper’s newer head — the reply says the version written, then artifact.changed says the head', async () => {
    const { host, fromFrame, adapter } = makeHost(['artifact.read', 'artifact.write']);
    let port: MessagePort | null = null;
    vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { port = (tr?.[0] as MessagePort) ?? null; }) as never);
    fromFrame(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }));
    const toPlugin: { type?: string; re?: string; payload?: unknown }[] = [];
    port!.onmessage = (m) => toPlugin.push(m.data as { type?: string; re?: string; payload?: unknown });
    // The adapter: this edit is v2, but the manifest already has a helper's v3 as the head.
    const ref = adapter.artifact();
    const artifact = vi.spyOn(adapter, 'artifact').mockReturnValue({ ...ref, version: 1, head: 1 });
    vi.spyOn(adapter, 'write').mockImplementation(async () => {
      artifact.mockReturnValue({ ...ref, version: 3, head: 3 }); // the adapter's head follows the manifest
      return { version: 2, moved: { head: 3, kind: 'generated' } };
    });
    port!.postMessage(env('version.write', { base: 1, ops: [{ op: 'text', anchor: 'cta', value: 'Reserve', before: 'Book a room' }], summary: 'cta' }, 'w1'));
    await vi.waitFor(() => expect(toPlugin.filter((m) => m.type === 'artifact.changed')).toHaveLength(1));
    const i = toPlugin.findIndex((m) => m.re === 'w1');
    expect(toPlugin[i]!.payload).toStrictEqual({ version: 2 }); // never a `moved` field on the wire
    expect(toPlugin[i + 1]).toMatchObject({ type: 'artifact.changed', payload: { version: 3, head: 3, by: 'agent', kind: 'generated' } });
    host.teardown('done');
  });

  it('codex r3: a write that lands AFTER the reply timed out is still announced — the plugin heard "timeout", then hears its own version as artifact.changed', async () => {
    // The adapter polls the manifest for up to 20 s; the reply window is 10 s (here 60 ms). A landing in
    // between must not be discarded with the reply: the host line already says "You changed …", so the
    // plugin's page has to follow.
    const limits = LIMITS as { replyMs: number };
    const was = limits.replyMs;
    limits.replyMs = 60;
    try {
      const { host, fromFrame, adapter } = makeHost(['artifact.read', 'artifact.write']);
      let port: MessagePort | null = null;
      vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { port = (tr?.[0] as MessagePort) ?? null; }) as never);
      fromFrame(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }));
      const toPlugin: { type?: string; re?: string; ok?: boolean; error?: { code: string }; payload?: unknown }[] = [];
      port!.onmessage = (m) => toPlugin.push(m.data as (typeof toPlugin)[number]);
      const ref = adapter.artifact();
      const artifact = vi.spyOn(adapter, 'artifact').mockReturnValue({ ...ref, version: 1, head: 1 });
      let land: ((r: { version: number }) => void) | null = null;
      vi.spyOn(adapter, 'write').mockImplementation(() => new Promise((resolve) => { land = resolve; }));
      port!.postMessage(env('version.write', { base: 1, ops: [{ op: 'text', anchor: 'cta', value: 'Reserve', before: 'Book a room' }], summary: 'cta' }, 'w1'));
      await vi.waitFor(() => expect(toPlugin.find((m) => m.re === 'w1')).toMatchObject({ ok: false, error: { code: 'timeout' } }));
      expect(land).not.toBeNull();
      // 2 s later (well inside the poll window) the version lands: the adapter's head follows it.
      artifact.mockReturnValue({ ...ref, version: 2, head: 2 });
      land!({ version: 2 });
      await vi.waitFor(() => expect(toPlugin.filter((m) => m.type === 'artifact.changed')).toHaveLength(1));
      expect(toPlugin.at(-1)).toMatchObject({ type: 'artifact.changed', payload: { version: 2, head: 2, by: 'this-editor', kind: 'deterministic' } });
      expect(toPlugin.filter((m) => m.re === 'w1')).toHaveLength(1); // no second reply to a settled request
      host.teardown('done');
    } finally {
      limits.replyMs = was;
    }
  });

  it('codex r4: a write’s timeout is the HOST’s line, said when the timer fires — so a later landing’s written line (with Undo) comes after it and stays', async () => {
    // The plugin used to say "Not changed: no answer in 10 s" itself, on hearing the timeout reply; a
    // landing just after the timer could post the host's written line FIRST, and the plugin's late status
    // then replaced it (Undo gone, a false "Not changed" left). The host now says it, in its own order.
    const limits = LIMITS as { replyMs: number };
    const was = limits.replyMs;
    limits.replyMs = 60;
    try {
      const { host, fromFrame, adapter, ui } = makeHost(['artifact.read', 'artifact.write']);
      const order: string[] = [];
      (ui.status as ReturnType<typeof vi.fn>).mockImplementation((line: string) => { order.push(`status:${line}`); });
      ui.written = vi.fn((w: { version: number }) => { order.push(`written:${w.version}`); });
      let port: MessagePort | null = null;
      vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { port = (tr?.[0] as MessagePort) ?? null; }) as never);
      fromFrame(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }));
      const toPlugin: { type?: string; re?: string; ok?: boolean; error?: { code: string }; payload?: unknown }[] = [];
      port!.onmessage = (m) => toPlugin.push(m.data as (typeof toPlugin)[number]);
      const ref = adapter.artifact();
      const artifact = vi.spyOn(adapter, 'artifact').mockReturnValue({ ...ref, version: 1, head: 1 });
      let land: ((r: { version: number }) => void) | null = null;
      vi.spyOn(adapter, 'write').mockImplementation(() => new Promise((resolve) => { land = resolve; }));
      port!.postMessage(env('version.write', { base: 1, ops: [{ op: 'text', anchor: 'cta', value: 'Reserve', before: 'Book a room' }], summary: 'cta' }, 'w1'));
      await vi.waitFor(() => expect(toPlugin.find((m) => m.re === 'w1')).toMatchObject({ ok: false, error: { code: 'timeout' } }));
      expect(order).toHaveLength(1);
      expect(order[0]).toMatch(/^status:.*no answer in 10 s/i);
      artifact.mockReturnValue({ ...ref, version: 2, head: 2 });
      land!({ version: 2 });
      await vi.waitFor(() => expect(order.at(-1)).toBe('written:2'));
      host.teardown('done');
    } finally {
      limits.replyMs = was;
    }
  });

  it('codex r3: a late stale answer carries where the head went (moved) — the plugin hears that too, and nothing else', async () => {
    const limits = LIMITS as { replyMs: number };
    const was = limits.replyMs;
    limits.replyMs = 60;
    try {
      const { host, fromFrame, adapter } = makeHost(['artifact.read', 'artifact.write']);
      let port: MessagePort | null = null;
      vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, tr?: Transferable[]) => { port = (tr?.[0] as MessagePort) ?? null; }) as never);
      fromFrame(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }));
      const toPlugin: { type?: string; re?: string; ok?: boolean; error?: { code: string }; payload?: unknown }[] = [];
      port!.onmessage = (m) => toPlugin.push(m.data as (typeof toPlugin)[number]);
      const ref = adapter.artifact();
      const artifact = vi.spyOn(adapter, 'artifact').mockReturnValue({ ...ref, version: 1, head: 1 });
      let answer: ((r: { error: 'stale'; message: string; head: number; moved: { head: number; kind: 'generated' } }) => void) | null = null;
      vi.spyOn(adapter, 'write').mockImplementation(() => new Promise((resolve) => { answer = resolve as typeof answer; }));
      port!.postMessage(env('version.write', { base: 1, ops: [{ op: 'text', anchor: 'cta', value: 'Reserve', before: 'Book a room' }], summary: 'cta' }, 'w1'));
      await vi.waitFor(() => expect(toPlugin.find((m) => m.re === 'w1')).toMatchObject({ ok: false, error: { code: 'timeout' } }));
      artifact.mockReturnValue({ ...ref, version: 2, head: 2 });
      answer!({ error: 'stale', message: 'The page changed (version 2), but not by your edit', head: 2, moved: { head: 2, kind: 'generated' } });
      await vi.waitFor(() => expect(toPlugin.filter((m) => m.type === 'artifact.changed')).toHaveLength(1));
      expect(toPlugin.at(-1)).toMatchObject({ type: 'artifact.changed', payload: { version: 2, head: 2, by: 'agent', kind: 'generated' } });
      expect(toPlugin.filter((m) => m.re === 'w1')).toHaveLength(1);
      host.teardown('done');
    } finally {
      limits.replyMs = was;
    }
  });

  it('a second load of the frame is a teardown', () => {
    const { host, ui } = makeHost();
    host.frame.dispatchEvent(new Event('load'));
    expect(host.alive).toBe(true);
    host.frame.dispatchEvent(new Event('load'));
    expect(host.alive).toBe(false);
    expect(ui.torn).toHaveBeenCalledWith('This editor reloaded itself');
    expect(host.frame.isConnected).toBe(false);
  });

  it('no plugin.ready in 3 s: "didn’t start"', () => {
    vi.useFakeTimers();
    const { host, ui } = makeHost();
    vi.advanceTimersByTime(3_001);
    expect(host.alive).toBe(false);
    expect(ui.torn).toHaveBeenCalledWith('This editor didn’t start');
  });

  it('grants are enforced per request; drops are counted and three tear down', async () => {
    const { host, ui, log, fromFrame } = makeHost(['artifact.read']);
    let port: MessagePort | null = null;
    vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation(((_m: unknown, _o: unknown, transfer?: Transferable[]) => { port = (transfer?.[0] as MessagePort) ?? null; }) as never);
    fromFrame(env('plugin.ready', { editor: 'acme', version: '0.1.0', protocol: [1] }));
    expect(port).not.toBeNull();
    const replies: unknown[] = [];
    port!.onmessage = (m) => replies.push(m.data);
    port!.postMessage(env('version.write', { base: 1, ops: [{ op: 'remove', anchor: 'cta' }], summary: 'x' }, 'w1'));
    port!.postMessage(env('artifact.read', {}, 'r1'));
    await vi.waitFor(() => expect(replies.length).toBe(2));
    expect(replies).toContainEqual({ p: 'wicked.editor', v: 1, re: 'w1', ok: false, error: { code: 'not_granted', message: 'needs artifact.write' } });
    expect(replies.find((r) => (r as { re: string }).re === 'r1')).toMatchObject({ ok: true, payload: { version: 1 } });
    // no activation: forwarded keys and typing are dropped; the third drop tears down
    port!.postMessage(env('ui.key', { key: 'Escape' }));
    port!.postMessage(env('ui.typed', { grapheme: 'a' }));
    port!.postMessage(env('ui.key', { key: 'Alt+A' }));
    await vi.waitFor(() => expect(host.alive).toBe(false));
    expect(ui.key).not.toHaveBeenCalled();
    expect(ui.typed).not.toHaveBeenCalled();
    expect(log.filter((e) => e.kind === 'dropped').length).toBe(3);
  });
});
