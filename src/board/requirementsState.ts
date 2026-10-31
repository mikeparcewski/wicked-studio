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
export function requirementsNotGenerated(e: unknown): { workflow: string } | null {
  if (!(e instanceof ApiError) || e.status !== 404) return null;
  const body = typeof e.body === 'object' && e.body !== null ? (e.body as Record<string, unknown>) : {};
  if (body['code'] === 'notGenerated') {
    const wf = body['workflow'];
    return { workflow: typeof wf === 'string' && wf.trim() !== '' ? wf : DOMAIN_EXTRACTION_ID };
  }
  if (/requirements_graph\.json not generated/.test(e.wire)) return { workflow: DOMAIN_EXTRACTION_ID };
  return null;
}

/**
 * How many independent sources support a requirement (crew api-types 0.157.0
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

/** The share of behaviours a requirements graph maps (api-types 0.157.0 `RequirementsCoverage`). */
export interface RequirementsCoverage {
  mappedPct: number;
  minPct: number;
  behaviorBearing: number;
  mapped: number;
  resolved: number;
  unmapped: number;
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

/** A page's coverage label, or null when the daemon or the graph predates it. */
export function coverageOf(page: unknown): RequirementsCoverage | null {
  const c = (page as { coverage?: unknown } | null)?.coverage as Record<string, unknown> | null | undefined;
  if (c === null || c === undefined || typeof c !== 'object') return null;
  const keys = ['mappedPct', 'minPct', 'behaviorBearing', 'mapped', 'resolved', 'unmapped'] as const;
  if (!keys.every((k) => isCount(c[k]))) return null;
  return Object.fromEntries(keys.map((k) => [k, c[k]])) as unknown as RequirementsCoverage;
}

/** The corpus-wide validated / unconfirmed counts, or null when the daemon sends none. */
export function corroborationCounts(page: unknown): { validated: number; unconfirmed: number } | null {
  const c = (page as { corroboration?: unknown } | null)?.corroboration as Record<string, unknown> | null | undefined;
  if (c === null || c === undefined || typeof c !== 'object') return null;
  if (!isCount(c['validated']) || !isCount(c['unconfirmed'])) return null;
  if (c['validated'] + c['unconfirmed'] === 0) return null;
  return { validated: c['validated'], unconfirmed: c['unconfirmed'] };
}

/** "82% of behaviours mapped" — the graph's coverage label. */
export function coverageLabel(c: RequirementsCoverage): string {
  return `${c.mappedPct}% of behaviours mapped`;
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
