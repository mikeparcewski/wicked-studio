/**
 * The theme a plugin is handed (`host.hello.theme`, `host.theme`; DES-EDITOR-PLUGINS-001 §5.9): the
 * host's resolved token values, never a stylesheet or a URL. A plugin re-renders with them.
 */
export const THEME_TOKENS = [
  '--surface-base', '--surface-card', '--surface-raised', '--ink-high', '--ink-body', '--ink-muted',
  '--border', '--accent', '--accent-fg', '--status-fail', '--status-ok', '--font-sans',
] as const;

export function readThemeTokens(root: Element = document.documentElement): Record<string, string> {
  const cs = getComputedStyle(root);
  const out: Record<string, string> = {};
  for (const t of THEME_TOKENS) {
    const v = cs.getPropertyValue(t).trim();
    if (v !== '' && !/url\(/i.test(v)) out[t] = v;
  }
  return out;
}
