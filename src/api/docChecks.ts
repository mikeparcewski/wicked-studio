import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

/** The read, as the panel takes it: the checks; no such route (an older daemon — no panel); or a
 *  read that failed, with why (never an empty list pretending the page was never reviewed). */
import type { DocReviewerId, DocCheckSource, DocCheckFinding, DocCheck, DocChecksResponse } from 'wicked-crew-api-types';
export type { DocReviewerId, DocCheckSource, DocCheckFinding, DocCheck, DocChecksResponse };

export type ChecksRead = { state: 'ok'; checks: DocCheck[] } | { state: 'absent' } | { state: 'failed'; why: string };

export async function getDocChecks(projectId: string, docId: string, version: number): Promise<ChecksRead> {
  try {
    const r = await apiFetch<DocChecksResponse>(`/projects/${encodeURIComponent(projectId)}/interactive/docs/${encodeURIComponent(docId)}/checks?version=${version}`);
    return { state: 'ok', checks: Array.isArray(r.checks) ? r.checks : [] };
  } catch (e) {
    if (isRouteAbsent(e)) return { state: 'absent' };
    return { state: 'failed', why: e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e) };
  }
}
