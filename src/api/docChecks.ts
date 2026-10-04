import { apiFetch } from './client.js';
import { ApiError, isRouteAbsent } from './errors.js';

/**
 * A document's checks — crew's ONE checks read (DES-EDITOR-PLUGINS-001 §5.8, §7.6; crew EP-C2,
 * `GET /projects/:projectId/interactive/docs/:doc/checks?version=`). Every verdict behind it is a
 * wicked-ledger row stamped with the crew run that produced it.
 *
 * The types are HAND-MIRRORED from `wicked-crew-api-types` 0.88.0 (`DocCheck`, `DocChecksResponse`):
 * studio still pins 0.40.0, and the pin bump is its own change. Field for field; nothing added.
 */

export type DocReviewerId = 'match' | 'a11y' | 'copy' | 'qe';
export type DocCheckSource = 'review:intent' | 'review:a11y' | 'review:copy' | 'review:quality';

export interface DocCheckFinding {
  /** The `data-wid` the finding is about; `null` = about the page as a whole. */
  wid: string | null;
  severity: 'low' | 'medium' | 'high';
  sentence: string;
}

export interface DocCheck {
  id: string;
  source: DocCheckSource;
  reviewer: DocReviewerId;
  /** The version that was reviewed: older than the one shown = "on version N". */
  version: number;
  state: 'pass' | 'fail' | 'inconclusive';
  sentence: string;
  findings: DocCheckFinding[];
  /** `evaluator` is true only when the authoring runs are on record AND this seat is not one of them. */
  by: { seat: string | null; evaluator: boolean; excluded_seats: string[]; author_known: boolean };
  skill: string | null;
  run_id: string;
  at: string;
}

export interface DocChecksResponse {
  document_id: string;
  version: number | null;
  checks: DocCheck[];
}

/** The read, as the panel takes it: the checks; no such route (an older daemon — no panel); or a
 *  read that failed, with why (never an empty list pretending the page was never reviewed). */
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
