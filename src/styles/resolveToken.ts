/**
 * resolveToken — read a semantic design token's computed value at call time.
 *
 * The §2.11 contract (DES-VISION-001): components never ship a raw color; they
 * consume the semantic tokens from src/styles/tokens.css. DOM styles do that
 * with `var(--token)` directly. A few sinks cannot take a var() reference —
 * xterm.js themes and cytoscape stylesheets parse concrete color strings —
 * so they resolve the token through the cascade instead. This is the
 * §2.11-clean escape hatch, not a bypass: the value still originates in
 * tokens.css, so theme overrides and accent customization (§3.3) reach these
 * consumers too, as long as they resolve at (re)build time.
 *
 * In non-browser environments (jsdom tests) custom properties declared in
 * stylesheets are not computed; this returns '' and the consumer falls back
 * to its library default — the components involved mock those libraries in
 * unit tests and are probed for real in the Playwright rigs.
 */
export function resolveToken(name: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return '';
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
