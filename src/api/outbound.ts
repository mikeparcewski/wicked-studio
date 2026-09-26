import type { SessionStatus } from './types.js';
import { apiBase } from './client.js';
import { ApiError } from './errors.js';

/**
 * The outbound harness's data (studio wave 1): drafting what the operator sends OUT about a
 * run — a PR description, or a status update — from the run record the daemon already holds.
 *
 * The source is crew's `GET /runs/:id/deliver-text` (crew#524): text/plain, framed as
 * line 1 the title, line 2 blank, then the body — composed from the persisted run record
 * (seats, checks, the evaluator's verdict). The same text the deliver phase puts on its PR.
 *
 *   pr      the composition verbatim (a finished run's PR title + body)
 *   status  the same composition headed as a status update (a run still in flight, or one
 *           that did not complete — there is no PR to describe, only where it stands)
 */
export type OutboundKind = 'pr' | 'status';

export interface OutboundDraft {
  kind: OutboundKind;
  runId: string;
  text: string;
}

/** Which draft a run gets: a completed run has a PR to describe; anything else, a status. */
export function outboundKindFor(status: SessionStatus): OutboundKind {
  return status === 'completed' ? 'pr' : 'status';
}

export const STATUS_HEAD = 'Status update: ';

/** What the harness is drafting, in the operator's words. */
export const OUTBOUND_TITLE: Record<OutboundKind, string> = {
  pr: 'Draft update: pull request',
  status: 'Draft update: status',
};

export async function draftOutbound({ kind, runId }: { kind: OutboundKind; runId: string }): Promise<OutboundDraft> {
  const res = await fetch(`${apiBase()}/runs/${encodeURIComponent(runId)}/deliver-text`);
  const body = await res.text();
  if (!res.ok) {
    let msg = body;
    try {
      const parsed = JSON.parse(body) as { error?: unknown };
      if (typeof parsed.error === 'string') msg = parsed.error;
    } catch { /* not JSON — keep the raw text */ }
    throw new ApiError(res.status, msg || res.statusText);
  }
  const text = kind === 'status' ? `${STATUS_HEAD}${body}` : body;
  return { kind, runId, text };
}
