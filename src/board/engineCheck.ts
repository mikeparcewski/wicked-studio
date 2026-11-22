import type { SteeringRule } from '../api/steering.js';

/**
 * A rule's ENGINE CHECK (studio#1002; DES-RULE-CHECK-001): obligation tokens the engine itself reads at
 * the rule check, whatever the rule's effect. Pure: the vocabulary, the words, and the merge a rule write
 * uses so every other obligation the rule carries is written back untouched.
 *
 *  - `check:test-fails-on-base`: the engine's machine check (wicked-core `rule_check.rs`
 *    OBLIGATION_TEST_FAILS_ON_BASE): a fix with no test is broken with no model call, and the change's
 *    new or changed tests run on the base.
 *  - `evidence:delivery`: the rule's subject is the pull request (OBLIGATION_EVIDENCE_DELIVERY): deferred
 *    at review and QE, checked at the deliver step.
 */
export const ENGINE_CHECKS: ReadonlyArray<{ token: string; label: string; hint: string }> = [
  {
    token: 'check:test-fails-on-base',
    label: 'Tests fail without the change',
    hint: 'The engine runs the change’s new or changed tests on the base; a fix with no failing test breaks the rule.',
  },
  {
    token: 'evidence:delivery',
    label: 'Checked on the pull request',
    hint: 'Not checked at review or QE; the deliver step checks it against the pull request’s text.',
  },
];

const CHECK_TOKENS = new Set(ENGINE_CHECKS.map((c) => c.token));

/** The phase a held testing rule applies at; the engine holds it only to `step:*` obligations there. */
const PLAN_COMPOSE = 'plan.compose';

/** The engine checks the rule carries, in vocabulary order. */
export function engineChecksOf(rule: Pick<SteeringRule, 'obligations'>): string[] {
  const own = new Set((rule.obligations ?? []).map((t) => t.trim()));
  return ENGINE_CHECKS.map((c) => c.token).filter((t) => own.has(t));
}

/** Every obligation the rule carries that is not an engine check (Hold steps, anything else): kept as is. */
export function otherObligations(rule: Pick<SteeringRule, 'obligations'>): string[] {
  return (rule.obligations ?? []).filter((t) => !CHECK_TOKENS.has(t.trim()));
}

/** The rule's obligations with its engine checks set to `checks`; everything else it carries stays, in order. */
export function withEngineChecks(rule: Pick<SteeringRule, 'obligations'>, checks: readonly string[]): string[] {
  const picked = ENGINE_CHECKS.map((c) => c.token).filter((t) => checks.includes(t));
  return [...otherObligations(rule), ...picked];
}

/**
 * Why the engine would refuse these engine checks on this rule, or `null`. A rule HELD at plan compose
 * (`allow_with_conditions` and `applies_to` naming `plan.compose`) may carry only `step:*` obligations
 * (wicked-governance `check_plan_compose_rule`), so an engine check there is refused when it is written.
 */
export function engineCheckConflict(rule: { effect?: string | undefined; applies_to?: readonly string[] | undefined }, checks: readonly string[]): string | null {
  if (checks.length === 0) return null;
  if (rule.effect !== 'allow_with_conditions' || !(rule.applies_to ?? []).includes(PLAN_COMPOSE)) return null;
  return 'A rule held at plan compose can carry only plan steps, so the engine would refuse an engine check on it. Clear the effect, or the engine check.';
}
