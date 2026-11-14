/**
 * The graph ring hop-colours (Graph rings), measured. Each --graph-level-1..5 must:
 *   - clear 3:1 against --surface-base and --surface-rail in wicked-dark and wicked-light
 *     (the hop colour is a line/outline on the page and the rail);
 *   - sit ≥0.08 ΔE_OK from its neighbour (adjacent levels read apart);
 *   - sit ≥0.10 ΔE_OK from every status colour (gate / fail / run / warn), so a hop never
 *     masquerades as a status.
 *
 * The dark set lives in tokens.css (the wicked-dark base inherits it); the light set in
 * themes/light.css (which also drives wicked-light). The surfaces and status colours are read from
 * each wicked theme file. A token edit that drops a pair under the floor fails CI here.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type RGB = readonly [number, number, number];

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), 'utf8');
}

/** The value of `--name` in the LAST block that declares it — the effective cascade value. */
function decl(css: string, name: string): string {
  const re = new RegExp(`${name.replace(/-/g, '\\-')}\\s*:\\s*([^;]+);`, 'g');
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = re.exec(css)) !== null) last = m[1]!.trim();
  if (last === null) throw new Error(`${name} not declared`);
  return last;
}

function hex(v: string): RGB {
  const h = v.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as unknown as RGB;
}

function lum(c: RGB): number {
  const f = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
}

function ratio(a: RGB, b: RGB): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** sRGB → OKLab (Björn Ottosson). */
function oklab(c: RGB): RGB {
  const f = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = c.map(f) as [number, number, number];
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.793617785 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.428592205 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.808675766 * s_,
  ];
}

/** ΔE in OKLab — Euclidean distance (ΔE_OK). */
function dE(a: RGB, b: RGB): number {
  const A = oklab(a), B = oklab(b);
  return Math.hypot(A[0] - B[0], A[1] - B[1], A[2] - B[2]);
}

const LEVELS = ['--graph-level-1', '--graph-level-2', '--graph-level-3', '--graph-level-4', '--graph-level-5'] as const;
const STATUS = ['--status-gate', '--status-fail', '--status-run', '--status-warn'] as const;

// wicked-dark inherits the dark graph set from tokens.css; wicked-light the light set from themes/light.css.
const tokens = read('../src/styles/tokens.css');
const light = read('../src/styles/themes/light.css');
const wickedDark = read('../src/styles/themes/wicked-dark.css');
const wickedLight = read('../src/styles/themes/wicked-light.css');

const THEMES = [
  { name: 'wicked-dark', graphCss: tokens, themeCss: wickedDark },
  { name: 'wicked-light', graphCss: light, themeCss: wickedLight },
] as const;

describe('graph ring hop-colours — measured, not estimated', () => {
  for (const { name, graphCss, themeCss } of THEMES) {
    const levels = LEVELS.map((n) => hex(decl(graphCss, n)));
    const base = hex(decl(themeCss, '--surface-base'));
    const rail = hex(decl(themeCss, '--surface-rail'));
    const statuses = STATUS.map((n) => hex(decl(themeCss, n)));

    levels.forEach((c, i) => {
      it(`${name}: graph-level-${i + 1} clears 3:1 on base and rail`, () => {
        expect(ratio(c, base)).toBeGreaterThanOrEqual(3);
        expect(ratio(c, rail)).toBeGreaterThanOrEqual(3);
      });
      it(`${name}: graph-level-${i + 1} is ≥0.10 ΔE_OK from every status colour`, () => {
        for (let s = 0; s < statuses.length; s++) {
          expect(dE(c, statuses[s]!)).toBeGreaterThanOrEqual(0.1);
        }
      });
    });

    for (let i = 1; i < levels.length; i++) {
      it(`${name}: graph-level-${i} and graph-level-${i + 1} are ≥0.08 ΔE_OK apart`, () => {
        expect(dE(levels[i - 1]!, levels[i]!)).toBeGreaterThanOrEqual(0.08);
      });
    }
  }
});
