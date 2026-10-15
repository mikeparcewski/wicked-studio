import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorHost, type HostLogEntry, type HostUi } from '../src/editors/host.js';
import { FakeDocAdapter } from '../src/editors/fakeAdapter.js';
import { parseSurfaces, parseWireSurfaces, sameSurfaces, type Surfaces } from '../src/editors/surfaces.js';
import deckSurfaces from '../src/plugins/wicked-deck/surfaces.json';
import docSurfaces from '../src/plugins/wicked-doc/surfaces.json';
import pageSurfaces from '../src/plugins/wicked-page/surfaces.json';
import videoSurfaces from '../src/plugins/wicked-video/surfaces.json';

/**
 * wicked-studio#791: crew's `GET /api/v1/editors` serves each protocol-2 editor's `surfaces` in the parsed
 * wire form of `EditorSurfaces` (defaults filled, `options`/`full` `null` when omitted, `full.modes: null`
 * with `default: 'simple'` when single-mode), while the plugin's `plugin.ready` carries the raw declaration.
 */

interface RawDecl {
  card: {
    interactive?: boolean;
    aspect?: string;
    actions?: Array<{ id: string; label: string; primary?: boolean; verb: string }>;
  };
  options?: {
    tabs: Array<{ id: string; label: string; render: string; controls?: Array<Record<string, unknown>> }>;
  };
  full?: {
    modes?: string[];
    default?: string;
  };
}

/** Build the parsed wire form from a declaration the way crew's registry does (`EditorSurfaces`). */
function toWire(decl: RawDecl): Record<string, unknown> {
  return {
    card: {
      interactive: decl.card.interactive ?? false,
      aspect: decl.card.aspect ?? '16:9',
      actions: (decl.card.actions ?? []).map((a) => ({
        id: a.id,
        label: a.label,
        primary: a.primary ?? false,
        verb: a.verb,
      })),
    },
    options: decl.options === undefined ? null : {
      tabs: decl.options.tabs.map((t) => ({
        id: t.id,
        label: t.label,
        render: t.render,
        ...(t.controls !== undefined
          ? { controls: t.controls.map((c) => (c['type'] === 'text' ? { ...c, maxChars: c['maxChars'] ?? 200 } : { ...c })) }
          : {}),
      })),
    },
    full: decl.full === undefined ? null : {
      modes: decl.full.modes ?? null,
      default: decl.full.default ?? 'simple',
    },
  };
}

const DECK_WIRE = {
  card: {
    interactive: true,
    aspect: '16:9',
    actions: [
      { id: 'prev', label: 'Previous slide', primary: false, verb: 'plugin' },
      { id: 'next', label: 'Next slide', primary: true, verb: 'plugin' },
      { id: 'ask', label: 'Ask about this', primary: false, verb: 'host:ask' },
      { id: 'export', label: 'Export', primary: false, verb: 'host:export' },
    ],
  },
  options: {
    tabs: [
      { id: 'style', label: 'Style', render: 'plugin' },
      { id: 'notes', label: 'Speaker notes', render: 'plugin' },
    ],
  },
  full: { modes: null, default: 'simple' },
};

afterEach(() => { document.body.innerHTML = ''; });

describe('parseWireSurfaces (wicked-studio#791)', () => {
  it('parses the exact crew wire for wicked-deck and matches its surfaces.json declaration', () => {
    const wire = parseWireSurfaces(DECK_WIRE);
    const decl = parseSurfaces(deckSurfaces);
    expect(wire.ok).toBe(true);
    expect(decl.ok).toBe(true);
    if (!wire.ok || !decl.ok) return;
    expect(sameSurfaces(wire.value, decl.value)).toBe(true);

    // And the host negotiates protocol 2 without falling back when declared is the wire form.
    const log: HostLogEntry[] = [];
    const surfaces = vi.fn<(s: Surfaces, protocol: number, note: string | null) => void>();
    const ui: HostUi = {
      chips: vi.fn(), draft: vi.fn(), typed: vi.fn(), key: vi.fn(), morph: vi.fn(), status: vi.fn(), notes: vi.fn(),
      thread: vi.fn(), fullscreen: vi.fn(async () => true), torn: vi.fn(), log: (e) => log.push(e), surfaces,
    };
    const container = document.createElement('div');
    document.body.appendChild(container);
    const host = new EditorHost({
      container, src: 'about:blank', editor: 'wicked-deck', version: '0.9.0', name: 'Slides', title: 'Slides: Deck',
      size: 'inline', grants: ['artifact.read'], theme: {}, prefs: { reducedMotion: false, techDetails: false, locale: 'en' },
      firstParty: true, adapter: new FakeDocAdapter(), ui, declared: DECK_WIRE,
    });
    host.mount();
    vi.spyOn(host.frame.contentWindow!, 'postMessage').mockImplementation((() => undefined) as never);
    window.dispatchEvent(new MessageEvent('message', {
      data: { p: 'wicked.editor', v: 1, type: 'plugin.ready', payload: { editor: 'wicked-deck', version: '0.9.0', protocol: [1, 2], surfaces: deckSurfaces } },
      source: host.frame.contentWindow,
    }));
    expect(host.negotiated).toBe(2);
    expect(surfaces).toHaveBeenCalledWith(decl.value, 2, null);
    host.teardown('done');
  });

  it.each([
    ['wicked-page', pageSurfaces],
    ['wicked-deck', deckSurfaces],
    ['wicked-doc', docSurfaces],
    ['wicked-video', videoSurfaces],
  ] as const)('matches the wire form of %s with its surfaces.json declaration', (id, raw) => {
    const wire = parseWireSurfaces(toWire(raw as RawDecl));
    const decl = parseSurfaces(raw);
    expect(wire.ok, id).toBe(true);
    expect(decl.ok, id).toBe(true);
    if (wire.ok && decl.ok) expect(sameSurfaces(wire.value, decl.value), id).toBe(true);
  });

  it('parses { options: null, full: null } with a minimal card as no Options and no Full', () => {
    const r = parseWireSurfaces({
      card: { interactive: false, aspect: '16:9', actions: [] },
      options: null,
      full: null,
    });
    expect(r).toEqual({
      ok: true,
      value: {
        card: { interactive: false, aspect: '16:9', actions: [] },
        options: null,
        full: null,
      },
    });
  });

  it('keeps both modes and default when wire full.modes is ["simple", "advanced"]', () => {
    const r = parseWireSurfaces({
      card: { interactive: true, aspect: '16:9', actions: [] },
      options: null,
      full: { modes: ['simple', 'advanced'], default: 'advanced' },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.full).toEqual({ modes: ['simple', 'advanced'], default: 'advanced' });
  });

  it('refuses garbage in wire surfaces', () => {
    const badModes = parseWireSurfaces({
      card: { interactive: false, aspect: '16:9', actions: [] },
      options: null,
      full: { modes: 'x', default: 'simple' },
    });
    expect(badModes.ok).toBe(false);
    if (!badModes.ok) expect(badModes.reason).toMatch(/surfaces\.full\.modes/u);

    expect(parseWireSurfaces(null)).toEqual({ ok: false, reason: 'surfaces: not an object' });
    expect(parseWireSurfaces('x')).toEqual({ ok: false, reason: 'surfaces: not an object' });
  });

  it('leaves parseSurfaces (the declaration parser) unchanged: it still refuses modes: null', () => {
    const r = parseSurfaces(DECK_WIRE);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/surfaces\.full\.modes/u);

    const nullOpts = parseSurfaces({ card: {}, options: null, full: null });
    expect(nullOpts.ok).toBe(false);
  });
});
