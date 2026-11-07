import { ApiError } from '../api/errors.js';

/** The preset whose last step (`wicked-core domain-graph`) writes a repository's requirements graph. */
export const DOMAIN_EXTRACTION_ID = 'domain-extraction';

/**
 * crew's "not generated yet" answer for `GET /repos/:id/requirements`, as a state rather than a
 * refusal (lane repo-page): the 404 carries `code: 'notGenerated'` and the workflow that generates
 * the graph (api-types 0.154.0 `RequirementsNotGenerated`). Returns that workflow, or null when `e`
 * is anything else (an unknown repository's 404 carries no code and stays an error).
 *
 * A daemon from before the typed answer (crew ≤ 0.16.11) sends only its sentence
 * ("requirements_graph.json not generated for this repo yet"); that sentence is read the same way
 * until those daemons are gone.
 */
export function requirementsNotGenerated(e: unknown): { workflow: string; share: RequirementsCoverage | null } | null {
  if (!(e instanceof ApiError) || e.status !== 404) return null;
  const body = typeof e.body === 'object' && e.body !== null ? (e.body as Record<string, unknown>) : {};
  if (body['code'] === 'notGenerated') {
    const wf = body['workflow'];
    // crew api-types 0.164.0: the real share so far, when the repository has a store to count.
    return { workflow: typeof wf === 'string' && wf.trim() !== '' ? wf : DOMAIN_EXTRACTION_ID, share: coverageOf(body) };
  }
  if (/requirements_graph\.json not generated/.test(e.wire)) return { workflow: DOMAIN_EXTRACTION_ID, share: null };
  return null;
}

/**
 * How many independent sources support a requirement (crew api-types 0.159.0
 * `RequirementCorroboration`; operator ruling 2026-10-31 "validation by duplication"). Read off the
 * wire tolerantly: an older daemon sends no field, a graph built before it sends `null`.
 */
export interface Corroboration {
  status: 'validated' | 'unconfirmed';
  sources: number;
  callSites: number;
  tests: number;
  docs: number;
  extraExtractors: number;
  why?: { code: string; text: string };
}

/**
 * How much of a repository's behaviour REAL requirements cover (crew api-types 0.164.0 `RequirementsCoverage`;
 * domain-real WIRE 2026-11-01). `real + placeholders + unmapped == behaviorBearing`; `notProduct` (tests, data,
 * manifests, docs) is left out of it. `realPct` counts real requirements only: a placeholder is unconfirmed and is
 * never shown as progress.
 */
export interface RequirementsCoverage {
  realPct: number;
  minPct: number;
  behaviorBearing: number;
  real: number;
  placeholders: number;
  unmapped: number;
  notProduct: number;
}

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

/** An item's corroboration, or null when the daemon sent none (or something unreadable). */
export function corroborationOf(item: unknown): Corroboration | null {
  const c = (item as { corroboration?: unknown } | null)?.corroboration as Record<string, unknown> | null | undefined;
  if (c === null || c === undefined || typeof c !== 'object') return null;
  if (c['status'] !== 'validated' && c['status'] !== 'unconfirmed') return null;
  const counts = ['sources', 'callSites', 'tests', 'docs', 'extraExtractors'] as const;
  if (!counts.every((k) => isCount(c[k]))) return null;
  const out: Corroboration = {
    status: c['status'],
    sources: c['sources'] as number,
    callSites: c['callSites'] as number,
    tests: c['tests'] as number,
    docs: c['docs'] as number,
    extraExtractors: c['extraExtractors'] as number,
  };
  const why = c['why'] as { code?: unknown; text?: unknown } | undefined;
  if (why && typeof why.code === 'string' && typeof why.text === 'string' && why.text.trim() !== '') {
    out.why = { code: why.code, text: why.text };
  }
  return out;
}

const COVERAGE_KEYS = ['realPct', 'minPct', 'behaviorBearing', 'real', 'placeholders', 'unmapped', 'notProduct'] as const;

/**
 * The coverage a requirements read carries (a page's `coverage`, or the `coverage` of crew's notGenerated 404), or
 * null when the daemon or the graph predates it, or sends the retired `mappedPct` shape.
 */
export function coverageOf(holder: unknown): RequirementsCoverage | null {
  const c = (holder as { coverage?: unknown } | null)?.coverage as Record<string, unknown> | null | undefined;
  if (c === null || c === undefined || typeof c !== 'object') return null;
  if (!COVERAGE_KEYS.every((k) => isCount(c[k]))) return null;
  const out = Object.fromEntries(COVERAGE_KEYS.map((k) => [k, c[k]])) as unknown as RequirementsCoverage;
  if (out.realPct > 100 || out.minPct < 1 || out.minPct > 100) return null;
  return out;
}

const count = (n: number): string => n.toLocaleString('en-US');

/** "54% real requirements · minimum 80%" ("Under 1%" when some are real and the whole percentage rounds to 0). */
export function coverageHeadline(c: RequirementsCoverage): string {
  const pct = c.realPct === 0 && c.real > 0 ? 'Under 1%' : `${c.realPct}%`;
  return `${pct} real requirements · minimum ${c.minPct}%`;
}

export interface CoveragePart {
  key: 'real' | 'placeholders' | 'unmapped' | 'notProduct';
  text: string;
}

/** "3,182 real · 2,577 placeholders · 27 unmapped · 2,380 not product code": real always, the rest when there are any. */
export function coverageParts(c: RequirementsCoverage): CoveragePart[] {
  const parts: CoveragePart[] = [{ key: 'real', text: `${count(c.real)} real` }];
  if (c.placeholders > 0) parts.push({ key: 'placeholders', text: `${count(c.placeholders)} ${c.placeholders === 1 ? 'placeholder' : 'placeholders'}` });
  if (c.unmapped > 0) parts.push({ key: 'unmapped', text: `${count(c.unmapped)} unmapped` });
  if (c.notProduct > 0) parts.push({ key: 'notProduct', text: `${count(c.notProduct)} not product code` });
  return parts;
}

export function coverageBreakdown(c: RequirementsCoverage): string {
  return coverageParts(c).map((p) => p.text).join(' · ');
}

/**
 * Whether a listed requirement is a placeholder rather than a real requirement. The engine decides it (real = a
 * validated requirement, or a rule at or above the resolve threshold, 0.75), and crew sends that verdict as
 * `placeholder` on each item; a daemon from before the field is read off the statement, the engine's risk floor
 * ("[RISK] devDependencies: empty statement …"), which misses plain rules below the threshold. A placeholder is
 * unconfirmed by definition, so it never shows as validated.
 */
export function isPlaceholder(req: { statement: string; placeholder?: unknown }): boolean {
  if (typeof req.placeholder === 'boolean') return req.placeholder;
  return /^\[RISK\]/u.test(req.statement.trim());
}

/** Which graph build the list is, against the store the header counts (crew api-types 0.165.0 `page.graphBuild`). */
export interface GraphBuild {
  generation: number;
  coverage: RequirementsCoverage | null;
  behind: boolean;
}

/** A page's `graphBuild`, or null when absent or malformed (then the view claims nothing about it). */
export function graphBuildOf(page: unknown): GraphBuild | null {
  const g = (page as { graphBuild?: unknown } | null)?.graphBuild as Record<string, unknown> | null | undefined;
  if (g === null || g === undefined || typeof g !== 'object') return null;
  if (typeof g['behind'] !== 'boolean' || !isCount(g['generation'])) return null;
  return { generation: g['generation'], coverage: coverageOf(g), behind: g['behind'] };
}

/** One sentence when the list does not hold what the header counts; null otherwise. */
export function graphBuildNote(live: RequirementsCoverage, b: GraphBuild | null): string | null {
  if (b === null || !b.behind) return null;
  const next = live.realPct >= live.minPct
    ? 'build the graph to list them'
    : `the graph is built at ${live.minPct}% real, or when you lower this repository's minimum at the job's ask`;
  if (b.coverage === null) {
    return `This list is a graph built before real requirements were counted. The ${count(live.real)} real requirements mapped now are kept, not listed: ${next}.`;
  }
  if (b.coverage.real < live.real) {
    return `This list is the graph as last built (${count(b.coverage.real)} real). ${count(live.real - b.coverage.real)} real requirements mapped since are kept, not listed: ${next}.`;
  }
  return `The repository changed since this graph was built: ${next.replace('list them', 'list what it holds now')}.`;
}

/**
 * Why a listed requirement is not counted in the coverage share (crew api-types 0.167.0 `uncounted`): it sits on a type
 * shape, on code that is not the product, or in a file the code index skipped. null when it counts, or when the daemon
 * predates the field.
 */
export type Uncounted = 'structural' | 'not_product' | 'unindexed';
export function uncountedOf(item: unknown): Uncounted | null {
  const u = (item as { uncounted?: unknown } | null)?.uncounted;
  return u === 'structural' || u === 'not_product' || u === 'unindexed' ? u : null;
}

/** What a "not counted" mark says, per reason. */
export const UNCOUNTED_TITLE: Readonly<Record<Uncounted, string>> = {
  structural: 'A type shape, not a behaviour: the coverage share does not count it.',
  not_product: 'Not product code (a test, data, a manifest or a doc): the coverage share does not count it.',
  unindexed: 'In a file the code index skipped: the coverage share does not count it.',
};

/** The page's counts of stated rules and placeholders on type shapes (0.167.0 `page.uncounted`), or null. */
export function pageUncountedOf(page: unknown): { stated: number; placeholders: number } | null {
  const u = (page as { uncounted?: unknown } | null)?.uncounted as Record<string, unknown> | null | undefined;
  if (u === null || u === undefined || typeof u !== 'object' || !isCount(u['stated']) || !isCount(u['placeholders'])) return null;
  return { stated: u['stated'], placeholders: u['placeholders'] };
}

/** "441 stated rules and 1,017 placeholders sit on type shapes and are not counted.", or null when there are none. */
export function uncountedLine(u: { stated: number; placeholders: number } | null): string | null {
  if (u === null || u.stated + u.placeholders === 0) return null;
  const parts = [
    ...(u.stated > 0 ? [`${count(u.stated)} stated ${u.stated === 1 ? 'rule' : 'rules'}`] : []),
    ...(u.placeholders > 0 ? [`${count(u.placeholders)} ${u.placeholders === 1 ? 'placeholder' : 'placeholders'}`] : []),
  ];
  const verb = u.stated + u.placeholders === 1 ? 'sits on a type shape and is' : 'sit on type shapes and are';
  return `${parts.join(' and ')} ${verb} not counted.`;
}

/** How many config-and-data requirements the corpus holds (0.167.0 `page.categories.configData`), or null. */
export function configDataCountOf(page: unknown): number | null {
  const c = (page as { categories?: unknown } | null)?.categories as Record<string, unknown> | null | undefined;
  return c !== null && c !== undefined && typeof c === 'object' && isCount(c['configData']) ? c['configData'] : null;
}

/** What a placeholder is, said wherever the count shows: unconfirmed, never progress. */
export const PLACEHOLDER_NOTE = 'Placeholders are unconfirmed: no real requirement has been stated for them yet, so they do not count toward the share.';

/** The corpus-wide validated / unconfirmed counts, or null when the daemon sends none. */
export function corroborationCounts(page: unknown): { validated: number; unconfirmed: number } | null {
  const c = (page as { corroboration?: unknown } | null)?.corroboration as Record<string, unknown> | null | undefined;
  if (c === null || c === undefined || typeof c !== 'object') return null;
  if (!isCount(c['validated']) || !isCount(c['unconfirmed'])) return null;
  if (c['validated'] + c['unconfirmed'] === 0) return null;
  return { validated: c['validated'], unconfirmed: c['unconfirmed'] };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** "Validated by 3 independent sources: 1 caller, 1 test, 1 doc." */
export function corroborationSentence(c: Corroboration): string {
  if (c.status === 'unconfirmed') return c.why?.text ?? 'Nothing else in the repository corroborates it yet.';
  const parts: string[] = [];
  if (c.callSites > 0) parts.push(plural(c.callSites, 'caller', 'callers'));
  if (c.tests > 0) parts.push(plural(c.tests, 'test', 'tests'));
  if (c.docs > 0) parts.push(plural(c.docs, 'doc', 'docs'));
  if (c.extraExtractors > 0) parts.push(plural(c.extraExtractors, 'more extractor agreeing', 'more extractors agreeing'));
  return `Validated by ${plural(c.sources, 'independent source', 'independent sources')}: ${parts.join(', ')}.`;
}

/**
 * How old the code behind the listed build is (crew api-types 0.196.0 `codeDrift`; operator ruling 2026-11-06): the
 * engine counted it with git in the registered checkout. `commitsBehind`/`builtAt` are null when it could not tell.
 */
export interface CodeDrift {
  builtFromCommit: string;
  builtAt: string | null;
  commitsBehind: number | null;
}

/** A page's `codeDrift`, or null when absent or malformed (an older daemon: the view claims nothing). */
export function codeDriftOf(page: unknown): CodeDrift | null {
  const d = (page as { codeDrift?: unknown } | null)?.codeDrift as Record<string, unknown> | null | undefined;
  if (d === null || d === undefined || typeof d !== 'object') return null;
  const commit = d['builtFromCommit'];
  if (typeof commit !== 'string' || !/^[0-9a-f]{4,64}$/u.test(commit)) return null;
  const at = d['builtAt'];
  const behind = d['commitsBehind'];
  return {
    builtFromCommit: commit,
    builtAt: typeof at === 'string' && at !== '' ? at : null,
    commitsBehind: isCount(behind) ? behind : null,
  };
}

/** "Nov 1" (with the year when it is not `now`'s), or null for a date that does not parse. */
function shortDate(iso: string, now: Date): string | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (t.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return t.toLocaleDateString('en-US', opts);
}

/**
 * "Built from code 69 commits old (Nov 1)": said only when the code has moved on (null at 0 commits, and when the
 * daemon could not count: an unknown age is not a claim either way).
 */
export function codeDriftLine(d: CodeDrift | null, now: Date = new Date()): string | null {
  if (d === null || d.commitsBehind === null || d.commitsBehind === 0) return null;
  const date = d.builtAt !== null ? shortDate(d.builtAt, now) : null;
  const n = d.commitsBehind;
  return `Built from code ${count(n)} ${n === 1 ? 'commit' : 'commits'} old${date !== null ? ` (${date})` : ''}`;
}

/** The minimum in force and where it comes from (crew api-types 0.196.0 `minimum`). */
export interface RequirementsMinimum {
  pct: number;
  source: 'repo' | 'settings';
  repoPct: number | null;
  settingsPct: number | null;
}

const isPct = (v: unknown): v is number => isCount(v) && v >= 1 && v <= 100;

/** The `minimum` a page (or crew's notGenerated 404 body) carries, or null when absent or malformed. */
export function minimumOf(holder: unknown): RequirementsMinimum | null {
  const m = (holder as { minimum?: unknown } | null)?.minimum as Record<string, unknown> | null | undefined;
  if (m === null || m === undefined || typeof m !== 'object') return null;
  const { pct, source, repoPct, settingsPct } = m;
  if (!isPct(pct) || (source !== 'repo' && source !== 'settings')) return null;
  return {
    pct,
    source,
    repoPct: isPct(repoPct) ? repoPct : null,
    settingsPct: isPct(settingsPct) ? settingsPct : null,
  };
}

/** "Minimum 66%, this repository's own (Settings: 80%)" / "Minimum 80%, from Settings". */
export function minimumLine(m: RequirementsMinimum): string {
  if (m.source === 'repo') {
    return `Minimum ${m.pct}%, this repository's own${m.settingsPct !== null ? ` (Settings: ${m.settingsPct}%)` : ''}`;
  }
  return `Minimum ${m.pct}%, from Settings`;
}

/** An item's `codeMismatch` (crew api-types 0.196.0): how the code does not meet it, or null. */
export function codeMismatchOf(item: unknown): string | null {
  const v = (item as { codeMismatch?: unknown } | null)?.codeMismatch;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

/** How many rows of the corpus have a code mismatch (crew api-types 0.196.0 `mismatches`), or null when not said. */
export function mismatchCountOf(page: unknown): number | null {
  const v = (page as { mismatches?: unknown } | null)?.mismatches;
  return isCount(v) ? v : null;
}
