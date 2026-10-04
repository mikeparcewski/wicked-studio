import { isColour } from './ops.js';

/**
 * EP-P3 (DES-EDITOR-PLUGINS-001 §7.1 R-b, §5.9): the restyle swatches a page offers. They are the page's
 * OWN theme — the `--wi-*` colours interactive writes into every document (`theme.js` `themeCss`); a
 * learned theme lands as a version that rewrites them, so the swatches follow it — resolved to the
 * concrete values the engine's style grammar accepts (it refuses `var(`). Nothing is invented: a page
 * with no theme offers no colours, only "Default".
 */

/** The theme's colour tokens, in the theme's own order, with the word each swatch is called. */
const COLOUR_TOKENS: readonly (readonly [string, string])[] = [
  ['--wi-bg', 'Background'],
  ['--wi-surface', 'Surface'],
  ['--wi-card-bg', 'Card'],
  ['--wi-primary', 'Primary'],
  ['--wi-secondary', 'Secondary'],
  ['--wi-accent', 'Accent'],
  ['--wi-text', 'Text'],
  ['--wi-text-secondary', 'Secondary text'],
  ['--wi-muted', 'Muted'],
  ['--wi-border', 'Border'],
];

/** "Default": the element goes back to what the document's own stylesheet says (an inline
 *  `revert-layer` rolls the declaration back to the author styles). */
export const DEFAULT_COLOUR = 'revert-layer';

export interface Swatch { token: string; value: string; label: string }

/** The swatches of one version's HTML: each theme colour once (the first token naming a value keeps
 *  it), the last declaration of a token winning, and only values the host's colour grammar accepts. */
export function themeSwatches(html: string): Swatch[] {
  const last = new Map<string, string>();
  for (const m of html.matchAll(/(--wi-[a-z-]{1,40})\s*:\s*([^;}{]{1,80})/gi)) {
    last.set(m[1]!.toLowerCase(), m[2]!.trim());
  }
  const seen = new Set<string>();
  const out: Swatch[] = [];
  for (const [token, label] of COLOUR_TOKENS) {
    const raw = last.get(token);
    if (raw === undefined) continue;
    const value = raw.startsWith('#') ? raw.toLowerCase() : raw;
    // `isColour` with no theme tokens refuses `var(`: only a concrete colour is a swatch.
    if (!isColour(value) || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    out.push({ token, value, label });
  }
  return out;
}
