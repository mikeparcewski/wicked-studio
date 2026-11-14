/**
 * Generate tests/fixtures/ringLabelAdvances.json — the per-character advance table the label-geometry
 * unit tests measure with, so they run deterministically in node (no canvas, no fonts).
 *
 * NOTE ON PROVENANCE: the spec wants this table generated once in a browser from the bundled fonts
 * via `ctx.measureText(ch).width` at the caption size (12px) for Wicked Sans and JetBrains Mono. This
 * environment has no browser and the fonts ship as brotli woff2 (no fonttools), so the values below
 * are a documented NOMINAL model (Inter-like proportional metrics for the sans; a fixed mono advance)
 * rounded to 0.1px. They are good enough for the deterministic collision/priority/LOD tests, which
 * assert coarse outcomes, not pixel-exact widths. Regenerate in a browser for pixel fidelity:
 *
 *   // in a page that has the fonts loaded, at 12px:
 *   const ctx = document.createElement('canvas').getContext('2d');
 *   ctx.font = "12px 'Wicked Sans'";  // then 12px 'JetBrains Mono'
 *   for (const ch of CHARS) table[ch] = Math.round(ctx.measureText(ch).width * 10) / 10;
 *
 * Run: node scripts/graph/gen-label-advances.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SIZE = 12; // caption px

// Nominal Inter-ish proportional advances at 12px, by width class.
const SANS = (() => {
  const t = {};
  const narrow = 'iIl|.,:;\'!ij'; // ~3px
  const mediumNarrow = 'ftr()[]{}/\\ '; // ~4px
  const wide = 'mwMW'; // ~9.5px
  const semiWide = 'GHKNOQRUD@'; // ~8.2px
  for (let c = 32; c < 127; c++) {
    const ch = String.fromCharCode(c);
    let w = 6.7; // default lowercase / digit
    if (narrow.includes(ch)) w = 3.1;
    else if (mediumNarrow.includes(ch)) w = 4.0;
    else if (wide.includes(ch)) w = 9.5;
    else if (semiWide.includes(ch)) w = 8.2;
    else if (ch >= 'A' && ch <= 'Z') w = 7.6;
    else if (ch >= '0' && ch <= '9') w = 7.0;
    t[ch] = Math.round(w * 10) / 10;
  }
  t['…'] = 11.0;
  return t;
})();

// JetBrains Mono is monospaced: one advance for every glyph at 12px.
const MONO = (() => {
  const t = {};
  for (let c = 32; c < 127; c++) t[String.fromCharCode(c)] = 7.2;
  t['…'] = 7.2;
  return t;
})();

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '..', '..', 'tests', 'fixtures', 'ringLabelAdvances.json');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify({ size: SIZE, sans: SANS, mono: MONO }, null, 2)}\n`);
console.log(`wrote ${out}`);
