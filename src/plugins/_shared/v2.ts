/**
 * The plugin side of `wicked.editor/2` (DES-EDITOR-PLUGIN-CONTRACT-001 §4-§6), shared by the first-party plugins.
 * Framework-free and pure apart from the port it is given; bundled into each plugin's one HTML file.
 *
 * What it does for a plugin:
 *  - `readyPayload` says `protocol: [1, 2]` and echoes the plugin's declared surfaces (the same object its
 *    `editor.json` carries, imported from the plugin's `surfaces.json`, so the two can't drift);
 *  - `helloOf` reads the v2 fields of `host.hello` (surface, tab, mode), with v1 sizes mapped for a v1 host;
 *  - `V2Port.dispatch` answers the v2 host messages (`host.surface`, `host.mode`, `host.action`, `host.tab`,
 *    `host.selection`, `options.changed`) through the plugin's handlers, and returns false for anything else so
 *    the plugin's own v1 switch still runs;
 *  - `V2Port.values` publishes a controls tab's truth as `options.values` with a per-tab `rev` that only grows.
 *
 * A plugin never names a host decision: it only answers what the host asks and acts through its granted requests.
 */

import { isForwardable } from '../../editors/keys.js';

export const PROTOCOL = 'wicked.editor';
export const ENVELOPE = 1;

export type Surface = 'card' | 'options' | 'full';
export type Mode = 'simple' | 'advanced';
export type Size = 'inline' | 'pane' | 'full';

export interface Envelope { p: string; v: number; type?: string; id?: string; re?: string; ok?: boolean; payload?: unknown; error?: { code: string; message: string } }

/** What `host.hello` told this instance. A v1 host sends only `size`: it is mapped (inline → card, pane → options). */
export interface Hello { protocol: number; surface: Surface; tab: string | null; mode: Mode | null; size: Size }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const SURFACES: readonly Surface[] = ['card', 'options', 'full'];

export function surfaceOfSize(size: Size): Surface {
  return size === 'inline' ? 'card' : size === 'pane' ? 'options' : 'full';
}

/** The v1 size a surface is drawn like, for the plugin's own layout code. */
export function sizeOfSurface(surface: Surface): Size {
  return surface === 'card' ? 'inline' : surface === 'options' ? 'pane' : 'full';
}

export function helloOf(payload: unknown): Hello {
  const p = isObj(payload) ? payload : {};
  const size: Size = p['size'] === 'inline' || p['size'] === 'full' ? p['size'] : 'pane';
  const protocol = p['protocol'] === 2 ? 2 : 1;
  const tab = protocol === 2 && typeof p['tab'] === 'string' ? p['tab'] : null;
  const asked = protocol === 2 && SURFACES.includes(p['surface'] as Surface) ? p['surface'] as Surface : surfaceOfSize(size);
  // An options instance always names its tab (DES §4). A host that mounts a v2 plugin at the v1 `pane` size with no
  // tab (the conformance host, an older host) is asking for the editor: give it the full editor, not an empty tab.
  const surface: Surface = asked === 'options' && tab === null ? 'full' : asked;
  const mode = protocol === 2 && (p['mode'] === 'simple' || p['mode'] === 'advanced') ? p['mode'] : null;
  return { protocol, surface, tab, mode, size };
}

export function readyPayload(editor: string, version: string, surfaces: unknown): Record<string, unknown> {
  return { editor, version, protocol: [1, 2], surfaces };
}

/** Sends `plugin.ready` to the parent: the one window message. */
export function announceReady(editor: string, surfaces: unknown): void {
  const version = document.querySelector('meta[name="wicked-editor-version"]')?.getAttribute('content') ?? '0.0.0';
  parent.postMessage({ p: PROTOCOL, v: ENVELOPE, type: 'plugin.ready', payload: readyPayload(editor, version, surfaces) }, '*');
}

/** Options controls keep their native keys; host chords and Tab at either boundary leave the frame. */
export function forwardOptionsKey(e: KeyboardEvent, root: HTMLElement, send: (key: string) => void): boolean {
  const mod = e.metaKey || e.ctrlKey;
  let key: string | null = null;
  if (e.key === 'Escape') key = 'Escape';
  else if (mod && !e.altKey && e.key.toLowerCase() === 'k') key = 'Mod+K';
  // Only the host's navigation chords: any other Alt chord is dropped by the host, and three drops tear the frame
  // down (agy h4b-r1). Option+letter stays the platform's character.
  else if (e.altKey && !mod && /^Key[A-Z]$/.test(e.code) && isForwardable(`Alt+${e.code.slice(3)}`)) key = `Alt+${e.code.slice(3)}`;
  else if (e.key === 'Tab') {
    const controls = Array.from(root.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex]'))
      .filter((c) => c.tabIndex >= 0 && !c.matches(':disabled') && c.closest('[hidden]') === null);
    const at = controls.indexOf(e.target as HTMLElement);
    if (e.shiftKey ? at <= 0 : at === -1 || at === controls.length - 1) key = e.shiftKey ? 'Shift+Tab' : 'Tab';
  }
  if (key === null) return false;
  e.preventDefault();
  e.stopPropagation();
  send(key);
  return true;
}

export interface OptionsReply { applied: boolean; values: Record<string, unknown>; reason?: string }

/** The plugin's answers to the v2 host messages. Each is optional: an unhandled request still gets a reply. */
export interface V2Handlers {
  /** The card ↔ full morph of this instance (`host.surface`). */
  surface?(surface: Surface, mode: Mode | null): void;
  /** Simple/Advanced: return the mode now shown (the host asserts the echo). */
  mode?(mode: Mode): Mode;
  /** A declared `verb:"plugin"` card action the operator clicked in the host's chrome. No activation comes with it. */
  action?(id: string): Promise<{ handled: boolean; status?: string }> | { handled: boolean; status?: string };
  /** The options instance's plugin tab now shown. */
  tab?(tab: string): void;
  /** Another instance of this artifact pointed (ids only). */
  selection?(anchors: unknown[]): void;
  /** A host-rendered control changed. Return the tab's whole truth after it, applied or not. */
  optionsChanged?(tab: string, id: string, value: unknown): Promise<OptionsReply> | OptionsReply;
}

export class V2Port {
  private revs = new Map<string, number>();
  constructor(private port: MessagePort, private h: V2Handlers) {}

  private reply(re: string, payload: unknown): void { this.port.postMessage({ p: PROTOCOL, v: ENVELOPE, re, ok: true, payload }); }
  private refuse(re: string, code: string, message: string): void { this.port.postMessage({ p: PROTOCOL, v: ENVELOPE, re, ok: false, error: { code, message } }); }

  /** The next `rev` for a tab: every snapshot the plugin sends (event or reply) carries a higher one. */
  private bump(tab: string): number {
    const r = (this.revs.get(tab) ?? 0) + 1;
    this.revs.set(tab, r);
    return r;
  }

  /** Publish a controls tab's values (`options.values`). */
  values(tab: string, values: Record<string, unknown>): void {
    this.port.postMessage({ p: PROTOCOL, v: ENVELOPE, type: 'options.values', payload: { tab, rev: this.bump(tab), values } });
  }

  /** A card with `aspect:"auto"`: the height it wants (the host clamps it to 120-560). */
  height(px: number): void {
    this.port.postMessage({ p: PROTOCOL, v: ENVELOPE, type: 'ui.height', payload: { px: Math.round(px) } });
  }

  /** Handle one host message if it is a v2 one. Returns false when it is not (the caller's v1 switch runs). */
  dispatch(d: Envelope): boolean {
    const p = isObj(d.payload) ? d.payload : {};
    const id = typeof d.id === 'string' ? d.id : null;
    switch (d.type) {
      case 'host.surface': {
        const s = p['surface'];
        if (s === 'card' || s === 'options' || s === 'full') this.h.surface?.(s, p['mode'] === 'simple' || p['mode'] === 'advanced' ? p['mode'] : null);
        return true;
      }
      case 'host.mode': {
        if (id === null) return true;
        const m = p['mode'];
        if (m !== 'simple' && m !== 'advanced') { this.refuse(id, 'bad_request', 'mode is simple or advanced'); return true; }
        this.reply(id, { mode: this.h.mode?.(m) ?? m });
        return true;
      }
      case 'host.action': {
        if (id === null) return true;
        const aid = p['id'];
        if (typeof aid !== 'string' || this.h.action === undefined) { this.reply(id, { handled: false }); return true; }
        void Promise.resolve(this.h.action(aid)).then(
          (r) => this.reply(id, { handled: r.handled === true, ...(typeof r.status === 'string' ? { status: r.status.slice(0, 120) } : {}) }),
          () => this.reply(id, { handled: false }),
        );
        return true;
      }
      case 'host.tab':
        if (typeof p['tab'] === 'string') this.h.tab?.(p['tab']);
        return true;
      case 'host.selection':
        if (Array.isArray(p['anchors'])) this.h.selection?.(p['anchors']);
        return true;
      case 'options.changed': {
        if (id === null) return true;
        const tab = p['tab'];
        const cid = p['id'];
        if (typeof tab !== 'string' || typeof cid !== 'string' || this.h.optionsChanged === undefined) {
          this.refuse(id, 'unsupported', 'no controls here');
          return true;
        }
        void Promise.resolve(this.h.optionsChanged(tab, cid, p['value'])).then(
          (r) => this.reply(id, { applied: r.applied, rev: this.bump(tab), values: r.values, ...(r.reason !== undefined ? { reason: r.reason.slice(0, 120) } : {}) }),
          (e: unknown) => this.refuse(id, 'unavailable', e instanceof Error ? e.message.slice(0, 120) : 'failed'),
        );
        return true;
      }
      default:
        return false;
    }
  }
}
