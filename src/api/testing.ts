/**
 * The testing wire — types and calls for the Testing surface (`/testing/:page`): the campaign
 * LAUNCH trigger (`POST /testing/recon` — the pinned multi-codebase scope, with the pre-recon
 * `POST /runs` fallback), the steering EVALS runner (`POST /testing/evals/run`) and the
 * eval-corpus import (`POST /testing/corpora/import`).
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

// The Harness RETIRED as a sub-page (the testing-UX wave): its creation verbs (recon /
// new campaign / add-with-chat) folded into the Campaigns landing's header, and
// `/testing/harness` redirects there (`useTestingRedirect`). Campaigns IS the landing.
export const TESTING_PAGES = ['campaigns', 'evals'] as const;

export type TestingSubPage = (typeof TESTING_PAGES)[number];

export const TESTING_PAGE_LABELS: Record<TestingSubPage, string> = {
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

// ── The testing/campaign LAUNCH wire (the multi-codebase pin) ─────────────────────────────────

/**
 * The launch body for a testing effort — the RECON TRIGGER, `POST /testing/recon` (crew's
 * `TestingReconBody`; this shape mirrors it verbatim).
 *
 * ── INTEGRATION POINT (testing-UX wave, paired crew lane — the PINNED WIRE) ──────────────────
 * Both lanes implement EXACTLY these two OPTIONAL camelCase fields, verbatim, because the
 * steering wave shipped a drift when each side guessed:
 *
 *   `repoRefs`  — explicit codebase attachments (registered repo refs, deduped; each must
 *                 resolve or the whole request 400s naming the bad ref);
 *   `projectId` — crew resolves the project's member repos server-side (404 unknown project;
 *                 400 when the project holds zero repos, the error naming the fix);
 *   BOTH        — the union;  NEITHER — today's behavior unchanged (backward compatible).
 *
 * The pinned fields live on the RECON ROUTE, not on `POST /runs`: the shipping `/runs` zod is
 * strict (`repoRefs` would 400 as an unrecognized key) and its `projectId` means FILING only —
 * it never resolves the project's member repos into launch scope. `POST /runs` with the legacy
 * single `repoRef` survives solely as {@link launchTestingRun}'s fallback for a daemon that
 * predates the recon route. Delete this block and re-export from `wicked-crew-api-types` the
 * moment studio bumps to the api-types version that carries the pinned fields (0.15.0).
 */
export interface TestingLaunchBody {
  problem: string;
  /** PINNED: the project whose member repos crew resolves server-side. */
  projectId?: string;
  /** PINNED: explicit codebase attachments — registered repo refs, deduped. */
  repoRefs?: string[];
}

/**
 * The launch answer. The recon route always answers `{runId, runIds, campaign}` — `runIds`
 * (length ≥ 1: one run per resolved repo, one for an unscoped recon) is the source of truth,
 * `runId` its first entry kept as the single-run spelling ({@link launchedRunIds} folds both).
 * Every field stays optional here because the pre-recon fallback (`POST /runs`) answers only
 * `{runId}` — `campaign` renders only when a daemon actually served it, never fabricated.
 */
export interface TestingLaunchResult {
  runId?: string;
  runIds?: string[];
  campaign?: string;
  [k: string]: unknown;
}

/** Thrown by {@link launchTestingRun} when the scope needs the pinned fields but the daemon
 *  predates `POST /testing/recon` — {@link isMultiScopeUnsupported} matches it. */
export class MultiScopeUnsupportedError extends Error {
  constructor() {
    super('this daemon predates POST /testing/recon and cannot resolve a multi-codebase scope');
    this.name = 'MultiScopeUnsupportedError';
  }
}

/**
 * Launches over the PINNED `POST /testing/recon` wire (the recon trigger — crew fans one
 * governed run per resolved repo under one campaign label and answers `{runId, runIds,
 * campaign}`).
 *
 * The presence-gate, in the adoption-seam idiom: a daemon that predates the recon route
 * answers the bare unknown-route 404 ({@link isRouteAbsent}) — a scope that FITS today's wire
 * (≤ 1 explicit repo, no project) then falls back to the shipping `POST /runs` with the legacy
 * single-`repoRef` spelling, so a one-repo or unscoped launch keeps working against every
 * daemon; a scope that NEEDS the pinned fields throws {@link MultiScopeUnsupportedError} and
 * the caller renders the honest named gap. Any NAMED refusal from a daemon WITH the route
 * (a bad ref, a zero-repo project, an archived project) is a real answer and passes through.
 */
export async function launchTestingRun(body: TestingLaunchBody): Promise<TestingLaunchResult> {
  try {
    return await apiFetch<TestingLaunchResult>('/testing/recon', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  } catch (e) {
    if (!isRouteAbsent(e)) throw e;
    const refs = body.repoRefs ?? [];
    if (body.projectId !== undefined || refs.length > 1) throw new MultiScopeUnsupportedError();
    const legacy: { problem: string; repoRef?: string } = { problem: body.problem };
    if (refs.length === 1) legacy.repoRef = refs[0]!;
    return apiFetch<TestingLaunchResult>('/runs', {
      method: 'POST',
      body: JSON.stringify(legacy),
    });
  }
}

/** The one fold of the launch answer: `runIds` (length ≥ 1) wins; else the legacy `runId`. */
export function launchedRunIds(r: TestingLaunchResult): string[] {
  if (Array.isArray(r.runIds)) {
    const ids = r.runIds.filter((x): x is string => typeof x === 'string' && x !== '');
    if (ids.length >= 1) return ids;
  }
  return typeof r.runId === 'string' && r.runId !== '' ? [r.runId] : [];
}

/**
 * True when THIS daemon cannot serve a multi-codebase launch: {@link launchTestingRun} found
 * `POST /testing/recon` absent while the scope needed the pinned fields (the primary signal),
 * or a strict launch zod refused the pinned keys by name (belt-and-braces for version skew).
 * A named 400 about anything else (a bad ref, a zero-repo project) is a REAL answer and
 * surfaces as one.
 */
export function isMultiScopeUnsupported(e: unknown): boolean {
  if (e instanceof MultiScopeUnsupportedError) return true;
  return e instanceof ApiError && e.status === 400 && /unrecognized key/i.test(e.message);
}

/** The honest in-band copy for {@link isMultiScopeUnsupported} refusals. */
export const MULTI_SCOPE_UNSUPPORTED_COPY =
  'This daemon predates multi-codebase launches — it accepts one repository per launch. ' +
  'Clear the project and extra repositories, keep a single one, and launch again (or upgrade wicked-crew).';

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
  'This daemon cannot run steering evals — the embedded engine predates the eval bindings (requires core-ts 0.7.5). The Campaigns surface still works.';
