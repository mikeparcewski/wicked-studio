import { parseCssColor, type BrandPalette } from './brandMapper.js';

/**
 * The seam between the REAL learned-theme shape and the resurrected mapper.
 *
 * `GET /d/:docId/api/theme/learned` (interactive#181) serves the doc's
 * `learned.theme.json` VERBATIM — the bridge's own theme-token vocabulary,
 * NESTED: `{name, colors:{background,surface,primary,secondary,accent,
 * text_primary,…}, fonts:{heading,body,mono}, …}`, with any field free to be
 * absent (partials are legal — the bridge's `themed()` applies whatever is
 * there). The §4.5 mapper (brandMapper.ts, resurrected from history) consumes
 * the FLAT `BrandPalette` it always consumed. This adapter folds one onto the
 * other and nothing more — no §4.5 logic lives here.
 *
 * Honesty rules:
 *   - `colors.primary` is the dominant brand color; `colors.secondary`, then
 *     `colors.accent`, fill the mapper's `secondary` channel (its own §4.4
 *     fallback discloses when it derives the accent from there).
 *   - a tokens object with NO usable brand color is an ERROR outcome, not a
 *     silent default: mapping "nothing" onto the stock accent and calling it
 *     a learned brand would be the dishonesty studio#73 existed to remove.
 *   - the learned shape carries NO logo. The logo slot stays the manual
 *     choice it already is on /theme, and the UI says so.
 */

export type AdaptOutcome =
  | { ok: true; palette: BrandPalette }
  | { ok: false; reason: string };

/** First member of `bag` under `keys` that parses as a CSS color, else null. */
function firstColor(bag: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const value = bag[key];
    if (typeof value === 'string' && parseCssColor(value) !== null) return value;
  }
  return null;
}

/** Narrow an unknown to a plain object, else `{}` (tolerant reading). */
function asObject(raw: unknown): Record<string, unknown> {
  return typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
}

/**
 * Fold the readback's `tokens` down to the mapper's input.
 *
 * `ok: false` when no usable brand color exists anywhere in `colors.primary`
 * / `colors.secondary` / `colors.accent` — the caller shows the reason
 * instead of applying anything.
 */
export function adaptLearnedTokens(tokens: unknown): AdaptOutcome {
  const bag = asObject(tokens);
  const colors = asObject(bag.colors);
  const primary = firstColor(colors, 'primary');
  // The mapper's own secondary-fallback (§4.4, disclosed) does the rest —
  // this just decides WHICH extracted color rides each channel.
  const secondary = firstColor(colors, 'secondary', 'accent');
  if (primary === null && secondary === null) {
    return {
      ok: false,
      reason: 'The learned theme carries no usable brand color — '
        + 'colors.primary, colors.secondary and colors.accent are all absent or '
        + 'unparseable — so the accent was left as it is.',
    };
  }
  const name = typeof bag.name === 'string' && bag.name.trim() !== ''
    ? bag.name.trim()
    : 'learned-theme';
  return {
    ok: true,
    palette: {
      name,
      ...(primary !== null ? { primary } : {}),
      ...(secondary !== null ? { secondary } : {}),
      // No logo_url: the learned shape has none (see the header) — the mapper
      // sees an absent logo and the manual /theme logo choice stands.
    },
  };
}
