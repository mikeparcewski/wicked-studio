/**
 * The palette the mapper consumes — flat CSS color strings, all optional but
 * the name. Resurrected from the retracted slice-8 `ThemeDetail` (studio#73
 * removed that wire-side type with the invented route it rode); the mapper's
 * input shape survives unchanged, and `adaptLearnedTokens` (learnedTheme.ts)
 * is the seam that folds the REAL readback shape — the bridge's nested
 * `tokens.colors.*` from `GET /d/:docId/api/theme/learned` (interactive#181)
 * — down to this.
 */
export interface BrandPalette {
  name: string;
  primary?: string;    /* CSS color string — dominant brand color */
  secondary?: string;  /* CSS color string — secondary brand color, if extracted */
  background?: string; /* CSS color string — brand background, if extracted */
  logo_url?: string;   /* URL within the bridge to a logo asset, if found.
                          NOT part of the learned-theme readback shape — kept for
                          the mapper's purity contract and its historical tests. */
}

/**
 * The brand mapper (DES-VISION-001 §4.5): `BrandPalette` → studio token
 * overrides. A PURE function with no side effects — both invocation paths
 * (the Settings UI and the garden skill `wicked-studio:theming:learn-brand`)
 * run exactly this logic, so there is one spelling of "brand → accent".
 *
 * Four guarantees, in priority order (§4.5 — priority means which wins on
 * conflict, not execution order):
 *
 *   1. WCAG AA contrast floor — `contrast(--accent, --surface-card) ≥ 4.5:1`
 *      against the dark card surface default (`--_surface-2`, tokens.css §2.3).
 *      Below the floor, lightness rises until it is met (cap 90%); if lightness
 *      alone cannot meet it, saturation rises to 40% minimum. The floor may
 *      push lightness past guarantee 3's 78% clamp — priority 1 beats 3.
 *   2. Status-color distinctness — the accent hue stays ≥30° (circular) from
 *      each status hue (gate 45°, failing 4°, running 148°; tokens.css §2.6).
 *      A conflicting hue is walked outward in ±5° increments to the nearest
 *      clear position; when both directions clear at the same distance, the
 *      one maximizing total distance from all three status hues wins.
 *   3. Saturation and lightness clamps — `accent_s ∈ [20, 88]`,
 *      `accent_l ∈ [42, 78]` (dark theme): no near-greys, no neon, nothing
 *      that disappears into the dark surfaces or washes out as white.
 *   4. Perceptual distinctness — the full computed accent keeps a deltaE
 *      (CIE76 Lab distance — §4.5 sanctions a simplified approximation) of
 *      ≥25 from each full status color; a too-close accent has its lightness
 *      moved ±10 to push them apart, never below the contrast floor. Because
 *      guarantee 3 outranks 4, a nudge that satisfies the floor WITHIN the
 *      lightness clamp always beats one that leaves it; the up-nudge may
 *      exceed the 78% ceiling (disclosed) only when no in-clamp move meets
 *      the floor — the §4.5 remedy is literally ±10, clamp or no clamp.
 *
 * Every move is logged as a `MapperAdjustment` (§4.5: no silent truncation —
 * an unsatisfiable combination returns a `constraint: 'unsatisfiable'` entry
 * and the UI shows it rather than applying silently).
 *
 * Tolerant reading (§4.4's ASSUMPTION[external-transform]): absent fields are
 * null; only `primary` is required to derive an accent, `secondary` fills in
 * when `primary` is missing, and a theme with no usable color at all maps to
 * the §2.5 defaults with the fallback disclosed. `logo_url` passes through
 * untransformed — resolving it to a same-origin URL is the caller's job
 * (`interactiveUrl`), because the mapper is pure and knows no project.
 */

export interface MapperAdjustment {
  constraint:
    | 'contrast-floor'       /* §4.5 guarantee 1 */
    | 'hue-separation'       /* §4.5 guarantee 2 */
    | 'saturation-clamp'     /* §4.5 guarantee 3 */
    | 'lightness-clamp'      /* §4.5 guarantee 3 */
    | 'perceptual-distance'  /* §4.5 guarantee 4 */
    | 'source-fallback'      /* §4.4 tolerant reading */
    | 'unsatisfiable';       /* §4.5 no-silent-truncation */
  original: string;
  adjusted: string;
  reason: string;
}

/** What the mapper hands back — the §4.2 skill's `token_overrides` + the log. */
export interface BrandTokenOverrides {
  accent_h: number;
  accent_s: number;
  accent_l: number;
  logo_url: string | null;
  adjustments: MapperAdjustment[];
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

// ── The fixed surfaces the guarantees measure against ────────────────────────
// Numeric mirrors of tokens.css (§2.3, §2.6) — numbers, not color literals,
// because §2.11 bans raw color strings outside the token files. If tokens.css
// moves these, move them here (the unit suite pins the pairing).

/** `--_surface-2` — the dark card surface (#1a1a26 in tokens.css §2.3). */
export const SURFACE_CARD_RGB: Rgb = { r: 26, g: 26, b: 38 };

/** §2.6's status trio: full (not -dim) variants, as HSL numbers. */
export const STATUS_COLORS = [
  { name: 'gate (amber)', h: 45, s: 90, l: 68 },
  { name: 'failing (red)', h: 4, s: 88, l: 62 },
  { name: 'running (emerald)', h: 148, s: 58, l: 58 },
] as const;

const CONTRAST_FLOOR = 4.5;   /* §4.5 g1: WCAG AA */
const LIGHTNESS_CAP = 90;     /* §4.5 g1: the raise stops here */
const MIN_SAT_FOR_CONTRAST = 40; /* §4.5 g1: the low-saturation rescue */
const HUE_SEPARATION = 30;    /* §4.5 g2: degrees from each status hue */
const HUE_STEP = 5;           /* §4.5 g2: search increment */
const SAT_MIN = 20;           /* §4.5 g3 */
const SAT_MAX = 88;           /* §4.5 g3 */
const LGT_MIN = 42;           /* §4.5 g3 (dark theme) */
const LGT_MAX = 78;           /* §4.5 g3 (dark theme) */
const DELTA_E_FLOOR = 25;     /* §4.5 g4 */
const PERCEPTUAL_NUDGE = 10;  /* §4.5 g4: lightness is adjusted by ±10 */

// ── Color math ────────────────────────────────────────────────────────────────

/**
 * Parse a CSS color string tolerantly: hex (#rgb/#rgba/#rrggbb/#rrggbbaa),
 * rgb()/rgba() (0–255 or %), hsl()/hsla(). Anything else — including a
 * non-string — is null, which the pipeline treats as "absent" (§4.4).
 */
export function parseCssColor(input: unknown): Rgb | null {
  if (typeof input !== 'string') return null;
  const str = input.trim().toLowerCase();
  if (str.startsWith('#')) {
    const hex = str.slice(1);
    if (!/^[0-9a-f]+$/.test(hex)) return null;
    if (hex.length === 3 || hex.length === 4) {
      return {
        r: parseInt(hex.charAt(0) + hex.charAt(0), 16),
        g: parseInt(hex.charAt(1) + hex.charAt(1), 16),
        b: parseInt(hex.charAt(2) + hex.charAt(2), 16),
      };
    }
    if (hex.length === 6 || hex.length === 8) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      };
    }
    return null;
  }
  const fn = /^(rgba?|hsla?)\s*\(([^)]*)\)$/.exec(str);
  if (fn === null) return null;
  const parts = (fn[2] ?? '').split(/[,\s/]+/).filter((p) => p !== '');
  const [c0, c1, c2] = [parts[0] ?? '', parts[1] ?? '', parts[2] ?? ''];
  if (parts.length < 3) return null;
  if ((fn[1] ?? '').startsWith('rgb')) {
    const chan = (raw: string): number | null => {
      const pct = raw.endsWith('%');
      const n = Number.parseFloat(raw);
      if (!Number.isFinite(n)) return null;
      const v = pct ? (n / 100) * 255 : n;
      return Math.min(255, Math.max(0, Math.round(v)));
    };
    const r = chan(c0);
    const g = chan(c1);
    const b = chan(c2);
    return r === null || g === null || b === null ? null : { r, g, b };
  }
  const h = Number.parseFloat(c0);
  const s = Number.parseFloat(c1);
  const l = Number.parseFloat(c2);
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;
  return hslToRgb(((h % 360) + 360) % 360, Math.min(100, Math.max(0, s)), Math.min(100, Math.max(0, l)));
}

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const sn = s / 100;
  const ln = l / 100;
  const chroma = (1 - Math.abs(2 * ln - 1)) * sn;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = chroma * (1 - Math.abs((hp % 2) - 1));
  let rp = 0;
  let gp = 0;
  let bp = 0;
  if (hp < 1) [rp, gp, bp] = [chroma, x, 0];
  else if (hp < 2) [rp, gp, bp] = [x, chroma, 0];
  else if (hp < 3) [rp, gp, bp] = [0, chroma, x];
  else if (hp < 4) [rp, gp, bp] = [0, x, chroma];
  else if (hp < 5) [rp, gp, bp] = [x, 0, chroma];
  else [rp, gp, bp] = [chroma, 0, x];
  const m = ln - chroma / 2;
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

export function rgbToHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;
  if (d !== 0) {
    s = d / (1 - Math.abs(2 * l - 1));
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  return {
    h: Math.round(((h % 360) + 360) % 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
}

function channelLuminance(c255: number): number {
  const c = c255 / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG contrast ratio, 1:1 → 21:1. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function toLab({ r, g, b }: Rgb): { L: number; a: number; b: number } {
  // sRGB → XYZ (D65) → CIELAB.
  const lin = (c255: number): number => {
    const c = c255 / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);
  const x = (0.4124 * rl + 0.3576 * gl + 0.1805 * bl) / 0.95047;
  const y = 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
  const z = (0.0193 * rl + 0.1192 * gl + 0.9505 * bl) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** CIE76 deltaE — the §4.5-sanctioned simplified perceptual distance. */
export function deltaE(a: Rgb, b: Rgb): number {
  const la = toLab(a);
  const lb = toLab(b);
  return Math.sqrt((la.L - lb.L) ** 2 + (la.a - lb.a) ** 2 + (la.b - lb.b) ** 2);
}

/** Circular hue distance in degrees, 0–180. */
export function hueDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
}

// ── The pipeline ──────────────────────────────────────────────────────────────

function minStatusHueSeparation(h: number): number {
  return Math.min(...STATUS_COLORS.map((st) => hueDistance(h, st.h)));
}

function totalStatusHueDistance(h: number): number {
  return STATUS_COLORS.reduce((sum, st) => sum + hueDistance(h, st.h), 0);
}

/**
 * §4.5 g2's search: walk outward in ±5° increments to the nearest hue that
 * clears every status hue by ≥30°; a same-distance tie goes to the candidate
 * with the greater total distance from all three status hues.
 */
function nearestClearHue(h: number): number {
  for (let k = 1; k <= Math.ceil(360 / HUE_STEP); k++) {
    const up = (h + k * HUE_STEP) % 360;
    const down = (((h - k * HUE_STEP) % 360) + 360) % 360;
    const upOk = minStatusHueSeparation(up) >= HUE_SEPARATION;
    const downOk = minStatusHueSeparation(down) >= HUE_SEPARATION;
    if (upOk && downOk) return totalStatusHueDistance(up) >= totalStatusHueDistance(down) ? up : down;
    if (upOk) return up;
    if (downOk) return down;
  }
  return h; // structurally unreachable while clear arcs exist; caller logs it
}

/** Raise lightness until the floor is met or the cap is hit; returns final l. */
function raiseLightnessToFloor(h: number, s: number, l: number): number {
  let cur = l;
  while (cur < LIGHTNESS_CAP && contrastRatio(hslToRgb(h, s, cur), SURFACE_CARD_RGB) < CONTRAST_FLOOR) {
    cur += 1;
  }
  return cur;
}

/** The §4.5 mapper: pure, tolerant, every move disclosed. */
export function mapBrandTheme(theme: BrandPalette): BrandTokenOverrides {
  const adjustments: MapperAdjustment[] = [];
  const logoRaw = typeof theme.logo_url === 'string' && theme.logo_url.trim() !== ''
    ? theme.logo_url.trim()
    : null;

  // ── Source color (§4.4 tolerant reading): primary, else secondary, else defaults ──
  let src = parseCssColor(theme.primary);
  if (src === null) {
    src = parseCssColor(theme.secondary);
    if (src !== null) {
      adjustments.push({
        constraint: 'source-fallback',
        original: `primary=${String(theme.primary ?? null)}`,
        adjusted: `secondary=${String(theme.secondary)}`,
        reason: 'No usable primary color was extracted — the accent derives from the secondary brand color.',
      });
    }
  }
  if (src === null) {
    adjustments.push({
      constraint: 'source-fallback',
      original: `primary=${String(theme.primary ?? null)}, secondary=${String(theme.secondary ?? null)}`,
      adjusted: 'accent 258 72% 62% (default)',
      reason: 'No usable brand color was extracted from the source — the default accent stands.',
    });
    return { accent_h: 258, accent_s: 72, accent_l: 62, logo_url: logoRaw, adjustments };
  }

  let { h, s, l } = rgbToHsl(src);

  // ── Guarantee 3: saturation and lightness clamps ──
  if (s < SAT_MIN || s > SAT_MAX) {
    const clamped = Math.min(SAT_MAX, Math.max(SAT_MIN, s));
    adjustments.push({
      constraint: 'saturation-clamp',
      original: `s=${s}%`,
      adjusted: `s=${clamped}%`,
      reason: s < SAT_MIN
        ? `Saturation ${s}% is a near-grey — raised to the ${SAT_MIN}% floor so the accent reads as a color.`
        : `Saturation ${s}% is neon on dark surfaces — lowered to the ${SAT_MAX}% ceiling.`,
    });
    s = clamped;
  }
  if (l < LGT_MIN || l > LGT_MAX) {
    const clamped = Math.min(LGT_MAX, Math.max(LGT_MIN, l));
    adjustments.push({
      constraint: 'lightness-clamp',
      original: `l=${l}%`,
      adjusted: `l=${clamped}%`,
      reason: l < LGT_MIN
        ? `Lightness ${l}% disappears into the dark background — raised to the ${LGT_MIN}% floor.`
        : `Lightness ${l}% washes out as white — lowered to the ${LGT_MAX}% ceiling.`,
    });
    l = clamped;
  }

  // ── Guarantee 2: ≥30° circular separation from every status hue ──
  if (minStatusHueSeparation(h) < HUE_SEPARATION) {
    const moved = nearestClearHue(h);
    if (minStatusHueSeparation(moved) < HUE_SEPARATION) {
      adjustments.push({
        constraint: 'unsatisfiable',
        original: `h=${h}°`,
        adjusted: `h=${h}°`,
        reason: 'Every hue position conflicts with a status hue — no ≥30° separation exists.',
      });
    } else {
      const nearest = STATUS_COLORS.reduce((a, b) => (hueDistance(h, a.h) <= hueDistance(h, b.h) ? a : b));
      adjustments.push({
        constraint: 'hue-separation',
        original: `h=${h}°`,
        adjusted: `h=${moved}°`,
        reason: `Hue ${h}° sits within 30° of the ${nearest.name} status hue — moved to the nearest clear position.`,
      });
      h = moved;
    }
  }

  // ── Guarantee 1: WCAG AA contrast floor against the card surface ──
  let contrast = contrastRatio(hslToRgb(h, s, l), SURFACE_CARD_RGB);
  if (contrast < CONTRAST_FLOOR) {
    const startL = l;
    let raised = raiseLightnessToFloor(h, s, startL);
    let finalS = s;
    if (contrastRatio(hslToRgb(h, finalS, raised), SURFACE_CARD_RGB) < CONTRAST_FLOOR
        && finalS < MIN_SAT_FOR_CONTRAST) {
      adjustments.push({
        constraint: 'contrast-floor',
        original: `s=${finalS}%`,
        adjusted: `s=${MIN_SAT_FOR_CONTRAST}%`,
        reason: `The ${CONTRAST_FLOOR}:1 floor could not be met by lightness alone — saturation raised to the ${MIN_SAT_FOR_CONTRAST}% minimum.`,
      });
      finalS = MIN_SAT_FOR_CONTRAST;
      raised = raiseLightnessToFloor(h, finalS, startL);
    }
    if (raised !== startL) {
      adjustments.push({
        constraint: 'contrast-floor',
        original: `l=${startL}%`,
        adjusted: `l=${raised}%`,
        reason: `Contrast against the card surface was ${contrast.toFixed(2)}:1 — lightness raised for WCAG AA (${CONTRAST_FLOOR}:1) on dark surfaces.`,
      });
    }
    s = finalS;
    l = raised;
    contrast = contrastRatio(hslToRgb(h, s, l), SURFACE_CARD_RGB);
    if (contrast < CONTRAST_FLOOR) {
      adjustments.push({
        constraint: 'unsatisfiable',
        original: `l=${startL}%`,
        adjusted: `l=${l}%, s=${s}%`,
        reason: `The ${CONTRAST_FLOOR}:1 contrast floor cannot be met: ${contrast.toFixed(2)}:1 at the ${LIGHTNESS_CAP}% lightness cap.`,
      });
    }
  }

  // ── Guarantee 4: perceptual distance ≥25 from every full status color ──
  const tooClose = (lgt: number): { name: string; d: number } | null => {
    const accent = hslToRgb(h, s, lgt);
    let worst: { name: string; d: number } | null = null;
    for (const st of STATUS_COLORS) {
      const d = deltaE(accent, hslToRgb(st.h, st.s, st.l));
      if (d < DELTA_E_FLOOR && (worst === null || d < worst.d)) worst = { name: st.name, d };
    }
    return worst;
  };
  const near = tooClose(l);
  if (near !== null) {
    const minDeltaAt = (lgt: number): number =>
      Math.min(...STATUS_COLORS.map((st) => deltaE(hslToRgb(h, s, lgt), hslToRgb(st.h, st.s, st.l))));
    const meetsContrast = (lgt: number): boolean =>
      contrastRatio(hslToRgb(h, s, lgt), SURFACE_CARD_RGB) >= CONTRAST_FLOOR;
    const candidates = [
      Math.min(LIGHTNESS_CAP, l + PERCEPTUAL_NUDGE),
      Math.max(LGT_MIN, l - PERCEPTUAL_NUDGE),
    ].filter((c) => c !== l && meetsContrast(c)); // g1 outranks g4: never break the floor
    // g3 outranks g4: when a candidate satisfies the deltaE floor WITHOUT
    // leaving the [42,78] clamp, it wins — the up-nudge may exceed the clamp
    // (disclosed) only when no in-clamp candidate meets the floor.
    const inClamp = candidates.filter((c) => c <= LGT_MAX && minDeltaAt(c) >= DELTA_E_FLOOR);
    const pool = inClamp.length > 0 ? inClamp : candidates;
    if (pool.length > 0) {
      const best = pool.reduce((a, b) => (minDeltaAt(a) >= minDeltaAt(b) ? a : b));
      adjustments.push({
        constraint: 'perceptual-distance',
        original: `l=${l}%`,
        adjusted: `l=${best}%`,
        reason: `The accent sat only ${near.d.toFixed(1)} deltaE from the ${near.name} status color — lightness moved to push them ≥${DELTA_E_FLOOR} apart.`,
      });
      l = best;
    }
    const still = tooClose(l);
    if (still !== null) {
      adjustments.push({
        constraint: 'unsatisfiable',
        original: `deltaE=${near.d.toFixed(1)}`,
        adjusted: `deltaE=${still.d.toFixed(1)}`,
        reason: `The accent remains within ${DELTA_E_FLOOR} deltaE of the ${still.name} status color after the ±${PERCEPTUAL_NUDGE}% lightness adjustment.`,
      });
    }
  }

  return { accent_h: h, accent_s: s, accent_l: l, logo_url: logoRaw, adjustments };
}

/** True when the mapping must NOT be applied silently (§4.5 no-silent-truncation). */
export function isUnsatisfiable(m: BrandTokenOverrides): boolean {
  return m.adjustments.some((a) => a.constraint === 'unsatisfiable');
}
