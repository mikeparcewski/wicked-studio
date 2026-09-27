import { policyPayload, policySteeringType, proposalKind, type Proposal } from '../api/proposals.js';

/**
 * TRIAGE BY CONSEQUENCE (studio Wave B, idea 4) — the pending-proposal queue split by what an
 * accept DOES, read from the proposal's own `kind_type` (crew `/api/v1/proposals`):
 *
 *   memory       `kind_type: "memory"` — accepting promotes it to an active memory that workers
 *                recall. No rule is written and nothing is enforced differently (crew
 *                `POST /proposals/:id/approve` passes a `promoted` outcome straight through).
 *   enforcement  `kind_type: "policy:<steering_type>"` — accepting LANDS a steering rule, which
 *                changes what the gates enforce. Always reviewed one by one.
 *   unknown      any other kind — studio cannot say what an accept does, so it is reviewed one by
 *                one too. Only the proven-harmless set is ever batch-accepted.
 *
 * Pure: the queue model (`needsQueue.ts`) folds the group row; the hook (`useAcceptMemory`) holds the preview / undo / send states; skins render.
 */

export type ProposalConsequence = 'memory' | 'enforcement' | 'unknown';

export function proposalConsequence(p: Proposal): ProposalConsequence {
  const kind = proposalKind(p);
  if (kind === 'memory') return 'memory';
  if (kind === 'policy') return 'enforcement';
  return 'unknown';
}

/** The review order: what changes enforcement first, then what studio cannot classify, then memories. */
const ORDER: Record<ProposalConsequence, number> = { enforcement: 0, unknown: 1, memory: 2 };

export function consequenceRank(c: ProposalConsequence): number {
  return ORDER[c];
}

/** A member row's line: the consequence of accepting it, first. */
export function proposalConsequenceLine(p: Proposal): string {
  const c = proposalConsequence(p);
  if (c === 'memory') return 'Memory only — adds a memory; enforcement unchanged';
  if (c === 'enforcement') {
    const type = policySteeringType(p);
    const sev = policyPayload(p).severity;
    const what = `${type !== null ? `a ${type} rule` : 'a steering rule'}${sev !== null ? ` (${sev})` : ''}`;
    return `Changes enforcement — lands ${what}`;
  }
  return `Unknown kind "${p.kind_type}" — review it`;
}

/** The group row's move label: "Accept 21 memory-only ›". */
export function acceptMemoryLabel(n: number): string {
  return `Accept ${n} memory-only ›`;
}

/** What the batch accept will do, spelled once for the preview and the undo toast. */
export function acceptMemoryPreview(accepting: number, staying: number): string {
  const head = `${accepting} ${accepting === 1 ? 'memory becomes' : 'memories become'} active for workers to recall; no rule is written and enforcement is unchanged.`;
  return staying > 0
    ? `${head} ${staying} ${staying === 1 ? 'proposal stays' : 'proposals stay'} for individual review.`
    : head;
}

/** How many members an expanded proposal group shows at once. */
export const PROPOSAL_PAGE = 4;
