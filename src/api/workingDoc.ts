import { apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';

/**
 * A run's WORKING DOCUMENT (program DES-POWER-MODE §8.3, §9; spike 3): crew's `GET|POST /runs/:id/working-doc` and
 * `POST /runs/:id/working-doc/versions`. The wire shapes are crew-api-types 0.148.0's (`WorkingDocView`, …), spelled
 * here because studio builds against an older published contract; they are the same fields.
 */

export type WorkingDocSectionId = 'goal' | 'approach' | 'decisions' | 'constraints' | 'questions' | 'next';
export const WORKING_DOC_SECTIONS: readonly WorkingDocSectionId[] = ['goal', 'approach', 'decisions', 'constraints', 'questions', 'next'];

/** `agent`: the orchestrator's own Approach and Decisions, written by crew as `agent:<seat>` (it never steers). */
export type WorkingDocAuthor = { kind: 'human'; id: string } | { kind: 'plugin'; id: string } | { kind: 'system'; id: 'crew' } | { kind: 'agent'; id: string };

export interface WorkingDocTrailEntry {
  version: number;
  parent: number | null;
  author: WorkingDocAuthor;
  surface: string | null;
  sections: WorkingDocSectionId[];
  at: number;
  steerId: string | null;
}

export interface WorkingDocSteer {
  id: string;
  version: number;
  sections: WorkingDocSectionId[];
  kind: 'next' | 'standing';
  note: string;
  at: number;
  by: string;
  queuedAt: number | null;
  pickedUp: { ord: number | null; step: string | null; at: number } | null;
  error: string | null;
  supersededBy?: string | null;
  renewals?: number;
}

export interface WorkingDocView {
  runId: string;
  doc: { projectId: string; docId: string; head: number } | null;
  sections: Record<WorkingDocSectionId, string> | null;
  labels: Record<WorkingDocSectionId, string>;
  trail: WorkingDocTrailEntry[];
  steers: WorkingDocSteer[];
}

export interface ProposeWorkingDoc {
  base: number;
  sections: Partial<Record<WorkingDocSectionId, string>>;
  author: 'operator' | 'plugin';
  plugin?: { id: string; version: string };
}

export interface ProposeWorkingDocResult {
  version: number | null;
  unchanged: boolean;
  steer: WorkingDocSteer | null;
  view: WorkingDocView;
}

const path = (runId: string): string => `/runs/${encodeURIComponent(runId)}/working-doc`;

/** The run's working document, or `null` when this daemon has no working documents (an older crew). */
export async function getWorkingDoc(runId: string): Promise<WorkingDocView | null> {
  try {
    return await apiFetch<WorkingDocView>(path(runId));
  } catch (e) {
    if (isRouteUnsupported(e)) return null;
    throw e;
  }
}

/** Make the run's working document (idempotent): the first edit does this, never a page view. */
export function ensureWorkingDoc(runId: string): Promise<WorkingDocView> {
  return apiFetch<WorkingDocView>(path(runId), { method: 'POST' });
}

export function proposeWorkingDoc(runId: string, body: ProposeWorkingDoc): Promise<ProposeWorkingDocResult> {
  return apiFetch<ProposeWorkingDocResult>(`${path(runId)}/versions`, { method: 'POST', body: JSON.stringify(body) });
}
