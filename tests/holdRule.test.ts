import { describe, expect, it } from 'vitest';
import type { SteeringRule } from '../src/api/steering.js';
import { advisoryRule, heldRule, holdWords, isHeld, isHoldable, knownObligations, unknownObligations } from '../src/board/holdRule.js';

/**
 * WT-U2 "Hold work to it": the switch exists for testing rules only; held = `allow_with_conditions`
 * + obligations from the closed vocabulary; advisory = no effect, the trigger and obligations kept.
 */

function rule(over: Partial<SteeringRule> = {}): SteeringRule {
  return {
    id: 'TST-1002', rule_type: 'policy', statement: 'A change to code or config gets Test plus a walkthrough review by a different helper.',
    severity: 'warn', confidence: 0.9, steering_type: 'testing', applies_to: ['plan.compose'],
    trigger: { contains: '"kinds":\\[[^\\]]*"(code|config)"' }, obligations: ['step:test', 'step:walkthrough'],
    targets: {}, provenance: { source: 'seed', ref: 'seed#TST-1002', source_kinds: ['doc'] }, ...over,
  };
}

describe('isHoldable / isHeld', () => {
  it('a testing rule can be held; a decision (development) rule or a retired rule cannot', () => {
    expect(isHoldable(rule())).toBe(true);
    expect(isHoldable(rule({ id: 'proposal:pr-auto', steering_type: 'development', provenance: { source: 'chat', source_kinds: ['decision'] } }))).toBe(false);
    expect(isHoldable(rule({ retired: true }))).toBe(false);
    // A rule remembered from the operator's words never shows Hold, whatever its type (DC rev 2 N7).
    expect(isHoldable(rule({ id: 'proposal:pr-qa', provenance: { source: 'chat', source_kinds: ['decision'] } }))).toBe(false);
  });
  it('held = allow_with_conditions with obligations; the seed’s advisory encoding (obligations, no effect) is not held', () => {
    expect(isHeld(rule())).toBe(false);
    expect(isHeld(rule({ effect: 'allow_with_conditions' }))).toBe(true);
    expect(isHeld(rule({ effect: 'allow_with_conditions', obligations: [] }))).toBe(false);
    expect(isHeld(rule({ effect: 'deny' }))).toBe(false);
  });
});

describe('heldRule / advisoryRule — the two encodings', () => {
  it('holds the rule to its obligations and leaves everything else as it was', () => {
    const held = heldRule(rule(), ['step:test', 'step:walkthrough', 'step:test']);
    expect(held?.effect).toBe('allow_with_conditions');
    expect(held?.obligations).toEqual(['step:test', 'step:walkthrough']);
    expect(held?.trigger).toEqual(rule().trigger);
    expect(held?.provenance).toEqual(rule().provenance);
  });
  it('refuses nothing to hold to, and a token the engine does not define', () => {
    expect(heldRule(rule(), [])).toBeNull();
    expect(heldRule(rule(), ['step:test', 'check:screenshot'])).toBeNull();
    expect(unknownObligations(['step:test', 'test_kind:e2e'])).toEqual(['test_kind:e2e']);
    expect(knownObligations(rule({ obligations: ['step:walkthrough', 'legacy:x'] }))).toEqual(['step:walkthrough']);
    const bare = rule();
    delete bare.obligations;
    expect(knownObligations(bare)).toEqual([]);
  });
  it('advisory drops only the effect: the trigger and the obligations stay, inert', () => {
    const adv = advisoryRule(rule({ effect: 'allow_with_conditions' }));
    expect(adv.effect).toBeUndefined();
    expect('effect' in adv).toBe(false);
    expect(adv.trigger).toEqual(rule().trigger);
    expect(adv.obligations).toEqual(['step:test', 'step:walkthrough']);
  });
});

describe('holdWords', () => {
  it('says what a hold inserts, and what advisory means', () => {
    expect(holdWords(rule({ effect: 'allow_with_conditions' }))).toBe('Held — when it fires, work gets a Test step and a walkthrough — planned and reviewed by a different helper; only your own plan can drop that.');
    expect(holdWords(rule({ effect: 'allow_with_conditions', obligations: ['step:security_review'] }))).toBe('Held — when it fires, work gets a security review; only your own plan can drop that.');
    expect(holdWords(rule())).toBe('Advisory — helpers are told about it while planning; nothing is inserted.');
    expect(holdWords(rule())).not.toMatch(/followed/i);
  });
});
