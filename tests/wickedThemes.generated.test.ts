import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import tokens from '../src/vendor/wicked-design/dist/tokens.json';
import vendored from '../src/vendor/wicked-design/VENDORED.json';

/**
 * The default (wicked) themes are generated from the vendored wicked-design package (the design
 * council's synthesis, picked 2026-10-31): scripts/gen-wicked-themes.mjs writes themes/wicked-*.css
 * from src/vendor/wicked-design/dist/tokens.json. Hand edits, or a re-vendor without regenerating,
 * fail here.
 */
const read = (rel: string): string => readFileSync(join(process.cwd(), 'tests', rel), 'utf8');

describe('wicked themes come from the vendored design system', () => {
  it('the generated theme files are current', () => {
    expect(() => execFileSync('node', ['scripts/gen-wicked-themes.mjs', '--check'], { cwd: process.cwd(), encoding: 'utf8' })).not.toThrow();
  });

  it('the vendored dist/ is tracked by git (the root .gitignore ignores dist/; studio imports these files)', () => {
    const tracked = execFileSync('git', ['ls-files', 'src/vendor/wicked-design/dist'], { cwd: process.cwd(), encoding: 'utf8' });
    for (const f of ['tokens.json', 'tokens.css']) expect(tracked).toContain(`src/vendor/wicked-design/dist/${f}`);
  });

  it('the vendored copy names the wicked-web commit it came from', () => {
    expect(vendored.name).toBe('wicked-design');
    expect(vendored.commit).toMatch(/^[0-9a-f]{40}$/);
  });

  for (const theme of ['light', 'dark'] as const) {
    const css = read(`../src/styles/themes/wicked-${theme}.css`);
    const t = (tokens.themes as Record<string, Record<string, string>>)[theme]!;
    it(`wicked-${theme}: studio's primitives are the package's values`, () => {
      expect(css).toContain(`--_surface-0: ${t['surface-base']};`);
      expect(css).toContain(`--_surface-1: ${t['surface-rail']};`);
      expect(css).toContain(`--_surface-2: ${t['surface-card']};`);
      expect(css).toContain(`--_ink-max: ${t['ink-high']};`);
      expect(css).toContain(`--_ink-faint: ${t['ink-dim']};`);
      expect(css).toContain(`--accent: ${t.accent};`);
    });
    it(`wicked-${theme}: Inter, 14px body, the synthesis radii`, () => {
      expect(css).toMatch(/--font-sans: 'Inter'/);
      expect(css).toContain('--text-md: 14px;');
      expect(css).toContain('--radius-lg: 8px;');
    });
  }
});
