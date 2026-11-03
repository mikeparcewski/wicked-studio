import { proposalKind, type Proposal } from '../api/proposals.js';

/**
 * NOT ACCEPTED (operator 2026-11-01: "an active/proposed pill like steering except I want to add Not
 * Accepted for review as well"): the proposals that were rejected, read back from the queue.
 *
 * The store keeps a rejected proposal (estate marks it `rejected`, it never deletes it), so this is a
 * fold over `GET /proposals` (every state). Every rejected proposal of the page's kind is listed; none is
 * hidden, because the wire carries no record of who rejected one or why (review r2). What the rows do
 * carry is said on them:
 *  - an ORIGINAL that an approved MEMORY proposal names in `payload.edited_from`: crew's accept-with-edit
 *    (`api/capture.ts`, memory only) approves an edited copy that names its original, then rejects the
 *    original. `replacedBy` maps it to that copy. The field is the filer's payload, not a crew-signed
 *    link (review r3), so the row states the record ("named as the original of an accepted edit"), never
 *    that its words were kept;
 *  - an edited COPY (it names an original itself): crew rejects one when approving it failed, or a
 *    person rejected it. {@link editedFrom} reads it.
 */
export interface NotAccepted {
  /** The rejected proposals of the kind, newest first. */
  rows: Proposal[];
  /** A listed memory original → the approved memory proposal that names it in `edited_from`. */
  replacedBy: ReadonlyMap<string, string>;
}

/** The proposal an edited copy was made from (`payload.edited_from`), or null. */
export function editedFrom(p: Proposal): string | null {
  const rec = typeof p.payload === 'object' && p.payload !== null ? (p.payload as Record<string, unknown>) : null;
  const from = rec?.['edited_from'];
  return typeof from === 'string' && from !== '' ? from : null;
}

export function notAccepted(all: readonly Proposal[], kind: 'memory' | 'policy'): NotAccepted {
  const copies = new Map<string, string>();
  for (const p of all) {
    // Crew edits memory proposals only: a policy naming an original is not one of its edits.
    const from = kind === 'memory' && p.state === 'approved' && proposalKind(p) === 'memory' ? editedFrom(p) : null;
    if (from !== null && !copies.has(from)) copies.set(from, p.id);
  }
  const rows = all.filter((p) => p.state === 'rejected' && proposalKind(p) === kind)
    .sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0) || a.id.localeCompare(b.id));
  const replacedBy = new Map<string, string>();
  for (const p of rows) { const copy = copies.get(p.id); if (copy !== undefined) replacedBy.set(p.id, copy); }
  return { rows, replacedBy };
}
