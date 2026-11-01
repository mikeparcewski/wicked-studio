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
 * Whether a listed requirement is a placeholder rather than a real requirement: its statement is the engine's risk
 * floor ("[RISK] devDependencies: empty statement (model could not state a rule)", or a statement below the
 * confidence threshold). A placeholder is unconfirmed by definition, so it never shows as validated.
 */
export function isPlaceholder(req: { statement: string }): boolean {
  return /^\[RISK\]/u.test(req.statement.trim());
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
