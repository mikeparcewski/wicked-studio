import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The Nerve Center tile's fills are theme tokens with text at WCAG AA (4.5:1) on each fill, in dark
 * (tokens.css, also wicked-dark) and light (themes/light.css, also wicked-light). DES-SYSTEM-VIEW.
 */

function tokens(file: string): Record<string, string> {
  const css = readFileSync(join(__dirname, '..', 'src', 'styles', file), 'utf8');
  const out: Record<string, string> = {};
  for (const m of css.matchAll(/(--nc-[a-z]+-[a-z]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) out[m[1]!] = m[2]!;
  return out;
}

function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

for (const [name, file] of [['dark', 'tokens.css'], ['light', 'themes/light.css']] as const) describe(`the ${name} theme`, () => {
  const t = tokens(file);
  for (const state of ['ok', 'warn', 'fail']) it(`--nc-${state}-fg is AA (4.5:1) on --nc-${state}-bg`, () => {
    const bg = t[`--nc-${state}-bg`];
    const fg = t[`--nc-${state}-fg`];
    expect(bg, `--nc-${state}-bg in ${file}`).toBeDefined();
    expect(fg, `--nc-${state}-fg in ${file}`).toBeDefined();
    expect(contrast(bg!, fg!)).toBeGreaterThanOrEqual(4.5);
  });

  // The hover and pressed fills (rail.css: `.wk-rail .wk-nc-tile:hover/:active`) keep the words AA.
  // How far they sit from the rest fill is measured in the browser (e2e/desk_rail_hover_test.py).
  for (const state of ['ok', 'warn', 'fail']) for (const step of ['hover', 'press']) it(`--nc-${state}-fg is AA (4.5:1) on --nc-${state}-${step}`, () => {
    const fill = t[`--nc-${state}-${step}`];
    expect(fill, `--nc-${state}-${step} in ${file}`).toBeDefined();
    expect(fill).not.toBe(t[`--nc-${state}-bg`]);
    expect(contrast(fill!, t[`--nc-${state}-fg`]!)).toBeGreaterThanOrEqual(4.5);
  });

  it('the three fills are three different colours', () => {
    expect(new Set([t['--nc-ok-bg'], t['--nc-warn-bg'], t['--nc-fail-bg']]).size).toBe(3);
  });
});
