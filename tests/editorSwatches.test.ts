import { describe, expect, it } from 'vitest';
import { checkOps, inventoryOf, isColour, type Inventory } from '../src/editors/ops.js';
import { elementLabel } from '../src/editors/model.js';
import { DEFAULT_COLOUR, themeSwatches } from '../src/editors/swatches.js';

/** EP-P3 (R-b): restyle swatches come from the page's own theme — the `--wi-*` colours interactive
 *  writes (theme.js themeCss; a learned theme lands as a version that rewrites them) — resolved to
 *  the concrete values the engine's style grammar accepts (it refuses `var(`). "Default" puts the
 *  element back on the document's own stylesheet (`revert-layer`). */

const THEMED = `<html><head><style>:root{--wi-bg:#F4F1EA;--wi-surface:#fffdf7;--wi-primary:#1f3a5f;--wi-secondary:rgb(10, 20, 30);
--wi-accent:#e4572e;--wi-text:#1b1b1b;--wi-text-secondary:#4a463c;--wi-muted:#8a8471;--wi-border:#ddd6c4;--wi-card-bg:#fffdf7;
--wi-font-body:Georgia;--wi-card-shadow:0 2px 8px rgba(0,0,0,.1)}</style></head><body></body></html>`;

describe('the swatches a page offers', () => {
  it('are the theme’s colours, in the theme’s order, concrete and once each', () => {
    const s = themeSwatches(THEMED);
    expect(s.map((x) => x.value)).toStrictEqual(['#f4f1ea', '#fffdf7', '#1f3a5f', 'rgb(10, 20, 30)', '#e4572e', '#1b1b1b', '#4a463c', '#8a8471', '#ddd6c4']);
    expect(s[2]).toStrictEqual({ token: '--wi-primary', value: '#1f3a5f', label: 'Primary' });
  });
  it('the last declaration of a token wins (a theme version appends its own block)', () => {
    expect(themeSwatches(`${THEMED}<style>:root{--wi-primary:#000000}</style>`).find((x) => x.token === '--wi-primary')!.value).toBe('#000000');
  });
  it('a value outside the colour grammar, or one naming another variable, is not offered', () => {
    const odd = '<style>:root{--wi-bg:url(x);--wi-primary:var(--wi-accent);--wi-accent:red;--wi-text:#123}</style>';
    expect(themeSwatches(odd).map((x) => x.token)).toStrictEqual(['--wi-text']);
  });
  it('a page with no theme offers none', () => {
    expect(themeSwatches('<p data-wid="a">x</p>')).toStrictEqual([]);
  });
  it('"Default" is a value the host lets through, and a style op carries it', () => {
    expect(DEFAULT_COLOUR).toBe('revert-layer');
    expect(isColour(DEFAULT_COLOUR)).toBe(true);
    const inv: Inventory = { wids: new Map([['a', { slide: null, section: null, text: 'x' }]]) };
    expect(checkOps([{ op: 'style', anchor: 'a', style: { background: 'revert-layer', color: '#1b1b1b' } }], inv))
      .toStrictEqual({ ok: true, items: [{ selector: 'a', type: 'style-edit', style: { background: 'revert-layer', color: '#1b1b1b' } }] });
    expect(isColour('revert')).toBe(false);
  });
});

describe('EP-P3: a picked section is named in words, not fused text', () => {
  it('block parts are separated in the host\u2019s inventory text; inline parts stay joined', () => {
    const inv = inventoryOf('<section data-wid="section-1"><h2 data-wid="h">How it works</h2><div><p>Free rooms come first.</p><p>Held <b>five</b> minutes.</p></div></section>');
    expect(inv.wids.get('section-1')!.text).toBe('How it works Free rooms come first. Held five minutes.');
    expect(elementLabel(inv.wids.get('section-1')!.text, 'section-1')).toBe('“How it works Free rooms come first. Hel…”');
    expect(inv.wids.get('h')!.text).toBe('How it works');
  });
});
