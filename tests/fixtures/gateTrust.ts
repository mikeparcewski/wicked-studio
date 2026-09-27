// The decided-gate history on crew's `GET /gates/decided` wire (wicked-crew#691, api-types 0.53.0),
// for brainstorm-actionable ideas 7 (a seat's track record) and 8 (make it a rule).
import type { DecidedGate } from '../../src/api/gateHistory.js';

export const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
export const DAY = 86_400_000;

let seq = 0;
/** One decided gate. Defaults: a person approved a `def` review of claude's build on northwind, band 0-19. */
export function decided(over: Partial<DecidedGate> & { daysAgo?: number } = {}): DecidedGate {
  const { daysAgo = 1, ...rest } = over;
  seq += 1;
  return {
    runId: `run-h${seq}`,
    ord: 2,
    decidedAt: NOW - daysAgo * DAY - seq,
    decision: 'approve',
    actor: 'local',
    byOrder: false,
    gateKind: 'def',
    phase: 'build',
    projectId: 'northwind',
    band: '0-19',
    creator: { seat: 'claude', phase: 'build', ord: 1 },
    orderApprovable: true,
    ...rest,
  };
}

/**
 * The shared history:
 *  - claude on build: 8 approvals and 2 send-backs (the send-backs are OLDER than 3 approvals, so the
 *    last three alike decisions are approvals);
 *  - codex on build: 1 approval, 3 send-backs, 1 rejection, all older than 14 days;
 *  - a deliver gate on northwind and a plan approval, approved (never alike, never counted);
 *  - an order's approval (never part of a seat's record).
 */
export function history(): DecidedGate[] {
  const codex = { seat: 'codex', phase: 'build', ord: 1 };
  return [
    decided({ daysAgo: 1 }), decided({ daysAgo: 2 }), decided({ daysAgo: 3 }),
    decided({ daysAgo: 4, decision: 'request_changes' }),
    decided({ daysAgo: 5 }), decided({ daysAgo: 6 }),
    decided({ daysAgo: 8, decision: 'request_changes' }),
    decided({ daysAgo: 16 }), decided({ daysAgo: 17 }), decided({ daysAgo: 18 }),
    decided({ daysAgo: 20, creator: codex }),
    decided({ daysAgo: 21, creator: codex, decision: 'request_changes' }),
    decided({ daysAgo: 22, creator: codex, decision: 'request_changes' }),
    decided({ daysAgo: 23, creator: codex, decision: 'request_changes' }),
    decided({ daysAgo: 24, creator: codex, decision: 'reject' }),
    decided({ daysAgo: 1, gateKind: 'deliver', phase: 'deliver', orderApprovable: false }),
    decided({ daysAgo: 2, gateKind: 'plan_approval', phase: 'intake', orderApprovable: false, creator: null }),
    decided({ daysAgo: 9, byOrder: true, actor: 'standing-order:old' }),
  ];
}
