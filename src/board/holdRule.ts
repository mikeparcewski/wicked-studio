import { steeringTypeOf, type SteeringRule } from '../api/steering.js';

/**
 * "Hold work to it" (DES-WALKTHROUGH-PROOF-001 §3 scenes 29-30, §4.12 "held vs advisory"; slice WT-U2):
 * the one explicit switch on a TESTING rule. Pure: the words and the two encodings.
 *
 *  - off (the default): no `effect` — recall-only. The lead helper recalls the rule while composing
 *    the plan; the chain shows why a block is or is not there. The trigger and the obligations stay
 *    on the rule (that is exactly how core's testing starter ships TST-1002), inert without an effect.
 *  - on (an explicit click): `effect: allow_with_conditions` plus non-empty `obligations` from the
 *    closed vocabulary — the engine unions the obligations of every fired held rule and floor fill
 *    inserts them as steps the plan cannot drop (only the operator's own plan override can, with a
 *    reason).
 *
 * The switch is for testing rules only. A rule remembered from the operator's words (DC) is advisory
 * until DES-rule-check and shows no Hold (DC rev 2 N7) — `isHoldable` says no for it.
 */

export const HELD_EFFECT = 'allow_with_conditions' as const;

/** WT §4.12: closed and add-only. An unknown token is refused when the rule is written. */
export const HOLD_VOCAB: ReadonlyArray<{ token: string; label: string }> = [
  { token: 'step:test', label: 'a Test step' },
  { token: 'step:walkthrough', label: 'a walkthrough — planned and reviewed by a different helper' },
  { token: 'step:security_review', label: 'a security review' },
];

const TOKENS = new Set(HOLD_VOCAB.map((v) => v.token));

/** A testing rule that is live and was NOT remembered from the operator's words: a decision rule
 *  never shows Hold, whatever its type (DC rev 2 N7 — Hold waits on its checker). */
export function isHoldable(rule: SteeringRule): boolean {
  return steeringTypeOf(rule) === 'testing' && rule.retired !== true && !(rule.provenance.source_kinds ?? []).includes('decision');
}

export function isHeld(rule: SteeringRule): boolean {
  return rule.effect === HELD_EFFECT && (rule.obligations?.length ?? 0) > 0;
}

/** The obligations the rule carries that the vocabulary knows; `[]` when it carries none. */
export function knownObligations(rule: SteeringRule): string[] {
  return (rule.obligations ?? []).filter((t) => TOKENS.has(t));
}

/** Tokens a hold would write that the engine does not define — refused before anything is sent. */
export function unknownObligations(tokens: readonly string[]): string[] {
  return tokens.filter((t) => !TOKENS.has(t));
}

/** The rule as HELD: the effect plus the obligations, everything else as it was. `null` when there is
 *  nothing to hold it to, or a token is not in the vocabulary. */
export function heldRule(rule: SteeringRule, obligations: readonly string[]): SteeringRule | null {
  const list = [...new Set(obligations)];
  if (list.length === 0 || unknownObligations(list).length > 0) return null;
  return { ...rule, effect: HELD_EFFECT, obligations: list };
}

/** The rule as ADVISORY: no effect; the trigger and obligations stay on it, inert. */
export function advisoryRule(rule: SteeringRule): SteeringRule {
  const next: SteeringRule = { ...rule };
  delete next.effect;
  return next;
}

/** What the switch's state means, in words. */
export function holdWords(rule: SteeringRule): string {
  if (isHeld(rule)) {
    const what = (rule.obligations ?? []).map((t) => HOLD_VOCAB.find((v) => v.token === t)?.label ?? t);
    return `Held — when it fires, work gets ${joinWords(what)}; only your own plan can drop that.`;
  }
  return 'Advisory — helpers are told about it while planning; nothing is inserted.';
}

function joinWords(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? '';
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
