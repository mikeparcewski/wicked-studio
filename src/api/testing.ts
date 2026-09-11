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
import type { EvalRunDetail, EvalRunSummary, ListEvalRunsResponse } from './types.js';

// ── The Testing surface's sub-pages (client route vocabulary, not a wire) ────────────────────

// The Harness RETIRED as a sub-page (the testing-UX wave): its creation verbs (recon /
// new campaign / add-with-chat) folded into the Campaigns landing's header, and
// `/testing/harness` redirects there (`useTestingRedirect`). Campaigns IS the landing.
export const TESTING_PAGES = ['campaigns', 'evals'] as const;

export type TestingSubPage = (typeof TESTING_PAGES)[number];

// The `campaigns` sub-page IS the Test section now (usability wave): the rail renames it Test and
// Evals is a separate section beside Steering. The route stays `/testing/campaigns` (the backend's
// campaign grouping is the mechanism); only the user-facing label is Test.
export const TESTING_PAGE_LABELS: Record<TestingSubPage, string> = {
  campaigns: 'Test',
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

// ── The landing's arrival intent (client route vocabulary, not a wire) ────────────────────────

/** The two launch panels the Test landing serves — `recon` ("Run recon") and `campaign` ("New
 *  test"; the key stays the backend's grouping noun, the display is Test). */
export type LaunchIntent = 'recon' | 'campaign';

/**
 * `?new=<word>` on the Test landing opens that intent's launch panel on arrival — the rail's ＋
 * ("New Test") and its "Run recon" row ride it, so a create affordance actually creates instead
 * of landing on a page with nothing open (wicked-studio#203). The words are the USER-facing
 * vocabulary (`test`, never the backend's `campaign`); the landing consumes the query once it
 * has opened the panel, so a second click from the landing itself re-fires.
 */
const LAUNCH_INTENT_PARAM = 'new';
const LAUNCH_INTENT_WORD: Record<LaunchIntent, string> = { campaign: 'test', recon: 'recon' };

/** The Test landing's address with `intent`'s launch panel pre-opened. */
export function testingLaunchPath(intent: LaunchIntent): string {
  return `${testingPath('campaigns')}?${LAUNCH_INTENT_PARAM}=${LAUNCH_INTENT_WORD[intent]}`;
}

/** The launch intent a `location.search` string carries, or `null` — an absent, bare or
 *  foreign `?new=` opens nothing (a mangled bookmark shows the landing, not a panel). */
export function readLaunchIntent(search: string): LaunchIntent | null {
  const raw = new URLSearchParams(search).get(LAUNCH_INTENT_PARAM);
  if (raw === null) return null;
  const hit = (Object.keys(LAUNCH_INTENT_WORD) as LaunchIntent[]).find((k) => LAUNCH_INTENT_WORD[k] === raw);
  return hit ?? null;
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

// ── The GOVERNED test launch (wave 6 — the `qe-author-tests` workflow) ────────────────────────

/** The intake gate every governed test launch pauses at: approve the plan before unit 1 runs
 *  (crew's `RECON_INTAKE_GATE_TOKEN`, spelled once here for the client-side fan). */
export const INTAKE_GATE = 'before:1';

/**
 * Which wire the launch actually rode — stated on the panel, never implied:
 *  - `testing-author`          — `POST /testing/author` (the wave-6 route for the QE workflow);
 *  - `testing-recon-workflow`  — `POST /testing/recon` with the additive `workflow` key;
 *  - `runs-fan`                — one `POST /runs {workflow, repoRef, projectId, humanConfirm}` per
 *                                resolved repo (the SHIPPING wire — `projectId` files, `repoRef`
 *                                scopes — used when the operator NARROWED a project (F-076: the
 *                                recon route unions `projectId`'s members back in) or when the
 *                                daemon lists the workflow but its testing routes predate it);
 *  - `testing-recon-plain`     — today's free-text recon: the daemon has no governed test workflow.
 */
export type GovernedLaunchRoute = 'testing-author' | 'testing-recon-workflow' | 'runs-fan' | 'testing-recon-plain';

/** The panel's scope, as the operator composed it — the pure input `launchGovernedTest` plans from. */
export interface GovernedLaunchScope {
  /** The framed problem statement (the intent prefix + the operator's brief). */
  problem: string;
  projectId: string | null;
  /** The selected project's resolved `crew.repo` members (what `projectId` would union in). */
  projectRepos: string[];
  /** Project members the operator DROPPED from the scope (F-076 / F-7R2-010). */
  excluded: string[];
  /** Explicit attachments (deduped, insertion order). */
  explicit: string[];
  /** The governed workflow id when `GET /workflows` lists it; `null` = plain free-text recon. */
  workflow: string | null;
  /** The label studio mints for a client-side fan of ≥ 2 runs (`LaunchRunBody.groupLabel`). */
  groupLabel: string;
}

export interface GovernedLaunchResult extends TestingLaunchResult {
  route: GovernedLaunchRoute;
  /** The workflow every launched run carries, or `null` for a plain run. */
  workflow: string | null;
  campaignRegistered: boolean;
}

/** The repos the launch will actually cover: explicit attachments ∪ (project members − dropped). */
export function effectiveRepos(scope: Pick<GovernedLaunchScope, 'projectId' | 'projectRepos' | 'excluded' | 'explicit'>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (r: string): void => { if (!seen.has(r)) { seen.add(r); out.push(r); } };
  for (const r of scope.explicit) push(r);
  if (scope.projectId !== null) for (const r of scope.projectRepos) if (!scope.excluded.includes(r)) push(r);
  return out;
}

/** Whether the operator narrowed the selected project — the case the pinned recon body cannot
 *  express (its `projectId` unions every member back in). */
export function isNarrowedProject(scope: Pick<GovernedLaunchScope, 'projectId' | 'excluded'>): boolean {
  return scope.projectId !== null && scope.excluded.length > 0;
}

/** A strict-schema 400 that names `key` as unrecognized — the wire of a daemon whose route predates
 *  the additive field (crew's schemas are `.strict()`; the error names the offending key). */
export function isUnrecognizedKey(e: unknown, key: string): boolean {
  if (!(e instanceof ApiError) || e.status !== 400) return false;
  const wire = e.wire.toLowerCase();
  return /unrecognized key/.test(wire) && wire.includes(key.toLowerCase());
}

/** The panel's mint for a client-side fan label — `test-<base36 clock>-<random>` (1–200 chars). */
export function mintGroupLabel(now: number = Date.now(), rand: string = Math.random().toString(36).slice(2, 10)): string {
  return `test-${now.toString(36)}-${rand}`;
}

function normalizeRecon(raw: TestingLaunchResult, route: GovernedLaunchRoute, workflow: string | null): GovernedLaunchResult {
  const ids = launchedRunIds(raw);
  return {
    ...raw,
    runIds: ids,
    ...(ids.length > 0 ? { runId: ids[0]! } : {}),
    route,
    workflow: typeof raw['workflow'] === 'string' && raw['workflow'] !== '' ? (raw['workflow'] as string) : workflow,
    campaignRegistered: raw['campaignRegistered'] === true,
  };
}

/**
 * One `POST /runs` per repo — the shipping wire, where `repoRef` SCOPES and `projectId` FILES (the
 * §2.2 semantics), with the intake gate on every run and a shared `groupLabel` when there are two
 * or more (they render as one group on `GET /campaigns`). Sequential, so a mid-fan refusal names
 * what already launched. No repo at all ⇒ one repo-less run (the daemon decides what that means
 * for the workflow).
 */
async function launchRunsFan(scope: GovernedLaunchScope, repos: string[]): Promise<GovernedLaunchResult> {
  const targets: Array<string | null> = repos.length > 0 ? repos : [null];
  const runIds: string[] = [];
  const label = targets.length >= 2 ? scope.groupLabel : null;
  for (const repo of targets) {
    const body: Record<string, unknown> = { problem: scope.problem, humanConfirm: INTAKE_GATE };
    if (scope.workflow !== null) body['workflow'] = scope.workflow;
    if (repo !== null) body['repoRef'] = repo;
    if (scope.projectId !== null) body['projectId'] = scope.projectId;
    if (label !== null) body['groupLabel'] = label;
    try {
      const r = await apiFetch<{ runId?: string }>('/runs', { method: 'POST', body: JSON.stringify(body) });
      if (typeof r.runId === 'string' && r.runId !== '') runIds.push(r.runId);
    } catch (e) {
      if (runIds.length > 0) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`launch fan-out failed on ${repo ?? '(unscoped)'} after ${runIds.length} run(s) launched (${runIds.join(', ')}): ${msg}`);
      }
      throw e;
    }
  }
  return {
    runIds,
    ...(runIds.length > 0 ? { runId: runIds[0]! } : {}),
    ...(label !== null ? { campaign: label } : {}),
    route: 'runs-fan',
    workflow: scope.workflow,
    campaignRegistered: false,
  };
}

/**
 * Launch a governed test over the operator's scope (wave 6 — F-075 / F-7R2-003 / F-076).
 *
 * The chain, in order, each step taken only when the previous one's wire is ABSENT (never on a
 * named refusal — a 404 naming a bad ref, a 400 about the scope, a 409, a 500 all surface as
 * answers):
 *  1. a NARROWED project (members dropped) ⇒ the per-repo `POST /runs` fan over the remaining
 *     members ∪ explicit, `projectId` kept for filing — the recon body's `projectId` would union the
 *     dropped members back in; an empty remainder is refused HERE, before any wire call;
 *  2. the workflow is listed ⇒ `POST /testing/author` (route absent ⇒ 3);
 *  3. `POST /testing/recon` + `workflow` (a strict schema naming `workflow` unrecognized ⇒ 4);
 *  4. the per-repo `POST /runs` fan with `workflow` (the shipping wire carries a workflow id);
 *  5. no workflow listed ⇒ today's plain recon ({@link launchTestingRun}) — the panel has already
 *     said "this daemon has no governed test workflow — plain run".
 */
export async function launchGovernedTest(scope: GovernedLaunchScope): Promise<GovernedLaunchResult> {
  const repos = effectiveRepos(scope);
  if (isNarrowedProject(scope)) {
    if (repos.length === 0) {
      throw new Error('every repository of the project was dropped — keep at least one, attach a codebase, or clear the project');
    }
    return launchRunsFan(scope, repos);
  }
  const pinned: TestingLaunchBody = { problem: scope.problem };
  if (scope.projectId !== null) pinned.projectId = scope.projectId;
  if (scope.explicit.length >= 1) pinned.repoRefs = [...new Set(scope.explicit)];
  if (scope.workflow === null) {
    return normalizeRecon(await launchTestingRun(pinned), 'testing-recon-plain', null);
  }
  try {
    const r = await apiFetch<TestingLaunchResult>('/testing/author', { method: 'POST', body: JSON.stringify(pinned) });
    return normalizeRecon(r, 'testing-author', scope.workflow);
  } catch (e) {
    if (!isRouteAbsent(e)) throw e;
  }
  try {
    const r = await apiFetch<TestingLaunchResult>('/testing/recon', {
      method: 'POST',
      body: JSON.stringify({ ...pinned, workflow: scope.workflow }),
    });
    return normalizeRecon(r, 'testing-recon-workflow', scope.workflow);
  } catch (e) {
    if (!isUnrecognizedKey(e, 'workflow') && !isRouteAbsent(e)) throw e;
  }
  return launchRunsFan(scope, repos);
}

/** The honest copy for a daemon whose `GET /workflows` lists no governed test workflow. */
export const NO_GOVERNED_WORKFLOW_COPY =
  'this daemon has no governed test workflow — plain run';

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

// ── The eval RUN history (crew-side EvalRunStore, api-types 0.25.0) ────────────────────────────

/** `GET /testing/evals` — the persisted eval-run history, newest first (global per daemon).
 *  `{ runs: [] }` on a daemon that recorded none (or predates the store). */
export async function listEvalRuns(filter?: { type?: string; corpus?: string }): Promise<EvalRunSummary[]> {
  const q = new URLSearchParams();
  if (filter?.type !== undefined && filter.type !== '') q.set('type', filter.type);
  if (filter?.corpus !== undefined && filter.corpus !== '') q.set('corpus', filter.corpus);
  const qs = q.toString();
  const res = await apiFetch<ListEvalRunsResponse>(`/testing/evals${qs !== '' ? `?${qs}` : ''}`);
  return res.runs;
}

/** `GET /testing/evals/:id` — one run WITH its full per-sample results (the drilldown); 404 unknown. */
export function getEvalRun(id: string): Promise<EvalRunDetail> {
  return apiFetch<EvalRunDetail>(`/testing/evals/${encodeURIComponent(id)}`);
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
  'This daemon cannot run steering evals — the embedded engine predates the eval bindings (requires core-ts 0.7.5). The Test surface still works.';
