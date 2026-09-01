/**
 * The wire-error translation layer (DES-UX-001 §7.10, EC33 — slice X2).
 *
 * House rule: **no raw wire error reaches the DOM.** Every daemon refusal a
 * component renders is either a NAMED CAUSE (slice R's diff cause cards are
 * the pattern — the caller matches on the raw sentence and renders its own
 * operator copy) or the honest translated fallback this module mints:
 *
 *     the daemon refused this — {the daemon's own sentence}
 *
 * The daemon's sentence is carried WHOLE inside the fallback — translation
 * never paraphrases a refusal, it only retires the `API NNN:` framing that
 * made the product read unfinished (BRIEF-UX-001 §D). Callers that need the
 * status code or the verbatim sentence (matchers, transcripts that quote the
 * service) read the TYPED fields — never the display message:
 *
 *  - `ApiError.status` — the HTTP status, for `status === 409`-style matching
 *    (replaces every `/^API 409: /.test(e.message)` in the codebase).
 *  - `ApiError.wire`   — the daemon's raw sentence, verbatim, for named-cause
 *    classification (FileViewer's diff causes) and service-voice transcripts
 *    (themeWire's `serviceReason`).
 *
 * Both fetch boundaries throw through here: `apiFetch` (crew's /api/v1) and
 * `iFetch` (the interactive bridge behind crew's proxy).
 */

/** Translate one wire refusal to its operator-facing sentence (EC33). */
export function translateWireError(status: number, wire: string): string {
  const detail = wire.trim();
  if (detail === '') {
    // A body-less refusal still gets an honest, complete sentence — the code
    // is stated in words, never as the bare `API NNN:` framing EC33 retires.
    return `the daemon refused this — it answered HTTP ${status} with no detail`;
  }
  return `the daemon refused this — ${detail}`;
}

/** A non-2xx answer from either daemon surface. `message` is ALREADY the
 *  translated operator sentence — render it as-is; match on the fields. */
export class ApiError extends Error {
  readonly status: number;
  /** The daemon's raw sentence, verbatim — matching + quoting only, never rendered bare. */
  readonly wire: string;
  constructor(status: number, wire: string) {
    super(translateWireError(status, wire));
    this.name = 'ApiError';
    this.status = status;
    this.wire = wire;
  }
}

/** The refusal's HTTP status, or null when `e` is not a wire refusal. */
export function apiStatus(e: unknown): number | null {
  return e instanceof ApiError ? e.status : null;
}

/** The daemon's verbatim sentence, or null when `e` is not a wire refusal. */
export function apiWire(e: unknown): string | null {
  return e instanceof ApiError ? e.wire : null;
}

/**
 * An unknown-route 404 carries no named error — the daemon predates the route
 * the caller asked for. Two exact spellings exist: Fastify's default body
 * (`error: 'Not Found'` — a headless daemon serving API+WS only) and crew's
 * SPA-serving notFoundHandler (`error: 'not found'` — every daemon with the
 * bundled studio, i.e. production). Named 404s ("unknown run: …", "no such
 * file: …") are real answers from a daemon WITH the route and must surface.
 * Shared by every forward-compat fallback (FileViewer, openPath, the
 * steering/testing adoption seams, the testing launch's recon fallback).
 */
export function isRouteAbsent(e: unknown): boolean {
  return (
    e instanceof ApiError && e.status === 404 && (e.wire === 'Not Found' || e.wire === 'not found')
  );
}
