import { LIMITS, type Op } from './protocol.js';

/**
 * Edits, as the host checks them before anything crosses the wire (DES-EDITOR-PLUGINS-001 §5.6,
 * EP-P1). Ops are TEXT and COLOURS, never markup: the engine applies `content-edit` as HTML and
 * `style-edit` verbatim, so the host is the one gate.
 *
 *  - `text.value` is HTML-escaped (`& < > " '`).
 *  - `style` takes only `background` / `color`, each matching the colour grammar.
 *  - every anchor must be in the HOST's inventory of the current version (parsed with `DOMParser`,
 *    which runs no scripts) — never the plugin's own bridge.
 *  - `structural-change` is not an op; anything needing judgement goes through the composer.
 */

export function escapeText(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const NUM = String.raw`\s*-?(?:\d+(?:\.\d+)?|\.\d+)%?\s*`;
const COLOUR = new RegExp(
  '^(?:'
  + '#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})'
  + `|rgba?\\((?:${NUM},){2}${NUM}(?:,${NUM})?\\)`
  + `|hsla?\\(\\s*-?\\d+(?:\\.\\d+)?(?:deg)?\\s*,${NUM},${NUM}(?:,${NUM})?\\)`
  + '|var\\(--wi-[a-z0-9-]{1,40}\\)'
  + ')$',
  'i',
);

/** A colour the host lets through: hex, numeric rgb/hsl, or a learned-theme token `var(--wi-*)` the
 *  document defines. Anything else (`url(`, `;`, `}`, `expression`, a second declaration) is refused. */
export function isColour(value: string, themeTokens: ReadonlySet<string> = new Set()): boolean {
  if (!COLOUR.test(value)) return false;
  const tok = /^var\((--wi-[a-z0-9-]+)\)$/i.exec(value);
  return tok === null || themeTokens.has(tok[1]!.toLowerCase());
}

export interface Inventory {
  /** Every `data-wid` in the version, with its slide/section ancestry. */
  wids: ReadonlyMap<string, { slide: string | null; section: string | null; text: string }>;
}

/** An anchor id the wire selector `[data-wid="…"]` names exactly: the engine's ids are of this shape. */
const SAFE_WID = /^[A-Za-z0-9_.:-]{1,100}$/;

/** The host's own anchor inventory, from the version HTML it already holds. `DOMParser` runs no script.
 *  An id the selector could not name exactly, or one two elements share, is left out: an op on it
 *  could change the wrong element, or several (codex). */
export function inventoryOf(html: string): Inventory {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const wids = new Map<string, { slide: string | null; section: string | null; text: string }>();
  const seen = new Map<string, number>();
  for (const el of Array.from(doc.querySelectorAll('[data-wid]'))) {
    const id = el.getAttribute('data-wid') ?? '';
    seen.set(id, (seen.get(id) ?? 0) + 1);
  }
  for (const el of Array.from(doc.querySelectorAll('[data-wid]'))) {
    const id = el.getAttribute('data-wid');
    if (id === null || !SAFE_WID.test(id) || (seen.get(id) ?? 0) > 1 || wids.has(id)) continue;
    const slide = el.parentElement?.closest('[data-wid^="slide-"]')?.getAttribute('data-wid') ?? null;
    const section = el.parentElement?.closest('section[data-wid], [data-wid^="section-"]')?.getAttribute('data-wid') ?? null;
    wids.set(id, { slide, section, text: (el.textContent ?? '').trim().slice(0, 200) });
  }
  return { wids };
}

/** The theme tokens a document defines (`--wi-*` custom properties in its own styles). */
export function themeTokensOf(html: string): Set<string> {
  return new Set(Array.from(html.matchAll(/(--wi-[a-z0-9-]{1,40})\s*:/gi), (m) => m[1]!.toLowerCase()));
}

/** One wire item on interactive's deterministic feedback vocabulary (`feedbackBatch.ts`). */
export type WireItem =
  | { selector: string; type: 'content-edit'; value: string; before: string }
  | { selector: string; type: 'style-edit'; style: { background?: string; color?: string } }
  | { selector: string; type: 'remove' };

export type OpsCheck = { ok: true; items: WireItem[] } | { ok: false; code: 'bad_request' | 'too_large'; message: string };

// Only inventory ids reach here, and those match SAFE_WID: nothing to escape.
const selectorOf = (wid: string): string => `[data-wid="${wid}"]`;

/** Validate a plugin's ops against the host's inventory and map them to wire items, or refuse all. */
export function checkOps(ops: unknown[], inv: Inventory, themeTokens: ReadonlySet<string> = new Set()): OpsCheck {
  if (ops.length === 0) return { ok: false, code: 'bad_request', message: 'no ops' };
  if (ops.length > LIMITS.writeOps) return { ok: false, code: 'too_large', message: `more than ${LIMITS.writeOps} ops` };
  let bytes = 0;
  try { bytes = new TextEncoder().encode(JSON.stringify(ops)).length; } catch { return { ok: false, code: 'bad_request', message: 'ops are not data' }; }
  if (bytes > LIMITS.writeBytes) return { ok: false, code: 'too_large', message: 'ops are too large' };
  const items: WireItem[] = [];
  for (const raw of ops) {
    if (typeof raw !== 'object' || raw === null) return { ok: false, code: 'bad_request', message: 'an op is not an object' };
    const o = raw as Record<string, unknown>;
    const anchor = o['anchor'];
    if (typeof anchor !== 'string' || !inv.wids.has(anchor)) return { ok: false, code: 'bad_request', message: 'an op names an anchor not in this version' };
    const before = o['before'];
    if (before !== undefined && (typeof before !== 'string' || before.length > LIMITS.beforeChars)) {
      return { ok: false, code: 'bad_request', message: 'before is not text, or too long' };
    }
    switch (o['op']) {
      case 'text': {
        if (typeof o['value'] !== 'string' || typeof before !== 'string') return { ok: false, code: 'bad_request', message: 'a text op needs value and before' };
        items.push({ selector: selectorOf(anchor), type: 'content-edit', value: escapeText(o['value']), before });
        break;
      }
      case 'style': {
        const st = o['style'];
        if (typeof st !== 'object' || st === null) return { ok: false, code: 'bad_request', message: 'a style op needs style' };
        const keys = Object.keys(st);
        if (keys.length === 0 || keys.some((k) => k !== 'background' && k !== 'color')) {
          return { ok: false, code: 'bad_request', message: 'style takes only background and color' };
        }
        const style: { background?: string; color?: string } = {};
        for (const k of keys as ('background' | 'color')[]) {
          const v = (st as Record<string, unknown>)[k];
          if (typeof v !== 'string' || !isColour(v.trim(), themeTokens)) return { ok: false, code: 'bad_request', message: `${k} is not a colour` };
          style[k] = v.trim();
        }
        items.push({ selector: selectorOf(anchor), type: 'style-edit', style });
        break;
      }
      case 'remove':
        items.push({ selector: selectorOf(anchor), type: 'remove' });
        break;
      default:
        return { ok: false, code: 'bad_request', message: `unknown op ${String(o['op'])}` };
    }
  }
  return { ok: true, items };
}

export type { Op };
