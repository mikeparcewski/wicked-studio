/**
 * B-P12: at a phone width (<= 640 px) the floating chat button (the Ask launcher) overlaps a page's own
 * bottom composer (Understand's Ask). It must stand down there — a CSS rule scoped to that selector.
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../src/styles/sections/desk.css', import.meta.url)), 'utf8');

describe('the floating chat button stands down where a page owns the bottom corner', () => {
  it('a <= 640px rule hides the Ask launcher on a page with its own composer (Understand)', () => {
    const block = /@media\s*\(max-width:\s*640px\)\s*\{[^}]*\[data-testid="ask-launcher"\][^}]*display:\s*none[^}]*\}/s;
    expect(css).toMatch(block);
    expect(css).toMatch(/understand-page/);
  });
});
