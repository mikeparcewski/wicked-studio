/**
 * The testing wire — types and calls for the Testing surface (`/testing/:page`): the steering
 * EVALS runner (`POST /testing/evals/run`) and the eval-corpus import
 * (`POST /testing/corpora/import`).
 *
 * ── INTEGRATION POINT (testing wave, paired core/core-ts/crew lanes) ──────────────────────────
 * These shapes are the wave's PINNED WIRE CONTRACT, implemented verbatim on BOTH sides —
 * crew's route slice and this client — because the steering wave shipped a drift when each
 * side guessed. Do not "improve" a name; a served payload that disagrees with these shapes is
 * a contract bug on whichever side deviated. Like the steering shapes in `./steering.ts`,
 * every declaration here is TEMPORARY: **delete this block and re-export from
 * `wicked-crew-api-types`** the moment studio bumps to the api-types version that carries the
 * testing contract.
 *
 * The report JSON passes the Rust engine's serde output through VERBATIM (snake_case) — crew
 * neither renames nor reshapes it, and neither does this client.
 *
 * The adoption seam is the same two-layer probe as steering: crew presence-gates the routes on
 * the embedded engine's eval bindings (`typeof core.governanceEvals === 'function'`), so a 501
 * means "route present, engine method absent — the engine predates core-ts 0.7.5", and a bare
 * unknown-route 404 means "this crew predates the testing routes". {@link isTestingUnsupported}
 * folds both so every caller renders the honest state, never a raw refusal.
 */

import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

// ── The Testing surface's sub-pages (client route vocabulary, not a wire) ────────────────────

export const TESTING_PAGES = ['harness', 'campaigns', 'evals'] as const;

export type TestingSubPage = (typeof TESTING_PAGES)[number];

export const TESTING_PAGE_LABELS: Record<TestingSubPage, string> = {
  harness: 'Harness',
  campaigns: 'Campaigns',
  evals: 'Evals',
};

export function isTestingSubPage(s: string): s is TestingSubPage {
  return (TESTING_PAGES as readonly string[]).includes(s);
}

/** The one spelling of a testing sub-page's route. */
export function testingPath(page: TestingSubPage): string {
  return `/testing/${page}`;
}

/** One campaign's scoreboard address — MOVED under Testing (the flat `/campaigns/:id`
 *  redirects here; `useTestingRedirect` is the normalizer). */
export function campaignPath(id: string): string {
  return `${testingPath('campaigns')}/${encodeURIComponent(id)}`;
}

// ── Eval samples (shared by the run report and the corpus import) ─────────────────────────────

/** The recall signals one sample carries — what the engine's recall query is built from. */
export interface EvalSampleSignals {
  phase?: string;
  tool?: string;
  files?: string[];
  content?: string;
  [k: string]: unknown;
}

/** One eval sample, exactly as the corpus stores it (snake_case, the serde spelling). */
export interface EvalSample {
  id: string;
  description: string;
  /** `"good"` = behavior the rules should allow; `"bad"` = behavior they should deny. */
  kind: 'good' | 'bad';
  /** One of the seven steering types (see `./steering.ts`). */
  steering_type: string;
  signals: EvalSampleSignals;
  [k: string]: unknown;
}

// ── `POST /testing/evals/run` ─────────────────────────────────────────────────────────────────

export interface RunEvalsBody {
  /** One of the seven steering types; omit = evaluate every type. */
  type?: string;
  /** An estate scope name (e.g. `"evals:dev-behaviors"`); omit = the built-in default corpus. */
  corpus?: string;
}

/** The sample as the report echoes it — the identity fields, not the signals. */
export interface EvalReportSample {
  id: string;
  description: string;
  kind: string;
  steering_type: string;
  [k: string]: unknown;
}

/** A near-miss rule on a gap — how close recall came to firing the right rule. */
export interface EvalNearestRule {
  rule_id: string;
  similarity: number;
  [k: string]: unknown;
}

export interface EvalResult {
  sample: EvalReportSample;
  /** What the rules SHOULD have said about this sample. */
  expected: 'deny' | 'allow';
  /** The rule ids recall actually fired. */
  fired: string[];
  verdict: 'caught' | 'gap' | 'false_positive';
  /** Present on gaps (empty array allowed — recall found nothing nearby). */
  nearest_rules?: EvalNearestRule[];
  [k: string]: unknown;
}

export interface EvalSummary {
  total: number;
  caught: number;
  gaps: number;
  false_positives: number;
  [k: string]: unknown;
}

/** The eval report — the Rust serde output passed through verbatim. */
export interface EvalReport {
  results: EvalResult[];
  summary: EvalSummary;
  /** `"facet-only"` = the engine has no embedder: recall matched on facets alone and
   *  similarity-based gap analysis is degraded. `null` = full recall. */
  degraded: 'facet-only' | null;
  [k: string]: unknown;
}

/** Runs the evals — 200 report | 501 (engine predates the eval bindings) | 400 (zod-invalid). */
export function runEvals(body: RunEvalsBody): Promise<EvalReport> {
  return apiFetch<EvalReport>('/testing/evals/run', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── `POST /testing/corpora/import` ────────────────────────────────────────────────────────────

export interface CorpusImportBody {
  /** The corpus name — the store scopes it as `evals:<name>`. */
  name: string;
  samples: EvalSample[];
}

export interface CorpusImportResult {
  imported: number;
  /** The estate scope the samples landed in: `evals:<name>` — feed it back to {@link runEvals}. */
  scope: string;
  /** False = stored facet-only (no embedder) — evals over this corpus run degraded. */
  embedded: boolean;
  [k: string]: unknown;
}

/** Imports a corpus — 200 result | 501 | 400. */
export function importEvalCorpus(body: CorpusImportBody): Promise<CorpusImportResult> {
  return apiFetch<CorpusImportResult>('/testing/corpora/import', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// ── The adoption seam ─────────────────────────────────────────────────────────────────────────

/**
 * True when this daemon cannot serve the testing wire yet: a 501 (route present, engine
 * bindings absent — the embedded engine predates core-ts 0.7.5) or Fastify's bare
 * unknown-route 404 (crew predates the testing routes). A NAMED 4xx from a daemon WITH the
 * route is a real answer and surfaces as one.
 */
export function isTestingUnsupported(e: unknown): boolean {
  return (e instanceof ApiError && e.status === 501) || isRouteAbsent(e);
}

/** The honest in-band copy for {@link isTestingUnsupported} refusals. */
export const TESTING_UNSUPPORTED_COPY =
  'This daemon cannot run steering evals — the embedded engine predates the eval bindings (requires core-ts 0.7.5). The Harness and Campaigns surfaces still work.';
