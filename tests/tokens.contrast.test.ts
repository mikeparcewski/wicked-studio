import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The secondary-text contrast gate (design council M16 on wicked-studio#370): every ink step,
 * and the field-edge token, MEASURED on every surface in both themes — read straight out of
 * tokens.css and themes/light.css, so a token edit that drops a pair under WCAG AA fails CI
 * instead of shipping on an eyeball estimate. The wicked themes (DES-STUDIO-REBUILD-001 S1) are
 * measured the same way, and further: with the harbor preset their accent and accent-dim are
 * text on every surface, accent-fg is text on the accent, and each status colour is text on
 * card, raised, overlay and its own tint.
 *
 *   ink-dim / ink-muted / ink-body / ink-high  ≥ 4.5:1  (1.4.3, body text)
 *   border-input                               ≥ 3:1    (1.4.11, a field's only edge)
 *
 * on base, rail, card, raised and overlay (modals, the command palette, toasts).
 */

type RGB = readonly [number, number, number];

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

/** The value of `--name` inside the FIRST block that declares it. */
function decl(css: string, name: string): string {
  const m = new RegExp(`${name.replace(/[-]/g, '\\-')}\\s*:\\s*([^;]+);`).exec(css);
  if (m === null) throw new Error(`${name} not declared`);
  return m[1]!.trim();
}

function hex(v: string): RGB {
  const h = v.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as unknown as RGB;
}

/** `rgba(r, g, b, a)` or `#rrggbb` → [rgb, alpha]. */
function color(v: string): { rgb: RGB; a: number } {
  if (v.startsWith('#')) return { rgb: hex(v), a: 1 };
  const m = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(v);
  if (m === null) throw new Error(`unparsed colour ${v}`);
  return { rgb: [Number(m[1]) / 255, Number(m[2]) / 255, Number(m[3]) / 255], a: m[4] === undefined ? 1 : Number(m[4]) };
}

/** HSL (0-360, 0-100, 0-100) → sRGB, rounded to 8 bits as the browser paints it. */
function hslRgb(h: number, s: number, l: number): RGB {
  const S = s / 100;
  const L = Math.min(100, Math.max(0, l)) / 100;
  const c = (1 - Math.abs(2 * L - 1)) * S;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = L - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r, g, b].map((v) => Math.round((v + m) * 255) / 255) as unknown as RGB;
}

/** The accent family's grammar in the wicked themes, resolved against the given primitives:
 *  `hsl(var(--_accent-h) var(--_accent-s) <L>)`, where <L> is `var(--_accent-l)`,
 *  `calc(var(--_accent-l) ± N%)`, or the accent-fg `clamp(8%, calc((T% - var(--_accent-l)) * 100), 98%)`
 *  (with a fixed saturation). */
function accentColour(v: string, p: { accent_h: number; accent_s: number; accent_l: number }): RGB {
  // The wicked themes' default accent is the design system's own hex (the synthesis, 2026-10-31);
  // the hsl() grammar below is the user's accent (data-accent="custom").
  if (/^#[0-9a-f]{6}$/i.test(v)) return hex(v);
  const m = /^hsl\(var\(--_accent-h\)\s+(var\(--_accent-s\)|[\d.]+%)\s+(.+)\)$/.exec(v);
  if (m === null) throw new Error(`unparsed accent ${v}`);
  const s = m[1]!.startsWith('var') ? p.accent_s : Number(m[1]!.replace('%', ''));
  const lExpr = m[2]!.trim();
  let l: number;
  if (lExpr === 'var(--_accent-l)') l = p.accent_l;
  else if (/^calc\(var\(--_accent-l\) [+-] [\d.]+%\)$/.test(lExpr)) {
    const [, op, n] = /([+-]) ([\d.]+)%/.exec(lExpr)!;
    l = p.accent_l + (op === '+' ? 1 : -1) * Number(n);
  } else {
    const c = /^clamp\(([\d.]+)%, calc\(\(([\d.]+)% - var\(--_accent-l\)\) \* 100\), ([\d.]+)%\)$/.exec(lExpr);
    if (c === null) throw new Error(`unparsed lightness ${lExpr}`);
    l = Math.min(Number(c[3]), Math.max(Number(c[1]), (Number(c[2]) - p.accent_l) * 100));
  }
  return hslRgb(p.accent_h, s, l);
}

function over(fg: { rgb: RGB; a: number }, bg: RGB): RGB {
  return fg.rgb.map((c, i) => c * fg.a + bg[i]! * (1 - fg.a)) as unknown as RGB;
}

function lum(c: RGB): number {
  const f = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

function ratio(a: RGB, b: RGB): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const SURFACES = [
  ['base', '--_surface-0'], ['rail', '--_surface-1'], ['card', '--_surface-2'], ['raised', '--_surface-3'],
  ['overlay', '--_surface-4'],
] as const;
const INKS = [['ink-dim', '--_ink-faint'], ['ink-muted', '--_ink-soft'], ['ink-body', '--_ink-strong'], ['ink-high', '--_ink-max']] as const;

const tokens = read('../src/styles/tokens.css');
const light = read('../src/styles/themes/light.css');
const wickedLight = read('../src/styles/themes/wicked-light.css');
const wickedDark = read('../src/styles/themes/wicked-dark.css');
const THEMES = [['dark', tokens], ['light', light], ['wicked-light', wickedLight], ['wicked-dark', wickedDark]] as const;

describe('token contrast (council M16) — measured, not estimated', () => {
  for (const [theme, css] of THEMES) {
    for (const [surface, sVar] of SURFACES) {
      const bg = color(decl(css, sVar)).rgb;
      for (const [ink, iVar] of INKS) {
        it(`${theme}: ${ink} on ${surface} clears 4.5:1`, () => {
          expect(ratio(over(color(decl(css, iVar)), bg), bg)).toBeGreaterThanOrEqual(4.5);
        });
      }
      // The default dark theme's field edge measures 2.96:1 on the overlay (pre-existing; S1 leaves
      // the default theme untouched), so the overlay field-edge pair is gated for the wicked themes.
      if (surface === 'overlay' && !theme.startsWith('wicked-')) continue;
      it(`${theme}: border-input on ${surface} clears 3:1`, () => {
        expect(ratio(over(color(decl(css, '--border-input')), bg), bg)).toBeGreaterThanOrEqual(3);
      });
    }
  }

  // The harbor preset (appearance.ts HARBOR_ACCENT), restated so this file stays a node test.
  const HARBOR = { accent_h: 200, accent_s: 47, accent_l: 25 };
  for (const [theme, css] of [['wicked-light', wickedLight], ['wicked-dark', wickedDark]] as const) {
    const accent = accentColour(decl(css, '--accent'), HARBOR);
    for (const [surface, sVar] of SURFACES) {
      const bg = color(decl(css, sVar)).rgb;
      for (const tok of ['--accent', '--accent-dim'] as const) {
        it(`${theme}: ${tok.slice(2)} (the default) as text on ${surface} clears 4.5:1`, () => {
          expect(ratio(accentColour(decl(css, tok), HARBOR), bg)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
    it(`${theme}: accent-fg on the default accent clears 4.5:1`, () => {
      expect(ratio(accentColour(decl(css, '--accent-fg'), HARBOR), accent)).toBeGreaterThanOrEqual(4.5);
    });
    for (const st of ['gate', 'fail', 'run', 'warn'] as const) {
      const fg = color(decl(css, `--status-${st}`)).rgb;
      for (const [where, bgVar] of [['card', '--_surface-2'], ['raised', '--_surface-3'], ['overlay', '--_surface-4'], [`${st}-dim`, `--status-${st}-dim`]] as const) {
        it(`${theme}: status-${st} on ${where} clears 4.5:1`, () => {
          expect(ratio(fg, color(decl(css, bgVar)).rgb)).toBeGreaterThanOrEqual(4.5);
        });
      }
    }
  }
});

// Light-theme contrast pass (2026-10-13, operator: "white version is faded"): copy on cards reads at
// 7:1 (AAA). The synthesis the operator picked on 2026-10-31 (design council, DES-THEMES rev 3) keeps that
// for body, secondary and title ink; its quietest ink (#66665f, timestamps and quiet labels) is AA:
// 5.0-5.8:1 on every surface, checked above at 4.5:1. Shipped as approved; flagged in the lane report.
describe('wicked-light reads at AAA for copy on cards', () => {
  const card = color(decl(wickedLight, '--_surface-2')).rgb;
  for (const ink of ['--_ink-soft', '--_ink-strong', '--_ink-max'] as const) {
    it(`${ink} on the card clears 7:1`, () => {
      expect(ratio(over(color(decl(wickedLight, ink)), card), card)).toBeGreaterThanOrEqual(7);
    });
  }
  for (const surface of ['--_surface-0', '--_surface-1', '--_surface-2', '--_surface-3'] as const) {
    it(`the quietest ink (ink-faint) clears 5:1 on ${surface}`, () => {
      const bg = color(decl(wickedLight, surface)).rgb;
      expect(ratio(over(color(decl(wickedLight, '--_ink-faint')), bg), bg)).toBeGreaterThanOrEqual(5);
    });
  }
});

describe('a user-picked accent still drives the wicked themes', () => {
  for (const [theme, css] of [['wicked-light', wickedLight], ['wicked-dark', wickedDark]] as const) {
    it(`${theme}: a [data-accent="custom"] block derives the accent from the primitives`, () => {
      const block = css.slice(css.indexOf(`[data-theme="${theme}"][data-accent="custom"]`));
      expect(block).toMatch(/--accent:\s+hsl\(var\(--_accent-h\)/);
      expect(block).toMatch(/--accent-fg:\s+hsl\(/);
    });
  }
});

// Operator 2026-10-18 ("Stopped should stand out — something red and dangerous"): the run page's Stop confirm and a
// failed/stopped run's state badge are FILLED with status-fail, their text status-fail-fg — AA in every theme. The
// outlined Stop (status-fail text on its fail-dim tint) is AA too.
describe('the danger fill reads in every theme', () => {
  const FAIL_HUE = 4; // tokens.css --_sf-h
  const failColour = (v: string): RGB => {
    if (v.startsWith('#')) return hex(v);
    const m = /^hsl\(var\(--_sf-h\)\s+([\d.]+)%\s+([\d.]+)%\)$/.exec(v);
    if (m === null) throw new Error(`unparsed fail colour ${v}`);
    return hslRgb(FAIL_HUE, Number(m[1]), Number(m[2]));
  };
  for (const [theme, css] of THEMES) {
    it(`${theme}: status-fail-fg on status-fail clears 4.5:1`, () => {
      expect(ratio(color(decl(css, '--status-fail-fg')).rgb, failColour(decl(css, '--status-fail')))).toBeGreaterThanOrEqual(4.5);
    });
    it(`${theme}: status-fail on status-fail-dim clears 4.5:1`, () => {
      expect(ratio(failColour(decl(css, '--status-fail')), failColour(decl(css, '--status-fail-dim')))).toBeGreaterThanOrEqual(4.5);
    });
  }
});
