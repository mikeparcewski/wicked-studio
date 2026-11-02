/**
 * How a plugin looks on the Plugins page (program DES-LEARN §2): an icon on its colour, a preview image (light and
 * dark), and whether its card may show a small LIVE preview (the plugin's own frame fed only sample events). A
 * built-in run plugin's come from its manifest in studio's bundle; an editor's from crew's registry (`EditorView`
 * `visuals`, api-types 0.157.0: images arrive as `data:` URLs, never a path or a remote URL).
 */

export interface PluginVisuals {
  /** An image URL (`data:` only); null = the host draws the plugin's initial. */
  icon: string | null;
  /** `#rrggbb`; null = the host's accent. */
  color: string | null;
  preview: { light: string | null; dark: string | null } | null;
  live: boolean;
}

export const NO_VISUALS: PluginVisuals = { icon: null, color: null, preview: null, live: false };

const IMAGE = /^data:image\/(?:svg\+xml|png|webp);base64,[A-Za-z0-9+/=]+$/u;
const HEX = /^#[0-9a-fA-F]{6}$/u;

const image = (v: unknown, max: number): string | null => (typeof v === 'string' && v.length <= max && IMAGE.test(v) ? v : null);

/** The wire's `visuals` (or a built-in manifest's, already resolved to `data:` URLs), strictly: a bad field is dropped. */
export function parseVisuals(raw: unknown): PluginVisuals {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return NO_VISUALS;
  const r = raw as Record<string, unknown>;
  const pv = r['preview'];
  const pr = typeof pv === 'object' && pv !== null && !Array.isArray(pv) ? pv as Record<string, unknown> : null;
  const light = pr !== null ? image(pr['light'], 300_000) : null;
  const dark = pr !== null ? image(pr['dark'], 300_000) : null;
  return {
    icon: image(r['icon'], 24_000),
    color: typeof r['color'] === 'string' && HEX.test(r['color']) ? r['color'] : null,
    preview: light !== null || dark !== null ? { light, dark } : null,
    live: r['live'] === true,
  };
}

/** A built-in plugin's SVG file as a `data:` URL (UTF-8 → base64, so it passes the same check a wire one does). */
export function svgDataUrl(svg: string): string {
  const bytes = new TextEncoder().encode(svg.trim());
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/svg+xml;base64,${btoa(bin)}`;
}

/** The preview for the page's theme: its own, else the other one. */
export function previewFor(v: PluginVisuals, theme: 'light' | 'dark'): string | null {
  if (v.preview === null) return null;
  return theme === 'dark' ? v.preview.dark ?? v.preview.light : v.preview.light ?? v.preview.dark;
}
