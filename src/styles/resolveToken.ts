/**
 * resolveToken — read a semantic design token as a CONCRETE computed color.
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
 * WHY A PROBE ELEMENT, not getPropertyValue on :root: an unregistered custom
 * property's computed value is its raw token stream after var() substitution —
 * the §2.5/§2.6 tokens come back as `hsl(258 72% 62%)` (space-separated) or
 * even `hsl(258 72% calc(62% - 18%))` (calc unevaluated). The var()-blind
 * sinks this function exists for parse NEITHER: cytoscape's color regexes
 * require comma-separated channels and no calc (it discards the declaration
 * and falls back to its gray default). Applying `var(--token)` to a probe's
 * `color` and reading the COMPUTED color instead makes the browser do the full
 * math and hands back canonical `rgb()`/`rgba()` — which every sink parses.
 *
 * In non-browser environments (jsdom tests) custom properties declared in
 * stylesheets are not computed; this returns '' and the consumer falls back
 * to its library default — the components involved mock those libraries in
 * unit tests and are probed for real in the Playwright rigs.
 */
export function resolveToken(name: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return '';
  const probe = document.createElement('div');
  probe.style.color = `var(${name})`;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).color.trim();
  probe.remove();
  // A real resolution computes to a concrete color function or hex. Anything
  // else (jsdom's unset '' / uncomputed passthrough) keeps the '' contract.
  return /^(rgb|hsl|color|#)/i.test(computed) && !computed.includes('var(') ? computed : '';
}
