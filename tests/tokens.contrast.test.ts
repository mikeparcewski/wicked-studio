import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The secondary-text contrast gate (design council M16 on wicked-studio#370): every ink step,
 * and the field-edge token, MEASURED on every surface in both themes — read straight out of
 * tokens.css and themes/light.css, so a token edit that drops a pair under WCAG AA fails CI
 * instead of shipping on an eyeball estimate. The wicked themes (DES-STUDIO-REBUILD-001 S1) are
 * measured the same way.
 *
 *   ink-dim / ink-muted / ink-body / ink-high  ≥ 4.5:1  (1.4.3, body text)
 *   border-input                               ≥ 3:1    (1.4.11, a field's only edge)
 *
 * on base, rail, card and raised.
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

const SURFACES = [['base', '--_surface-0'], ['rail', '--_surface-1'], ['card', '--_surface-2'], ['raised', '--_surface-3']] as const;
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
      it(`${theme}: border-input on ${surface} clears 3:1`, () => {
        expect(ratio(over(color(decl(css, '--border-input')), bg), bg)).toBeGreaterThanOrEqual(3);
      });
    }
  }
});
