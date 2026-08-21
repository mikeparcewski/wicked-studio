import { describe, expect, it } from 'vitest';
import { adaptLearnedTokens } from '../src/theming/learnedTheme.js';
import { mapBrandTheme } from '../src/theming/brandMapper.js';

/**
 * The adapter between the interactive#181 readback shape (nested
 * `tokens.colors.*`, partials legal) and the resurrected mapper's flat
 * BrandPalette. Pure shape-folding — no §4.5 logic — plus the one honesty
 * rule: no usable brand color is an ERROR, never a silent default accent.
 */

const FULL_TOKENS = {
  name: 'acme-brand',
  colors: {
    background: '#f8fafc', surface: '#ffffff', primary: '#0a2a5e',
    secondary: '#0e7490', accent: '#22c55e', text_primary: '#1e293b',
  },
  fonts: { heading: 'Georgia', body: 'Georgia', mono: 'Menlo' },
};

describe('adaptLearnedTokens — nested readback → mapper input', () => {
  it('folds colors.primary/secondary onto the flat palette, name carried', () => {
    const out = adaptLearnedTokens(FULL_TOKENS);
    expect(out).toEqual({
      ok: true,
      palette: { name: 'acme-brand', primary: '#0a2a5e', secondary: '#0e7490' },
    });
  });

  it('the adapted palette feeds the mapper exactly like the historical flat shape', () => {
    const out = adaptLearnedTokens(FULL_TOKENS);
    if (!out.ok) throw new Error('expected ok');
    // #0a2a5e is the fixture navy the old suite pinned: hue 217 preserved,
    // lightness clamped + raised for the contrast floor — both disclosed.
    const mapped = mapBrandTheme(out.palette);
    expect(mapped.accent_h).toBe(217);
    expect(mapped.adjustments.some((a) => a.constraint === 'lightness-clamp')).toBe(true);
    expect(mapped.adjustments.some((a) => a.constraint === 'contrast-floor')).toBe(true);
    expect(mapped.logo_url).toBeNull(); // the learned shape carries no logo
  });

  it('partial tokens are legal: primary alone is enough', () => {
    const out = adaptLearnedTokens({ name: 'p', colors: { primary: '#22c55e' } });
    expect(out).toEqual({ ok: true, palette: { name: 'p', primary: '#22c55e' } });
  });

  it('missing primary falls to secondary, then accent, on the secondary channel', () => {
    expect(adaptLearnedTokens({ colors: { secondary: '#0e7490' } })).toEqual({
      ok: true, palette: { name: 'learned-theme', secondary: '#0e7490' },
    });
    expect(adaptLearnedTokens({ colors: { accent: '#0e7490' } })).toEqual({
      ok: true, palette: { name: 'learned-theme', secondary: '#0e7490' },
    });
    // …and the mapper DISCLOSES that the accent derives from the fallback (§4.4).
    const out = adaptLearnedTokens({ colors: { accent: '#0a2a5e' } });
    if (!out.ok) throw new Error('expected ok');
    const mapped = mapBrandTheme(out.palette);
    expect(mapped.adjustments.some((a) => a.constraint === 'source-fallback')).toBe(true);
    expect(mapped.accent_h).toBe(217);
  });

  it('an unparseable primary is skipped, not passed through', () => {
    const out = adaptLearnedTokens({
      colors: { primary: 'linear-gradient(red, blue)', secondary: '#0e7490' },
    });
    expect(out).toEqual({ ok: true, palette: { name: 'learned-theme', secondary: '#0e7490' } });
  });

  it('no usable brand color at all → an honest error, never a silent default', () => {
    for (const tokens of [
      {},                                              // nothing at all
      { name: 'x', fonts: { body: 'Georgia' } },       // fonts only
      { colors: {} },                                  // empty palette
      { colors: { primary: 'cornflowerblue' } },       // named colors are absent (parser contract)
      { colors: { background: '#ffffff', text_primary: '#111111' } }, // no BRAND channel
      null, 42, 'tokens',                              // not even an object
    ]) {
      const out = adaptLearnedTokens(tokens);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.reason).toMatch(/no usable brand color/);
    }
  });

  it('background/surface/text colors never masquerade as the brand color', () => {
    // Only primary/secondary/accent are BRAND channels; a theme that extracted
    // only surfaces must not paint the studio accent white.
    const out = adaptLearnedTokens({ colors: { background: '#ffffff', surface: '#f8fafc' } });
    expect(out.ok).toBe(false);
  });

  it('a blank name defaults without inventing meaning', () => {
    expect(adaptLearnedTokens({ name: '   ', colors: { primary: '#0a2a5e' } })).toEqual({
      ok: true, palette: { name: 'learned-theme', primary: '#0a2a5e' },
    });
  });
});
