import designTokens from '../vendor/wicked-design/dist/tokens.json';
/**
 * The theme a plugin is handed (`host.hello.theme`, `host.theme`; DES-EDITOR-PLUGINS-001 §5.9): the
 * host's resolved token values, never a stylesheet or a URL. A plugin re-renders with them.
 */
const STUDIO_TOKENS = [
  '--surface-base', '--surface-card', '--surface-raised', '--ink-high', '--ink-body', '--ink-muted',
  '--border', '--accent', '--accent-fg', '--status-fail', '--status-ok', '--font-sans',
] as const;

/** Studio's own names plus every name the design system hands to plugins (wicked-design
 *  `pluginProperties`: surfaces, ink, borders, the action, selection, focus ring, links, the brand
 *  mark's colours, status, radius, faces), so a plugin card or preview follows the user's theme. */
export const THEME_TOKENS: readonly string[] = [...new Set<string>([...STUDIO_TOKENS, ...designTokens.pluginProperties])];

export function readThemeTokens(root: Element = document.documentElement): Record<string, string> {
  const cs = getComputedStyle(root);
  const out: Record<string, string> = {};
  for (const t of THEME_TOKENS) {
    const v = cs.getPropertyValue(t).trim();
    if (v !== '' && !/url\(/i.test(v)) out[t] = v;
  }
  return out;
}
