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

/**
 * resolveTokenValue — read a token as its RAW computed string, not forced through a colour probe.
 *
 * For non-colour tokens a sink needs verbatim: a font stack (`--font-mono`,`--font-sans`) that
 * cytoscape's `font-family` takes as a comma list, a duration, a raw number. Reads the property off a
 * probe so a theme override still reaches it. Returns '' in non-browser environments (jsdom), where
 * stylesheet custom properties are not computed — the consumer falls back to its own default.
 */
export function resolveTokenValue(name: string): string {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return '';
  const probe = document.createElement('div');
  // Register the lookup on a real property so getPropertyValue returns the cascaded value.
  probe.style.setProperty('--resolve-probe', `var(${name})`);
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).getPropertyValue('--resolve-probe').trim();
  probe.remove();
  return computed.includes('var(') ? '' : computed;
}

/**
 * resolveTokenPx — read a length token as a NUMBER of pixels (e.g. `--text-caption` → 12).
 *
 * cytoscape's `font-size` wants a number, and label geometry runs in raw pixels. Resolves the token
 * through a probe's computed length (the browser normalises rem/em to px), returning NaN in
 * non-browser environments so the caller can fall back to a constant.
 */
export function resolveTokenPx(name: string): number {
  if (typeof document === 'undefined' || typeof getComputedStyle !== 'function') return NaN;
  const probe = document.createElement('div');
  // Do NOT set --name on the probe: that would shadow the real token with an invalid value and the
  // width would resolve to auto/NaN. The probe inherits the token from the cascade instead (F3).
  // display:none so the browser hands back the COMPUTED value, never a used/layout width: a valid
  // length still resolves to px, but an unset or invalid var() stays `auto` (→ NaN) instead of
  // collapsing to the body's content width (e.g. 1280px) that a laid-out block would report (F4).
  probe.style.display = 'none';
  probe.style.width = `var(${name})`;
  document.body.appendChild(probe);
  const computed = getComputedStyle(probe).width.trim();
  probe.remove();
  const n = Number.parseFloat(computed);
  return Number.isFinite(n) && /px$/.test(computed) ? n : NaN;
}
