/**
 * Round-3 look on :7721: the run page's document scrolled to 1000 px at a 700 px window. The plugin sections' screen-
 * reader words (absolutely placed) took the viewport as their containing block, escaping the Details panel's scroll
 * container. The panel body must be their containing block: it scrolls, the document does not.
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('../src/styles/sections/editor-host.css', import.meta.url)), 'utf8');

describe('the Details panel contains what it scrolls', () => {
  it('its scroll container is positioned, so absolutely placed descendants scroll and clip with it', () => {
    const i = css.indexOf('.wk-hpanel-body {');
    const rule = css.slice(i, css.indexOf('}', i));
    expect(rule).toContain('overflow: auto');
    expect(rule).toContain('min-height: 0');
    expect(rule).toMatch(/position:\s*relative/u);
  });
});
