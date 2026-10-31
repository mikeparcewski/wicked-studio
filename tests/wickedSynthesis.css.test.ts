import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The synthesis sets labels in sentence case (DES-THEMES rev 3). themes/wicked-synthesis.css lists every
 * uppercase label rule in src/styles (the slide deck excluded: its eyebrows are document content). A new
 * uppercase label that is not listed would ship uppercase under the default theme; this test fails first.
 */
const STYLES = join(process.cwd(), 'src/styles');
function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? cssFiles(p) : f.endsWith('.css') ? [p] : [];
  });
}
const synthesis = readFileSync(join(STYLES, 'themes/wicked-synthesis.css'), 'utf8');

describe('wicked-synthesis.css: sentence-case labels', () => {
  const upper: string[] = [];
  for (const f of cssFiles(STYLES)) {
    if (f.endsWith('deck.css') || f.includes('/themes/')) continue;
    const css = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/text-transform:\s*uppercase/.test(m[2]!)) continue;
      for (const sel of m[1]!.split(',').map((x) => x.trim()).filter((x) => x && !x.startsWith('@'))) upper.push(sel);
    }
  }
  it('finds the uppercase label rules', () => { expect(upper.length).toBeGreaterThan(20); });
  for (const sel of new Set(upper)) {
    it(`covers ${sel}`, () => { expect(synthesis).toContain(`[data-theme="wicked-dark"]) ${sel}`); });
  }
  it("applies only under the wicked themes", () => {
    for (const m of synthesis.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{/g)) {
      expect(m[1]!.trim()).toMatch(/^(:is\(\[data-theme="wicked-light"\], \[data-theme="wicked-dark"\]\)|\[data-theme="wicked-(light|dark)"\])/);
    }
  });
});
