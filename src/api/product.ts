import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';
import type {
  ProductComposeBody, ProductComposeResponse, ProjectAggregateRowState, ProjectCoverageResponse,
  ProjectCoverageRow, ProjectDomainResponse, ProjectDomainRow, ProjectRequirementsResponse, ProjectRequirementsRow,
  RequirementSummary,
} from 'wicked-crew-api-types';

export type {
  ProductComposeBody, ProductComposeResponse, ProjectAggregateRowState, ProjectCoverageResponse,
  ProjectCoverageRow, ProjectDomainResponse, ProjectDomainRow, ProjectRequirementsResponse, ProjectRequirementsRow,
  RequirementSummary,
};

/**
 * The project folds crew serves (crew#371, api-types 0.101.0) and the Product compose launch
 * (crew#372). Studio renders crew's fold and never folds per-repo answers itself
 * (design/ST4-PRODUCT-VIEW.md). A read is the answer, the route's absence (an older daemon: the
 * surface is not drawn), or a failure with crew's sentence — never an empty list standing in for one.
 */
export type AggregateRead<T> = { state: 'ok'; body: T } | { state: 'absent' } | { state: 'failed'; why: string };

function why(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

async function read<T>(path: string): Promise<AggregateRead<T>> {
  try {
    return { state: 'ok', body: await apiFetch<T>(path) };
  } catch (e) {
    if (isRouteAbsent(e)) return { state: 'absent' };
    return { state: 'failed', why: why(e) };
  }
}

const base = (projectId: string): string => `/projects/${encodeURIComponent(projectId)}`;

/** `GET /projects/:id/coverage` — each member repo's own coverage report, plus weighted totals. */
export function getProjectCoverage(projectId: string): Promise<AggregateRead<ProjectCoverageResponse>> {
  return read<ProjectCoverageResponse>(`${base(projectId)}/coverage`);
}

/** `GET /projects/:id/domain` — per-repo domain summaries and the merged domain list. */
export function getProjectDomain(projectId: string): Promise<AggregateRead<ProjectDomainResponse>> {
  return read<ProjectDomainResponse>(`${base(projectId)}/domain`);
}

export interface RequirementsQuery { q?: string; offset?: number; limit?: number }

/** `GET /projects/:id/requirements` — one global window over the project's repos. */
export function getProjectRequirements(projectId: string, query: RequirementsQuery = {}): Promise<AggregateRead<ProjectRequirementsResponse>> {
  const p = new URLSearchParams();
  if (query.q !== undefined && query.q.trim() !== '') p.set('q', query.q.trim());
  if (query.offset !== undefined && query.offset > 0) p.set('offset', String(query.offset));
  if (query.limit !== undefined) p.set('limit', String(query.limit));
  const qs = p.toString();
  return read<ProjectRequirementsResponse>(`${base(projectId)}/requirements${qs === '' ? '' : `?${qs}`}`);
}

/** `POST /projects/:id/product/compose` — launches the governed draft run; a refusal throws with
 *  crew's sentence (an unknown requirement ref is a 400 naming it, nothing launched). */
export function composeProduct(projectId: string, body: ProductComposeBody): Promise<ProductComposeResponse> {
  return apiFetch<ProductComposeResponse>(`${base(projectId)}/product/compose`, { method: 'POST', body: JSON.stringify(body) });
}

/** How a non-`ok` row reads: its state and crew's reason, verbatim. */
export function rowWhy(row: { state: ProjectAggregateRowState; reason?: string }): string {
  const word = row.state === 'absent' ? 'not generated yet' : row.state === 'dangling' ? 'no longer registered' : 'could not be read';
  return row.reason !== undefined && row.reason !== '' ? `${word} — ${row.reason}` : word;
}
