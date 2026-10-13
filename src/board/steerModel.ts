import type { SteeringRule } from '../api/steering.js';

/**
 * The Steer surface's counts (DES-steer-eval §2). Pure: every number here is a count over the rules
 * crew serves (`GET /governance/rules`) — no rule model is derived in this repo.
 */

/** What a rule does when it fires — the five enforcement shapes (no effect = guidance). */
export type EnforcementKind = 'blocks' | 'warns' | 'conditions' | 'allows' | 'guidance';

export function enforcementOf(rule: Pick<SteeringRule, 'effect'>): EnforcementKind {
  switch (rule.effect) {
    case 'deny': return 'blocks';
    case 'warn': return 'warns';
    case 'allow_with_conditions': return 'conditions';
    case 'allow': return 'allows';
    default: return 'guidance';
  }
}

export interface SteerTotals {
  live: number;
  retired: number;
  /** Active rules that carry an effect (they can change a gate's answer; evals can measure them). */
  gating: number;
  /** Of those, the active rules that BLOCK (`effect: deny`) — the only ones that can catch a bad sample. */
  blocks: number;
  guidance: number;
}

export function steerTotals(rules: readonly SteeringRule[]): SteerTotals {
  const live = rules.filter((r) => r.retired !== true);
  const gating = live.filter((r) => enforcementOf(r) !== 'guidance').length;
  const blocks = live.filter((r) => enforcementOf(r) === 'blocks').length;
  return { live: live.length, retired: rules.length - live.length, gating, blocks, guidance: live.length - gating };
}
