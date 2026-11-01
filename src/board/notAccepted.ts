import { proposalKind, type Proposal } from '../api/proposals.js';

/**
 * NOT ACCEPTED (operator 2026-11-01: "an active/proposed pill like steering except I want to add Not
 * Accepted for review as well"): the proposals that were rejected, read back from the queue.
 *
 * The store keeps a rejected proposal (estate marks it `rejected`, it never deletes it), so this is a
 * fold over `GET /proposals` (every state). One kind of rejected row is provably not a turn-down and is
 * left out (and counted): the ORIGINAL of an accepted edit. Crew's accept-with-edit (`api/capture.ts`)
 * approves an edited copy whose payload names the original in `edited_from`, then rejects the original;
 * its words were accepted, in the edited form. Every other rejected row is listed. That includes an
 * edited copy that was rejected (crew withdraws one when its approve fails, or a person rejected it);
 * the wire can't tell those apart, so the row says it is an edited copy rather than guessing why.
 */
export interface NotAccepted {
  /** The rejected proposals listed, newest first. */
  rows: Proposal[];
  /** Originals left out because an approved edited copy replaced them. */
  replaced: number;
}

/** The proposal an edited copy was made from (`payload.edited_from`), or null. */
export function editedFrom(p: Proposal): string | null {
  const rec = typeof p.payload === 'object' && p.payload !== null ? (p.payload as Record<string, unknown>) : null;
  const from = rec?.['edited_from'];
  return typeof from === 'string' && from !== '' ? from : null;
}

export function notAccepted(all: readonly Proposal[], kind: 'memory' | 'policy'): NotAccepted {
  const replacedIds = new Set<string>();
  for (const p of all) {
    const from = p.state === 'approved' ? editedFrom(p) : null;
    if (from !== null) replacedIds.add(from);
  }
  let replaced = 0;
  const rows: Proposal[] = [];
  for (const p of all) {
    if (p.state !== 'rejected' || proposalKind(p) !== kind) continue;
    if (replacedIds.has(p.id)) { replaced += 1; continue; }
    rows.push(p);
  }
  rows.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0) || a.id.localeCompare(b.id));
  return { rows, replaced };
}
