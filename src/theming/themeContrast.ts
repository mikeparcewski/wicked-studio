import { hasCustomAccent, type StudioAppearance } from './appearance.js';

/**
 * THE CONTRAST CHECK OF A THEME PROPOSAL (DES-CHAT-ARTIFACTS-001 §9, slice A7): measured by studio on a RENDERED probe
 * before Preview is offered and again before Apply, always on the exact merged result (the current appearance plus the
 * accumulated delta). The probe is a hidden element carrying the appearance's `data-theme`, `data-accent` and accent
 * primitives, so the real theme stylesheets resolve its colours; nothing on the page changes.
 *
 * Text needs 4.5:1 (body text on the ground, the words on the action colour); the action colour needs 3:1 (on the
 * ground and on cards). A result that can't be measured (no layout engine, a colour studio can't read) is not passed.
 */

export interface ThemeColors {
  ground: string;
  card: string;
  action: string;
  onAction: string;
  body: string;
}

export interface ThemeContrast {
  /** Action colour on the ground, on cards; words on the action colour; body text on the ground. */
  ground: number;
  cards: number;
  onAction: number;
  body: number;
}

export interface ContrastCheck {
  /** `null`: it could not be measured here. */
  ratios: ThemeContrast | null;
  colors: ThemeColors | null;
  ok: boolean;
  /** The failing measurements as words ("action colour on cards 2.1:1, needs 3:1"); empty when it passes. */
  failing: string[];
}

const TOKENS: Readonly<Record<keyof ThemeColors, string>> = {
  ground: '--surface-base',
  card: '--surface-card',
  action: '--accent',
  onAction: '--accent-fg',
  body: '--ink-body',
};

export const NEEDS = { ground: 3, cards: 3, onAction: 4.5, body: 4.5 } as const;

type Rgba = [number, number, number, number];

/** A computed CSS colour as RGBA 0-255 (alpha 0-1): `rgb()`/`rgba()` (comma or space syntax) or `color(srgb …)`. */
export function parseCssColor(raw: string): Rgba | null {
  const s = raw.trim().toLowerCase();
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (rgb !== null) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith('%') ? Number(rgb[4].slice(0, -1)) / 100 : Number(rgb[4]);
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), a];
  }
  const srgb = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (srgb !== null) {
    const a = srgb[4] === undefined ? 1 : srgb[4].endsWith('%') ? Number(srgb[4].slice(0, -1)) / 100 : Number(srgb[4]);
    return [Number(srgb[1]) * 255, Number(srgb[2]) * 255, Number(srgb[3]) * 255, a];
  }
  const hex = /^#([0-9a-f]{6})$/.exec(s);
  if (hex !== null) {
    const n = parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  return null;
}

/** A colour with alpha, laid over an opaque one. */
function over(fg: Rgba, bg: Rgba): Rgba {
  const a = Math.min(1, Math.max(0, fg[3]));
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
}

function luminance(c: Rgba): number {
  const ch = (v: number): number => {
    const x = Math.min(255, Math.max(0, v)) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
}

/** WCAG 2 contrast ratio of two colours (the first laid over the second when it has alpha). */
export function contrastRatio(fg: Rgba, bg: Rgba): number {
  const f = fg[3] < 1 ? over(fg, bg) : fg;
  const a = luminance(f);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** The probe: the computed colour of each token under this appearance, or `null` where there is no layout engine. */
export type ThemeProbe = (a: StudioAppearance) => ThemeColors | null;

export const domThemeProbe: ThemeProbe = (a) => {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return null;
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.setAttribute('data-theme', a.theme);
  if (hasCustomAccent(a)) host.setAttribute('data-accent', 'custom');
  host.style.cssText = 'position:fixed;left:-10000px;top:0;width:1px;height:1px;overflow:hidden;visibility:hidden;pointer-events:none';
  host.style.setProperty('--_accent-h', String(a.accent_h));
  host.style.setProperty('--_accent-s', `${a.accent_s}%`);
  host.style.setProperty('--_accent-l', `${a.accent_l}%`);
  const spans = (Object.keys(TOKENS) as Array<keyof ThemeColors>).map((k) => {
    const el = document.createElement('span');
    el.style.color = `var(${TOKENS[k]})`;
    host.appendChild(el);
    return [k, el] as const;
  });
  document.body.appendChild(host);
  try {
    const out = {} as ThemeColors;
    for (const [k, el] of spans) {
      const c = getComputedStyle(el).color.trim();
      if (parseCssColor(c) === null) return null;
      out[k] = c;
    }
    return out;
  } finally {
    host.remove();
  }
};

let probe: ThemeProbe = domThemeProbe;

/** Tests: measure with a fixed probe (jsdom resolves no stylesheet colours). `null` restores the DOM probe. */
export function setThemeProbe(p: ThemeProbe | null): void {
  probe = p ?? domThemeProbe;
  cache.clear();
}

const cache = new Map<string, ContrastCheck>();
const keyOf = (a: StudioAppearance): string => `${a.theme}|${a.accent_h}|${a.accent_s}|${a.accent_l}`;

const fmt = (n: number): string => `${(Math.floor(n * 10) / 10).toFixed(1)}:1`;

/** Measure an appearance (only the ground and the accent move these colours; Ambient does not). */
export function measureTheme(a: StudioAppearance): ContrastCheck {
  const key = keyOf(a);
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const colors = probe(a);
  const parsed = colors === null ? null : {
    ground: parseCssColor(colors.ground), card: parseCssColor(colors.card), action: parseCssColor(colors.action),
    onAction: parseCssColor(colors.onAction), body: parseCssColor(colors.body),
  };
  let out: ContrastCheck;
  if (parsed === null || Object.values(parsed).some((c) => c === null)) {
    out = { ratios: null, colors, ok: false, failing: ['Studio couldn’t measure this theme’s contrast here'] };
  } else {
    const p = parsed as Record<keyof ThemeColors, Rgba>;
    const action = p.action[3] < 1 ? over(p.action, p.ground) : p.action;
    const ratios: ThemeContrast = {
      ground: contrastRatio(action, p.ground),
      cards: contrastRatio(p.action[3] < 1 ? over(p.action, p.card) : p.action, p.card),
      onAction: contrastRatio(p.onAction, action),
      body: contrastRatio(p.body, p.ground),
    };
    const failing: string[] = [];
    if (ratios.ground < NEEDS.ground) failing.push(`action colour on the ground ${fmt(ratios.ground)}, needs ${NEEDS.ground}:1`);
    if (ratios.cards < NEEDS.cards) failing.push(`action colour on cards ${fmt(ratios.cards)}, needs ${NEEDS.cards}:1`);
    if (ratios.onAction < NEEDS.onAction) failing.push(`text on the action colour ${fmt(ratios.onAction)}, needs ${NEEDS.onAction}:1`);
    if (ratios.body < NEEDS.body) failing.push(`body text ${fmt(ratios.body)}, needs ${NEEDS.body}:1`);
    out = { ratios, colors, ok: failing.length === 0, failing };
  }
  if (cache.size > 64) cache.clear();
  cache.set(key, out);
  return out;
}

/** "Action colour on the ground 8.7:1 and on cards 8.1:1 · text on it 8.6:1 · body text 12.0:1" (mockup e). */
export function contrastWords(c: ContrastCheck): string {
  if (c.ratios === null) return c.failing.join('; ');
  const r = c.ratios;
  return `Action colour on the ground ${fmt(r.ground)} and on cards ${fmt(r.cards)} · text on it ${fmt(r.onAction)} · body text ${fmt(r.body)}`;
}
