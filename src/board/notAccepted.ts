import { proposalKind, type Proposal } from '../api/proposals.js';

/**
 * NOT ACCEPTED (operator 2026-11-01: "an active/proposed pill like steering except I want to add Not
 * Accepted for review as well"): the proposals a person turned down, read back from the queue.
 *
 * The store keeps a rejected proposal (estate marks it `rejected`, it never deletes it), so this is a
 * fold over `GET /proposals` (every state). The rejected set also holds two rows nobody turned down,
 * both written by crew's accept-with-edit (`api/capture.ts`), and they are left out:
 *  - the ORIGINAL of an accepted edit: crew approves an edited copy (its payload names the original in
 *    `edited_from`) and then rejects the original. Its words were accepted, in the edited form;
 *  - a WITHDRAWN copy: an edited copy whose approve failed is rejected again so a retry leaves no
 *    duplicate (its payload carries `edited_from`, and the original is still pending).
 */
export interface NotAccepted {
  /** The proposals a person turned down, newest first. */
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
    if (editedFrom(p) !== null) continue; // a withdrawn edit copy
    if (replacedIds.has(p.id)) { replaced += 1; continue; }
    rows.push(p);
  }
  rows.sort((a, b) => (b.created_at ?? 0) - (a.created_at ?? 0) || a.id.localeCompare(b.id));
  return { rows, replaced };
}
