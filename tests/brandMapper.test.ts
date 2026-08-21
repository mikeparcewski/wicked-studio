import { describe, expect, it } from 'vitest';
import {
  contrastRatio,
  deltaE,
  hslToRgb,
  hueDistance,
  isUnsatisfiable,
  mapBrandTheme,
  parseCssColor,
  rgbToHsl,
  SURFACE_CARD_RGB,
  STATUS_COLORS,
  type BrandTokenOverrides,
} from '../src/theming/brandMapper.js';

/**
 * The §4.5 mapper contract (DES-VISION-001): a PURE ThemeDetail → token-override
 * function with four guarantees — WCAG AA contrast floor against the card
 * surface, ≥30° hue separation from the status trio, saturation/lightness
 * clamps, and ≥25 deltaE perceptual distinctness — every move disclosed as an
 * adjustment, nothing silently truncated, degenerate palettes tolerated (§4.4).
 */

const CONTRAST_FLOOR = 4.5;
const HUE_SEP = 30;
const DELTA_FLOOR = 25;

function accentRgb(m: BrandTokenOverrides) {
  return hslToRgb(m.accent_h, m.accent_s, m.accent_l);
}

function minStatusHueSep(h: number): number {
  return Math.min(...STATUS_COLORS.map((st) => hueDistance(h, st.h)));
}

function minStatusDeltaE(m: BrandTokenOverrides): number {
  return Math.min(...STATUS_COLORS.map((st) => deltaE(accentRgb(m), hslToRgb(st.h, st.s, st.l))));
}

describe('color math', () => {
  it('parses hex, rgb(), rgb(%), hsl() and rejects garbage', () => {
    expect(parseCssColor('#0a2a5e')).toEqual({ r: 10, g: 42, b: 94 });
    expect(parseCssColor('#fff')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseCssColor('#FFF8')).toEqual({ r: 255, g: 255, b: 255 });
    expect(parseCssColor('#0a2a5eff')).toEqual({ r: 10, g: 42, b: 94 });
    expect(parseCssColor('rgb(10, 42, 94)')).toEqual({ r: 10, g: 42, b: 94 });
    expect(parseCssColor('rgba(10 42 94 / 0.5)')).toEqual({ r: 10, g: 42, b: 94 });
    expect(parseCssColor('rgb(100%, 0%, 0%)')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseCssColor('hsl(0, 100%, 50%)')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseCssColor('hsl(217 81% 20%)')).toEqual(hslToRgb(217, 81, 20));
    expect(parseCssColor('cornflowerblue')).toBeNull(); // named colors: tolerated as absent
    expect(parseCssColor('#12345')).toBeNull();
    expect(parseCssColor('#zzz')).toBeNull();
    expect(parseCssColor('rgb(a, b, c)')).toBeNull();
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor(undefined)).toBeNull();
    expect(parseCssColor(42)).toBeNull();
  });

  it('round-trips hsl → rgb → hsl within rounding', () => {
    const { h, s, l } = rgbToHsl(hslToRgb(258, 72, 62));
    expect(Math.abs(h - 258)).toBeLessThanOrEqual(1);
    expect(Math.abs(s - 72)).toBeLessThanOrEqual(1);
    expect(Math.abs(l - 62)).toBeLessThanOrEqual(1);
  });

  it('contrastRatio: white vs black is 21:1, self vs self is 1:1', () => {
    expect(contrastRatio({ r: 255, g: 255, b: 255 }, { r: 0, g: 0, b: 0 })).toBeCloseTo(21, 0);
    expect(contrastRatio(SURFACE_CARD_RGB, SURFACE_CARD_RGB)).toBeCloseTo(1, 5);
  });

  it('hueDistance is circular', () => {
    expect(hueDistance(350, 10)).toBe(20);
    expect(hueDistance(10, 350)).toBe(20);
    expect(hueDistance(0, 180)).toBe(180);
    expect(hueDistance(45, 45)).toBe(0);
  });

  it('SURFACE_CARD_RGB mirrors tokens.css --_surface-2 (#1a1a26)', () => {
    // The mapper measures guarantee 1 against the REAL card surface; if
    // tokens.css moves, this pairing must move with it (§4.5 g1).
    expect(SURFACE_CARD_RGB).toEqual(parseCssColor('#1a1a26'));
  });
});

describe('mapBrandTheme — guarantee 1: WCAG AA contrast floor (§4.5)', () => {
  it('raises lightness for a deep navy until accent vs card ≥ 4.5:1, and discloses it', () => {
    const m = mapBrandTheme({ name: 'navy', primary: '#0a2a5e' });
    expect(m.accent_h).toBe(217); // hue preserved — no status conflict at 217°
    expect(contrastRatio(accentRgb(m), SURFACE_CARD_RGB)).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
    expect(m.adjustments.some((a) => a.constraint === 'lightness-clamp')).toBe(true);
    expect(m.adjustments.some((a) => a.constraint === 'contrast-floor')).toBe(true);
    expect(isUnsatisfiable(m)).toBe(false);
  });

  it('every adjustment carries {constraint, original, adjusted, reason}', () => {
    const m = mapBrandTheme({ name: 'navy', primary: '#0a2a5e' });
    expect(m.adjustments.length).toBeGreaterThan(0);
    for (const a of m.adjustments) {
      expect(a.constraint).toBeTruthy();
      expect(a.original).toBeTruthy();
      expect(a.adjusted).toBeTruthy();
      expect(a.reason).toBeTruthy();
    }
  });

  it('the lightness raise caps at 90%', () => {
    const m = mapBrandTheme({ name: 'near-black', primary: '#050508' });
    expect(m.accent_l).toBeLessThanOrEqual(90);
    expect(contrastRatio(accentRgb(m), SURFACE_CARD_RGB)).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
  });
});

describe('mapBrandTheme — guarantee 2: ≥30° hue separation from the status trio (§4.5)', () => {
  it('moves an emerald-adjacent hue off the running hue via ±5° search (nearest side wins)', () => {
    // #22c55e ≈ hue 142° — inside the running (148°) exclusion band.
    // Down clears at 5 steps (117°), up only at 8 (182°) — nearest wins.
    const m = mapBrandTheme({ name: 'green', primary: '#22c55e' });
    expect(m.accent_h).toBe(117);
    expect(minStatusHueSep(m.accent_h)).toBeGreaterThanOrEqual(HUE_SEP);
    expect(m.adjustments.some((a) => a.constraint === 'hue-separation')).toBe(true);
  });

  it('a dead-center conflict tie-breaks to the direction maximizing total status distance', () => {
    // Hue exactly 148 (the running hue): both directions clear at 6 steps
    // (118° and 178°); 178° has the greater total distance from all three.
    const m = mapBrandTheme({ name: 'emerald', primary: 'hsl(148, 58%, 58%)' });
    expect(m.accent_h).toBe(178);
    expect(minStatusHueSep(m.accent_h)).toBeGreaterThanOrEqual(HUE_SEP);
  });

  it('an amber-adjacent hue is pushed out of the gate band', () => {
    const m = mapBrandTheme({ name: 'amber', primary: 'hsl(50, 90%, 60%)' });
    expect(minStatusHueSep(m.accent_h)).toBeGreaterThanOrEqual(HUE_SEP);
    expect(m.adjustments.some((a) => a.constraint === 'hue-separation')).toBe(true);
  });
});

describe('mapBrandTheme — guarantee 3: saturation and lightness clamps (§4.5)', () => {
  it('clamps a neon: s > 88 → 88', () => {
    const m = mapBrandTheme({ name: 'neon', primary: 'hsl(217, 100%, 60%)' });
    expect(m.accent_s).toBe(88);
    expect(m.adjustments.some((a) => a.constraint === 'saturation-clamp')).toBe(true);
  });

  it('clamps a near-grey: s < 20 → 20 (and the hue then clears the fail band)', () => {
    const m = mapBrandTheme({ name: 'grey', primary: '#808080' }); // s=0, h=0 (≈ fail hue 4°)
    expect(m.accent_s).toBeGreaterThanOrEqual(20);
    expect(m.adjustments.some((a) => a.constraint === 'saturation-clamp')).toBe(true);
    expect(minStatusHueSep(m.accent_h)).toBeGreaterThanOrEqual(HUE_SEP);
  });

  it('clamps a wash-out: l > 78 → 78 (contrast floor already satisfied there)', () => {
    const m = mapBrandTheme({ name: 'pale', primary: 'hsl(217, 60%, 92%)' });
    expect(m.accent_l).toBe(78);
    expect(m.adjustments.some((a) => a.constraint === 'lightness-clamp')).toBe(true);
    expect(contrastRatio(accentRgb(m), SURFACE_CARD_RGB)).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
  });

  it('black and white both land inside every guarantee', () => {
    for (const hex of ['#000000', '#ffffff']) {
      const m = mapBrandTheme({ name: 'edge', primary: hex });
      expect(m.accent_s).toBeGreaterThanOrEqual(20);
      expect(m.accent_s).toBeLessThanOrEqual(88);
      expect(m.accent_l).toBeGreaterThanOrEqual(42);
      expect(m.accent_l).toBeLessThanOrEqual(90);
      expect(contrastRatio(accentRgb(m), SURFACE_CARD_RGB)).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
      expect(minStatusHueSep(m.accent_h)).toBeGreaterThanOrEqual(HUE_SEP);
    }
  });
});

describe('mapBrandTheme — guarantee 4: perceptual distinctness (§4.5)', () => {
  it('a satisfiable mapping never sits within 25 deltaE of a status color', () => {
    // Colors chosen to hug each status color after the hue push.
    for (const primary of ['hsl(75, 90%, 68%)', 'hsl(34, 88%, 62%)', 'hsl(178, 58%, 58%)']) {
      const m = mapBrandTheme({ name: 'close', primary });
      if (!isUnsatisfiable(m)) {
        expect(minStatusDeltaE(m)).toBeGreaterThanOrEqual(DELTA_FLOOR);
      } else {
        // Never silent: the residual proximity is disclosed.
        expect(m.adjustments.some((a) => a.constraint === 'unsatisfiable')).toBe(true);
      }
    }
  });

  it('a perceptual nudge never breaks the contrast floor (priority 1 beats 4)', () => {
    for (const primary of ['hsl(75, 90%, 55%)', 'hsl(178, 58% ,48%)']) {
      const m = mapBrandTheme({ name: 'nudge', primary });
      expect(contrastRatio(accentRgb(m), SURFACE_CARD_RGB)).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
    }
  });

  it('a nudge that can satisfy the floor IN-clamp never leaves it (priority 3 beats 4)', () => {
    // hsl(96 60% 70%): both ±10 candidates clear 25 deltaE (up 80 ≈ 30.2,
    // down 60 ≈ 29.6) — the in-clamp 60 must win over the marginally-farther
    // out-of-clamp 80, because guarantee 3's l ≤ 78 outranks maximizing g4.
    const m = mapBrandTheme({ name: 'in-clamp', primary: 'hsl(96, 60%, 70%)' });
    expect(m.adjustments.some((a) => a.constraint === 'perceptual-distance')).toBe(true);
    expect(m.accent_l).toBeLessThanOrEqual(78);
    expect(minStatusDeltaE(m)).toBeGreaterThanOrEqual(DELTA_FLOOR);
    expect(contrastRatio(accentRgb(m), SURFACE_CARD_RGB)).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
  });
});

describe('mapBrandTheme — the whole-gamut property (§4.5: all four at once)', () => {
  it('any input either satisfies every guarantee or discloses unsatisfiability', () => {
    for (let h = 0; h < 360; h += 15) {
      for (const s of [0, 35, 70, 100]) {
        for (const l of [5, 35, 65, 95]) {
          const rgb = hslToRgb(h, s, l);
          const hex = `#${[rgb.r, rgb.g, rgb.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
          const m = mapBrandTheme({ name: 'sweep', primary: hex });
          const label = `input hsl(${h} ${s}% ${l}%) → hsl(${m.accent_h} ${m.accent_s}% ${m.accent_l}%)`;
          if (isUnsatisfiable(m)) continue; // disclosed, never silent — allowed
          expect(contrastRatio(accentRgb(m), SURFACE_CARD_RGB), `${label}: contrast`)
            .toBeGreaterThanOrEqual(CONTRAST_FLOOR);
          expect(minStatusHueSep(m.accent_h), `${label}: hue separation`)
            .toBeGreaterThanOrEqual(HUE_SEP);
          expect(minStatusDeltaE(m), `${label}: deltaE`).toBeGreaterThanOrEqual(DELTA_FLOOR);
          expect(m.accent_s, `${label}: sat range`).toBeGreaterThanOrEqual(20);
          expect(m.accent_s, `${label}: sat range`).toBeLessThanOrEqual(88);
          expect(m.accent_l, `${label}: lgt range`).toBeGreaterThanOrEqual(42);
          expect(m.accent_l, `${label}: lgt range`).toBeLessThanOrEqual(90);
        }
      }
    }
  });
});

describe('mapBrandTheme — degenerate palettes (§4.4 tolerant reading)', () => {
  it('no colors at all → the default accent stands, disclosed as a source fallback', () => {
    const m = mapBrandTheme({ name: 'empty' });
    expect(m).toMatchObject({ accent_h: 258, accent_s: 72, accent_l: 62, logo_url: null });
    expect(m.adjustments).toHaveLength(1);
    expect(m.adjustments[0]?.constraint).toBe('source-fallback');
  });

  it('an unparseable primary is treated as absent', () => {
    const m = mapBrandTheme({ name: 'junk', primary: 'linear-gradient(red, blue)' });
    expect(m.accent_h).toBe(258);
    expect(m.adjustments.some((a) => a.constraint === 'source-fallback')).toBe(true);
  });

  it('secondary fills in when primary is missing, and says so', () => {
    const m = mapBrandTheme({ name: 'sec', secondary: '#0a2a5e' });
    expect(m.accent_h).toBe(217);
    expect(m.adjustments.some((a) => a.constraint === 'source-fallback')).toBe(true);
  });

  it('primary wins over secondary when both parse', () => {
    const m = mapBrandTheme({ name: 'both', primary: '#0a2a5e', secondary: '#22c55e' });
    expect(m.accent_h).toBe(217);
    expect(m.adjustments.some((a) => a.constraint === 'source-fallback')).toBe(false);
  });
});

describe('mapBrandTheme — logo passthrough and purity (§4.5)', () => {
  it('passes a bridge-relative logo_url through untransformed', () => {
    const m = mapBrandTheme({ name: 'logo', primary: '#0a2a5e', logo_url: '/api/brand/logo.svg' });
    expect(m.logo_url).toBe('/api/brand/logo.svg');
  });

  it('a blank or absent logo_url is null', () => {
    expect(mapBrandTheme({ name: 'x', primary: '#0a2a5e', logo_url: '   ' }).logo_url).toBeNull();
    expect(mapBrandTheme({ name: 'x', primary: '#0a2a5e' }).logo_url).toBeNull();
  });

  it('the logo survives a palette with no usable color', () => {
    const m = mapBrandTheme({ name: 'logo-only', logo_url: '/api/brand/logo.svg' });
    expect(m.logo_url).toBe('/api/brand/logo.svg');
    expect(m.accent_h).toBe(258);
  });

  it('is pure: same input → deep-equal output, input never mutated', () => {
    const input = Object.freeze({ name: 'pure', primary: '#22c55e', logo_url: '/l.svg' });
    const a = mapBrandTheme(input);
    const b = mapBrandTheme(input);
    expect(a).toEqual(b);
    expect(input).toEqual({ name: 'pure', primary: '#22c55e', logo_url: '/l.svg' });
  });
});
