/**
 * A run's learnings (crew `GET /runs/:id/learnings`, `wicked-crew-api-types` 0.152.0 `RunLearningsResponse`): what the
 * run proposed to the approve queue, by state, and whether its distil seat is still reading the run. Restated here
 * because studio builds against an older published contract. `null` when the daemon has no such route (an older crew).
 */

import { apiFetch } from './client.js';
import { isRouteUnsupported } from './errors.js';

export interface RunLearnings {
  runId: string;
  proposed: number;
  pending: number;
  approved: number;
  rejected: number;
  distilling: boolean;
  items: Array<{ id: string; state: string; capture: string | null; content: string; agent: string | null; createdAt: number | null }>;
}

export async function getRunLearnings(runId: string): Promise<RunLearnings | null> {
  try {
    const l = await apiFetch<RunLearnings>(`/runs/${encodeURIComponent(runId)}/learnings`);
    // Anything but the answer's shape (a proxy page, an older route) says nothing rather than "undefined learnings".
    return typeof l === 'object' && l !== null && typeof l.proposed === 'number' && typeof l.pending === 'number' ? l : null;
  } catch (e) {
    if (isRouteUnsupported(e)) return null;
    throw e;
  }
}

/** The Memory page's review queue, narrowed to one run's learnings. */
export function runLearningsPath(runId: string): string {
  return `/memory?view=proposals&run=${encodeURIComponent(runId)}`;
}

/** The end card's words: "3 learnings proposed · 2 waiting for you". `null` when there is nothing to say. */
export function runLearningsWords(l: RunLearnings | null): string | null {
  if (l === null) return null;
  if (l.proposed === 0) return l.distilling ? 'Distilling what this run learned…' : null;
  const head = `${l.proposed} ${l.proposed === 1 ? 'learning' : 'learnings'} proposed`;
  const tail = l.pending > 0 ? `${l.pending} waiting for you` : l.approved > 0 ? `${l.approved} kept` : 'all decided';
  return `${head} · ${tail}${l.distilling ? ' · more coming' : ''}`;
}
