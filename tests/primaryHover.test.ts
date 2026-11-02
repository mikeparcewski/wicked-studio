/**
 * A primary button's hover is a visible step in both wicked themes, from one token (operator 2026-11-01: New job on
 * Jobs barely moved in Wicked Dark, dE 0.003). The step is at least 0.08 in OKLab off the accent, and the button's
 * words stay at 4.5:1 or better on it. Every primary button's hover reads the token.
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');
const lin = (v: number): number => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => lin(Number.parseInt(hex.slice(i, i + 2), 16))) as [number, number, number];
const oklab = (hex: string): number[] => {
  const [r, g, b] = rgb(hex);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
};
const dE = (a: string, b: string): number => { const [x, y] = [oklab(a), oklab(b)]; return Math.hypot(x[0]! - y[0]!, x[1]! - y[1]!, x[2]! - y[2]!); };
const lum = (hex: string): number => { const [r, g, b] = rgb(hex); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: string, b: string): number => { const [x, y] = [lum(a), lum(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

describe('the primary hover', () => {
  for (const theme of ['wicked-dark', 'wicked-light']) {
    it(`${theme}: a visible step off the accent, its words AA`, () => {
      const base = read(`src/styles/themes/${theme}.css`).split('[data-accent="custom"]')[0]!;
      const tok = (name: string): string => new RegExp(`--${name}:\\s*(#[0-9a-f]{6});`, 'iu').exec(base)?.[1] ?? '';
      const [accent, fg, hover] = [tok('accent'), tok('accent-fg'), tok('primary-hover')];
      expect(hover, 'a hex token').toMatch(/^#[0-9a-f]{6}$/iu);
      expect(dE(accent, hover)).toBeGreaterThanOrEqual(0.08);
      expect(contrast(fg, hover)).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('every primary button hovers to the token', () => {
    const css = ['components.css', 'sections/jobs-repos.css', 'sections/home.css', 'sections/calm-ue.css', 'sections/editor-host.css']
      .map((f) => read(`src/styles/${f}`)).join('\n');
    // the hover rules that paint (the reduced-motion ones only drop the lift)
    const rules = [...css.matchAll(/\.wk-(?:jr-|home-|ue-|host-)?btn--primary:hover:not\(:disabled\)\s*\{([^}]*)\}/gu)].filter((r) => /background/u.test(r[1]!));
    expect(rules).toHaveLength(5);
    for (const r of rules) expect(r[1]).toMatch(/background:\s*var\(--primary-hover\)/u);
    // the calm pages' primary reads it through their own name
    expect(read('src/styles/sections/calm.css')).toMatch(/^\s*--calm-primary-hover: var\(--primary-hover\);/mu);
  });
});
