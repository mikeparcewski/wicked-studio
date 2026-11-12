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

import { planRefusalWords } from './planRefusal.js';

/**
 * The GitHub CLI login refusals crew names on a PM source's preview and save (crew's `gh-cli:` auth: four 409s and a
 * 400). Each gets plain words first, the daemon's own sentence kept whole after them; nothing was saved by any.
 */
const GH_CLI_REFUSALS: Readonly<Record<string, string>> = {
  gh_account_mismatch: 'That account isn’t the one the GitHub CLI is signed in as: choose another, or check again. Nothing was saved.',
  gh_not_installed: 'The GitHub CLI isn’t installed where crew runs. Nothing was saved.',
  gh_signed_out: 'The GitHub CLI is signed out where crew runs. Nothing was saved.',
  gh_token_unavailable: 'The GitHub CLI couldn’t supply a login for that account. Nothing was saved.',
  gh_cli_not_allowed: 'This source can’t use the GitHub CLI login. Nothing was saved.',
};

/** Whether `code` is one of the GitHub CLI refusals crew names (the sheet re-reads crew's gh state for the first four). */
export function isGhCliRefusal(code: string | null): boolean {
  return code !== null && Object.hasOwn(GH_CLI_REFUSALS, code);
}

/** Translate one wire refusal to its operator-facing sentence (EC33). `code` is the refusal body's named code, if any. */
export function translateWireError(status: number, wire: string, code?: string | null): string {
  const detail = wire.trim();
  if (code != null && Object.hasOwn(GH_CLI_REFUSALS, code)) {
    const plain = GH_CLI_REFUSALS[code]!;
    return detail === '' ? plain : `${plain} — ${detail}`;
  }
  if (detail === '') {
    // A body-less refusal still gets an honest, complete sentence — the code
    // is stated in words, never as the bare `API NNN:` framing EC33 retires.
    return `the daemon refused this — it answered HTTP ${status} with no detail`;
  }
  // studio#665: a plan refusal the engine names by token gets its words first, the sentence kept.
  const plan = planRefusalWords(detail);
  if (plan !== null) return `the daemon refused this plan: ${plan} — ${detail}`;
  return `the daemon refused this — ${detail}`;
}

/** A non-2xx answer from either daemon surface. `message` is ALREADY the
 *  translated operator sentence — render it as-is; match on the fields. */
export class ApiError extends Error {
  readonly status: number;
  /** The daemon's raw sentence, verbatim — matching + quoting only, never rendered bare. */
  readonly wire: string;
  /** The parsed JSON body of the refusal, when it was one — for the fields a refusal carries
   *  BESIDE its sentence (crew's skills 409 `{error, revision}`: the live revision a CAS retry needs;
   *  independent review of #263, F-8). `undefined` for a non-JSON body or a bare status. */
  readonly body: unknown;
  constructor(status: number, wire: string, body?: unknown) {
    const code = typeof body === 'object' && body !== null ? (body as { code?: unknown }).code : undefined;
    super(translateWireError(status, wire, typeof code === 'string' ? code : null));
    this.name = 'ApiError';
    this.status = status;
    this.wire = wire;
    this.body = body;
  }
}

/** The `revision` a crew skills 409 body carries (`{error, revision}`), or `null`. */
export function apiRevision(e: unknown): number | null {
  if (!(e instanceof ApiError) || typeof e.body !== 'object' || e.body === null) return null;
  const r = (e.body as Record<string, unknown>)['revision'];
  return typeof r === 'number' && Number.isFinite(r) ? r : null;
}

/** The refusal's HTTP status, or null when `e` is not a wire refusal. */
export function apiStatus(e: unknown): number | null {
  return e instanceof ApiError ? e.status : null;
}

/**
 * The daemon's own sentence when it is already written for a person: a refusal whose body carries one of
 * the named `codes` (crew's plain-words refusals, e.g. `repo_path_missing`: "There is no folder at
 * ~/code/nope. Check the path and try again."). It is the named cause, so it is shown as the line itself
 * (first-run-2 C1); any other refusal keeps the plain sentence with its raw text under Technical details.
 */
export function plainRefusal(e: unknown, codes: readonly string[]): string | null {
  if (!(e instanceof ApiError) || e.status < 400 || e.status >= 500 || typeof e.body !== 'object' || e.body === null) return null;
  const code = (e.body as Record<string, unknown>)['code'];
  const said = e.wire.trim();
  return typeof code === 'string' && codes.includes(code) && said !== '' ? said : null;
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

/**
 * The two-layer forward-compat signal every adoption seam folds: {@link isRouteAbsent}
 * (the crew daemon predates the route) OR a **501** (the route exists but what stands
 * behind it — the embedded engine's method, a store seam, the fold — does not yet).
 * Both mean "nothing to manage here yet, upgrade wicked-crew" and render the named
 * unsupported state; a NAMED 4xx/5xx from a daemon WITH the feature is a real answer
 * and surfaces as one. The per-surface `is<Surface>Unsupported` helpers spell this
 * same pair (diagnostics, steering, memory, proposals, testing, wiki); new seams
 * should call this instead of restating it.
 */
export function isRouteUnsupported(e: unknown): boolean {
  return (e instanceof ApiError && e.status === 501) || isRouteAbsent(e);
}

/**
 * Which state banner a failed read gets (design/UI-CONTRACT.md §4.7; studio#684): `offline` when the
 * service could not be reached at all (the browser's fetch TypeError or no response), else `error`.
 * Any HTTP response, including a gateway/unavailable status, proves the service answered. The raw message never renders in prose — only inside TechDetails.
 */
export function readErrorKind(e: unknown): 'offline' | 'error' {
  if (e instanceof ApiError) return e.status === 0 ? 'offline' : 'error';
  if (e instanceof TypeError) return 'offline';
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return /failed to fetch|networkerror|load failed|network request failed|econnrefused/i.test(msg) ? 'offline' : 'error';
}
